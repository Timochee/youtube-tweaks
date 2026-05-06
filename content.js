// ============================================================================
// YouTube Cleaner — content script
// ============================================================================
//
// Runs on every page of www.youtube.com at document_start. Three filters,
// individually toggleable from the popup:
//
//   - hideShorts   : hide Shorts items, shelves, and sidebar entries everywhere
//   - hideLive     : hide currently-live streams on Subscriptions and Home
//   - hideReplays  : hide past live streams ("Streamed X ago") on Subscriptions
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
// Replays cannot be selected via CSS because identification is based on the
// metadata text "Streamed " (no dedicated DOM attribute exists). For that
// case only, a MutationObserver collects items from added subtrees and from
// characterData targets (metadata text fills in lazily after insertion),
// coalesces them via requestAnimationFrame, and adds a marker class to the
// ones that match. A full sweep runs at toggle-on and on SPA navigation.
// The observer is started/stopped based on the toggle.
// ============================================================================

(function () {
    'use strict';

    const STORAGE_DEFAULTS = {
        hideShorts: false,
        hideLive: false,
        hideReplays: false,
    };

    // ------------------------------------------------------------------------
    // Style sheet (injected once)
    // ------------------------------------------------------------------------

    const STYLE_ID = 'ytc-styles';
    const REPLAY_HIDDEN_CLASS = 'ytc-hide-replay-item';

    const STYLES = `
        /* ===== Shorts (all pages) ===== */

        /* Individual Shorts items in feeds (rich grid, list, classic grid) */
        html.ytc-hide-shorts ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
        html.ytc-hide-shorts ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
        html.ytc-hide-shorts ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),

        /* New lockup-based components (rolling out 2026): items linking to /shorts/ */
        html.ytc-hide-shorts yt-lockup-view-model:has(a[href*="/shorts/"]),
        html.ytc-hide-shorts ytd-rich-item-renderer:has(a[href*="/shorts/"]),

        /* Shorts in search results: video items linking to /shorts/ */
        html.ytc-hide-shorts ytd-video-renderer:has(a[href*="/shorts/"]),

        /* Whole Shorts shelves on home / subscriptions */
        html.ytc-hide-shorts ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
        html.ytc-hide-shorts ytd-reel-shelf-renderer,
        html.ytc-hide-shorts grid-shelf-view-model:has(.shortsLockupViewModelHost),

        /* Sidebar "Shorts" entry, matched via the /shorts URL (language-agnostic) */
        html.ytc-hide-shorts ytd-guide-entry-renderer:has(a[href="/shorts"]),
        html.ytc-hide-shorts ytd-mini-guide-entry-renderer:has(a[href="/shorts"]) {
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
    `;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.documentElement.appendChild(style);
    }

    // ------------------------------------------------------------------------
    // Replay detection (JS-based, runs only when the toggle is on)
    // ------------------------------------------------------------------------

    const SUBS_PAGE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]';
    const ITEM_SELECTOR = 'ytd-rich-item-renderer';
    const META_SELECTOR =
        '.inline-metadata-item.ytd-video-meta-block, ' +
        'yt-content-metadata-view-model span';
    const REPLAY_PREFIX = 'Streamed '; // English YouTube only — see CLAUDE.md

    let observer = null;
    let scheduled = false;
    const pendingItems = new Set();

    function isReplayItem(item) {
        const spans = item.querySelectorAll(META_SELECTOR);
        for (const span of spans) {
            const text = (span.textContent || '').trim();
            if (text.startsWith(REPLAY_PREFIX)) return true;
        }
        return false;
    }

    function collectFromMutations(mutations) {
        for (const m of mutations) {
            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                const item = parent && parent.closest(ITEM_SELECTOR);
                if (item) pendingItems.add(item);
                continue;
            }
            for (const node of m.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches(ITEM_SELECTOR)) {
                    pendingItems.add(node);
                } else {
                    node.querySelectorAll(ITEM_SELECTOR)
                        .forEach(item => pendingItems.add(item));
                }
            }
        }
    }

    function flushReplayItems() {
        if (!observer) {
            pendingItems.clear();
            return;
        }
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse || browse.hasAttribute('hidden')) {
            pendingItems.clear();
            return;
        }
        for (const item of pendingItems) {
            if (!browse.contains(item)) continue;
            if (item.classList.contains(REPLAY_HIDDEN_CLASS)) continue;
            if (isReplayItem(item)) item.classList.add(REPLAY_HIDDEN_CLASS);
        }
        pendingItems.clear();
    }

    function scheduleFlush() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            flushReplayItems();
        });
    }

    function scanAllReplays() {
        if (!observer) return;
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse) return;
        browse.querySelectorAll(ITEM_SELECTOR)
            .forEach(item => pendingItems.add(item));
        scheduleFlush();
    }

    function startReplayObserver() {
        if (observer) return;
        observer = new MutationObserver(mutations => {
            const before = pendingItems.size;
            collectFromMutations(mutations);
            if (pendingItems.size !== before) scheduleFlush();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true,
        });
    }

    function stopReplayObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        pendingItems.clear();
        document.querySelectorAll('.' + REPLAY_HIDDEN_CLASS)
            .forEach(el => el.classList.remove(REPLAY_HIDDEN_CLASS));
    }

    function applyReplayToggle(enabled) {
        if (enabled) {
            startReplayObserver();
            scanAllReplays();
        } else {
            stopReplayObserver();
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
        applyReplayToggle(settings.hideReplays);
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

    // Re-run the replay scan on every YouTube SPA navigation.
    window.addEventListener('yt-navigate-finish', scanAllReplays);

    // ------------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------------

    injectStyles();
    loadAndApply();
})();
