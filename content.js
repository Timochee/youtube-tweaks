// ============================================================================
// YouTube Cleaner — content script
// ============================================================================
//
// Runs on every page of www.youtube.com at document_start. Five toggles,
// individually controllable from the popup. Four cleanup filters and one
// action:
//
//   - hideShorts    : hide Shorts items, shelves, and sidebar entries everywhere
//   - hideLive      : hide currently-live streams on Subscriptions and Home
//   - hideReplays   : hide past live streams ("Streamed X ago") on Subscriptions
//   - hideRelevant  : hide the "Most relevant" shelf at the top of Subscriptions
//   - autoLike      : on /watch pages, auto-click Like after AUTOLIKE_THRESHOLD_S
//                     seconds of actual play time, but only when the channel
//                     is one the user is subscribed to. Skips if already
//                     liked or disliked.
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
        autoLike: false,
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
    // Auto-like (Watch page only, subscribed channels only)
    //
    // Polls once per second while the toggle is on. The interval increments
    // a per-video "actual playing time" counter only when the <video> is not
    // paused, so seeks and pauses don't count. After AUTOLIKE_THRESHOLD_S of
    // accumulated play time, if the user is subscribed to the current
    // channel and hasn't already liked/disliked, click the Like button once.
    // ------------------------------------------------------------------------

    const AUTOLIKE_THRESHOLD_S = 2;
    const VIDEO_SELECTOR = 'ytd-watch-flexy video, video.html5-main-video';
    const SUBSCRIBE_RENDERERS = [
        'ytd-watch-flexy ytd-subscribe-button-renderer',
        'ytd-watch-flexy yt-subscribe-button-view-model',
    ].join(', ');

    let autoLikeInterval = null;
    let watchedSeconds = 0;
    let lastTickVideoId = null;
    let actedOnVideoId = null; // last video the toggle has already liked/skipped

    function currentWatchVideoId() {
        if (location.pathname !== '/watch') return null;
        return new URLSearchParams(location.search).get('v');
    }

    function isSubscribedHere() {
        // Modern YouTube: the renderer carries a `subscribed` attribute when
        // the user is subscribed; otherwise the button's aria-pressed flips.
        if (document.querySelector('ytd-subscribe-button-renderer[subscribed]')) return true;
        const renderer = document.querySelector(SUBSCRIBE_RENDERERS);
        if (!renderer) return false;
        const btn = renderer.querySelector('button[aria-pressed]');
        return btn?.getAttribute('aria-pressed') === 'true';
    }

    function findLikeButton() {
        return document.querySelector(
            'ytd-watch-flexy like-button-view-model button[aria-pressed], ' +
            'ytd-watch-flexy ytd-toggle-button-renderer:has(yt-formatted-string) button[aria-pressed]'
        );
    }

    function findDislikeButton() {
        return document.querySelector(
            'ytd-watch-flexy dislike-button-view-model button[aria-pressed]'
        );
    }

    function tryAutoLike() {
        const id = currentWatchVideoId();
        if (!id || actedOnVideoId === id) return;
        if (!isSubscribedHere()) return;

        const like = findLikeButton();
        if (!like) return;
        if (like.getAttribute('aria-pressed') === 'true') {
            actedOnVideoId = id; // already liked — done for this video
            return;
        }
        const dislike = findDislikeButton();
        if (dislike?.getAttribute('aria-pressed') === 'true') {
            actedOnVideoId = id; // user disliked — respect that, don't override
            return;
        }
        like.click();
        actedOnVideoId = id;
    }

    function autoLikeTick() {
        const id = currentWatchVideoId();
        if (!id) return;
        if (id !== lastTickVideoId) {
            // SPA navigation to a new video — reset watched-time counter.
            watchedSeconds = 0;
            lastTickVideoId = id;
        }
        const video = document.querySelector(VIDEO_SELECTOR);
        if (!video || video.paused) return;
        watchedSeconds += 1;
        if (watchedSeconds >= AUTOLIKE_THRESHOLD_S) tryAutoLike();
    }

    function startAutoLike() {
        if (autoLikeInterval) return;
        autoLikeInterval = setInterval(autoLikeTick, 1000);
    }

    function stopAutoLike() {
        if (autoLikeInterval) {
            clearInterval(autoLikeInterval);
            autoLikeInterval = null;
        }
        watchedSeconds = 0;
        lastTickVideoId = null;
        actedOnVideoId = null;
    }

    function applyAutoLikeToggle(enabled) {
        if (enabled) startAutoLike();
        else stopAutoLike();
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
        applyAutoLikeToggle(settings.autoLike);
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
