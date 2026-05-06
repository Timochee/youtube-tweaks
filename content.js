// ============================================================================
// YouTube Cleaner — content script
// ============================================================================
//
// Runs on every page of www.youtube.com at document_start. Four filters,
// individually toggleable from the popup:
//
//   - hideShorts    : hide Shorts items, shelves, and sidebar entries everywhere
//   - hideLive      : hide currently-live streams on Subscriptions and Home
//   - hideReplays   : hide past live streams ("Streamed X ago") on Subscriptions
//   - hideRelevant  : hide the "Most relevant" shelf at the top of Subscriptions
//
// Architecture
// ------------
// Shorts and live are detectable via DOM attributes/classes, so they're
// handled with a CSS-only approach: a single <style> is injected once at
// document_start, and toggle state is reflected as classes on <html>
// (e.g. `html.ytc-hide-shorts`). CSS rules are gated on those classes,
// which means turning a filter on/off is a single classList.toggle() call —
// no DOM walking, no per-item work.
//
// Replays and the "Most relevant" shelf can't be selected via CSS because
// they're identified by header/metadata text (no dedicated DOM attribute
// exists). They share a single MutationObserver that collects candidate
// items/sections from added subtrees and from characterData targets (text
// fills in lazily after insertion), coalesces work via requestAnimationFrame,
// and adds a marker class to matches. A full sweep runs at toggle-on and on
// SPA navigation. The observer is started while at least one of the two
// JS-based filters is enabled, and stopped otherwise.
// ============================================================================

(function () {
    'use strict';

    const STORAGE_DEFAULTS = {
        hideShorts: false,
        hideLive: false,
        hideReplays: false,
        hideRelevant: false,
    };

    // ------------------------------------------------------------------------
    // Style sheet (injected once)
    // ------------------------------------------------------------------------

    const STYLE_ID = 'ytc-styles';
    const REPLAY_HIDDEN_CLASS = 'ytc-hide-replay-item';
    const RELEVANT_HIDDEN_CLASS = 'ytc-hide-relevant-section';

    const STYLES = `
        /* ===== Shorts (all pages) ===== */

        /* Individual Shorts items in feeds (rich grid, list, classic grid) */
        html.ytc-hide-shorts ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
        html.ytc-hide-shorts ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
        html.ytc-hide-shorts ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),

        /* New lockup-based components (rolling out 2026): items linking to /shorts/ */
        html.ytc-hide-shorts yt-lockup-view-model:has(a[href*="/shorts/"]),
        html.ytc-hide-shorts ytd-rich-item-renderer:has(a[href*="/shorts/"]),

        /* Shorts in search results: badged "Shorts" (English) or any video
           item whose link points to /shorts/ (URL fallback for other locales). */
        html.ytc-hide-shorts ytd-video-renderer:has(badge-shape[aria-label="Shorts"]),
        html.ytc-hide-shorts ytd-video-renderer:has(a[href*="/shorts/"]),

        /* Whole Shorts shelves on home / subscriptions */
        html.ytc-hide-shorts ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
        html.ytc-hide-shorts ytd-reel-shelf-renderer,
        html.ytc-hide-shorts grid-shelf-view-model:has(.shortsLockupViewModelHost),

        /* Sidebar "Shorts" entry — English attributes (legacy) plus URL-based
           fallback. The sidebar entry only ever links to one route, so matching
           by /shorts URL is safe (no risk of catching a video link). */
        html.ytc-hide-shorts ytd-guide-entry-renderer:has(a[title="Shorts"]),
        html.ytc-hide-shorts ytd-guide-entry-renderer:has(a[href*="/shorts"]),
        html.ytc-hide-shorts ytd-mini-guide-entry-renderer[aria-label="Shorts"],
        html.ytc-hide-shorts ytd-mini-guide-entry-renderer:has(a[href*="/shorts"]) {
            display: none !important;
        }

        /* ===== Live streams (Subscriptions + Home) ===== */

        /* Two badge mechanisms coexist: the legacy [overlay-style="LIVE"] and
           the new .badge-shape-wiz--thumbnail-live class. We catch both. */
        html.ytc-hide-live ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has([overlay-style="LIVE"]),
        html.ytc-hide-live ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(.badge-shape-wiz--thumbnail-live),
        html.ytc-hide-live ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has([overlay-style="LIVE"]),
        html.ytc-hide-live ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(.badge-shape-wiz--thumbnail-live) {
            display: none !important;
        }

        /* ===== Replays of past live streams (Subscriptions only) =====
           Selector based on a class we add via JS to items whose metadata
           text starts with "Streamed " (English YouTube). */
        ytd-rich-item-renderer.${REPLAY_HIDDEN_CLASS} {
            display: none !important;
        }

        /* ===== "Most relevant" shelf (Subscriptions only) =====
           Selector based on a class we add via JS to ytd-rich-section-renderer
           whose header text matches one of RELEVANT_LABELS (English YouTube). */
        ytd-rich-section-renderer.${RELEVANT_HIDDEN_CLASS} {
            display: none !important;
        }
    `;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.documentElement.appendChild(style);
    }

    // ------------------------------------------------------------------------
    // JS-based filters: replays + "Most relevant" shelf
    // (runs only while at least one of the two toggles is on)
    // ------------------------------------------------------------------------

    const SUBS_PAGE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]';
    const ITEM_SELECTOR = 'ytd-rich-item-renderer';
    const SECTION_SELECTOR = 'ytd-rich-section-renderer';
    const META_SELECTOR =
        '.inline-metadata-item.ytd-video-meta-block, ' +
        'yt-content-metadata-view-model span';
    const REPLAY_PREFIX = 'Streamed '; // English YouTube only — see CLAUDE.md
    const RELEVANT_LABELS = ['Most relevant']; // English YouTube only — see CLAUDE.md

    let replaysOn = false;
    let relevantOn = false;
    let observer = null;
    let scheduled = false;
    const pendingItems = new Set();
    const pendingSections = new Set();

    function isReplayItem(item) {
        const spans = item.querySelectorAll(META_SELECTOR);
        for (const span of spans) {
            const text = (span.textContent || '').trim();
            if (text.startsWith(REPLAY_PREFIX)) return true;
        }
        return false;
    }

    function isRelevantSection(section) {
        // Section header text lives in the first descendant #title (the shelf
        // header). Nested video titles share the id but appear deeper in the
        // tree, so the first match in document order is the shelf-level one.
        const titleEl = section.querySelector('#title');
        if (!titleEl) return false;
        const text = (titleEl.textContent || '').trim();
        return RELEVANT_LABELS.includes(text);
    }

    function collectFromMutations(mutations) {
        for (const m of mutations) {
            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                if (!parent) continue;
                if (replaysOn) {
                    const item = parent.closest(ITEM_SELECTOR);
                    if (item) pendingItems.add(item);
                }
                if (relevantOn) {
                    const section = parent.closest(SECTION_SELECTOR);
                    if (section) pendingSections.add(section);
                }
                continue;
            }
            for (const node of m.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (replaysOn) {
                    if (node.matches(ITEM_SELECTOR)) {
                        pendingItems.add(node);
                    } else {
                        node.querySelectorAll(ITEM_SELECTOR)
                            .forEach(item => pendingItems.add(item));
                    }
                }
                if (relevantOn) {
                    if (node.matches(SECTION_SELECTOR)) {
                        pendingSections.add(node);
                    } else {
                        node.querySelectorAll(SECTION_SELECTOR)
                            .forEach(section => pendingSections.add(section));
                    }
                }
            }
        }
    }

    function flushPending() {
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse || browse.hasAttribute('hidden')) {
            pendingItems.clear();
            pendingSections.clear();
            return;
        }
        if (replaysOn) {
            for (const item of pendingItems) {
                if (!browse.contains(item)) continue;
                if (item.classList.contains(REPLAY_HIDDEN_CLASS)) continue;
                if (isReplayItem(item)) item.classList.add(REPLAY_HIDDEN_CLASS);
            }
        }
        pendingItems.clear();
        if (relevantOn) {
            for (const section of pendingSections) {
                if (!browse.contains(section)) continue;
                if (section.classList.contains(RELEVANT_HIDDEN_CLASS)) continue;
                if (isRelevantSection(section)) section.classList.add(RELEVANT_HIDDEN_CLASS);
            }
        }
        pendingSections.clear();
    }

    function scheduleFlush() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            flushPending();
        });
    }

    function scanAll() {
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse) return;
        if (replaysOn) {
            browse.querySelectorAll(ITEM_SELECTOR)
                .forEach(item => pendingItems.add(item));
        }
        if (relevantOn) {
            browse.querySelectorAll(SECTION_SELECTOR)
                .forEach(section => pendingSections.add(section));
        }
        scheduleFlush();
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(mutations => {
            const beforeI = pendingItems.size;
            const beforeS = pendingSections.size;
            collectFromMutations(mutations);
            if (pendingItems.size !== beforeI || pendingSections.size !== beforeS) {
                scheduleFlush();
            }
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    function stopObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        pendingItems.clear();
        pendingSections.clear();
    }

    function clearMarkers(className) {
        document.querySelectorAll('.' + className)
            .forEach(el => el.classList.remove(className));
    }

    function applyJsFilters(settings) {
        const wasReplaysOn = replaysOn;
        const wasRelevantOn = relevantOn;
        replaysOn = settings.hideReplays;
        relevantOn = settings.hideRelevant;

        if (wasReplaysOn && !replaysOn) clearMarkers(REPLAY_HIDDEN_CLASS);
        if (wasRelevantOn && !relevantOn) clearMarkers(RELEVANT_HIDDEN_CLASS);

        if (replaysOn || relevantOn) {
            startObserver();
            scanAll();
        } else {
            stopObserver();
        }
    }

    // ------------------------------------------------------------------------
    // CSS-toggle bookkeeping
    // ------------------------------------------------------------------------

    function applyCssToggles(settings) {
        const root = document.documentElement;
        root.classList.toggle('ytc-hide-shorts', settings.hideShorts);
        root.classList.toggle('ytc-hide-live', settings.hideLive);
    }

    function applyAll(settings) {
        applyCssToggles(settings);
        applyJsFilters(settings);
    }

    // ------------------------------------------------------------------------
    // Storage sync
    // ------------------------------------------------------------------------

    async function loadAndApply() {
        try {
            const settings = await chrome.storage.sync.get(STORAGE_DEFAULTS);
            applyAll(settings);
        } catch (e) {
            // Extension context may be invalidated during reloads; ignore.
        }
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        loadAndApply();
    });

    // Re-run JS filters on every YouTube SPA navigation.
    window.addEventListener('yt-navigate-finish', scanAll);

    // ------------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------------

    injectStyles();
    loadAndApply();
})();
