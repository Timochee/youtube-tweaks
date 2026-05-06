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
// case only, a MutationObserver scans new feed items and adds a marker
// class. The observer is started/stopped based on the toggle.
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

        /* Shorts in search results (badged "Shorts") */
        html.ytc-hide-shorts ytd-video-renderer:has(badge-shape[aria-label="Shorts"]),

        /* Whole Shorts shelves on home / subscriptions */
        html.ytc-hide-shorts ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
        html.ytc-hide-shorts ytd-reel-shelf-renderer,
        html.ytc-hide-shorts grid-shelf-view-model:has(.shortsLockupViewModelHost),

        /* Sidebar "Shorts" entry (collapsed and expanded guides) */
        html.ytc-hide-shorts ytd-guide-entry-renderer:has(a[title="Shorts"]),
        html.ytc-hide-shorts ytd-mini-guide-entry-renderer[aria-label="Shorts"] {
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
        (document.head || document.documentElement).appendChild(style);
    }

    // ------------------------------------------------------------------------
    // Replay detection (JS-based, runs only when the toggle is on)
    // ------------------------------------------------------------------------

    const SUBS_PAGE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]';
    const ITEM_SELECTOR = 'ytd-rich-item-renderer';
    const META_SELECTOR =
        '.inline-metadata-item.ytd-video-meta-block, ' +
        'yt-content-metadata-view-model span';
    const REPLAY_PREFIX = 'Streamed '; // English YouTube

    let replaysEnabled = false;
    let observer = null;
    let scheduled = false;

    function isReplayItem(item) {
        const spans = item.querySelectorAll(META_SELECTOR);
        for (const span of spans) {
            const text = (span.textContent || '').trim();
            if (text.startsWith(REPLAY_PREFIX)) return true;
        }
        return false;
    }

    function processReplays() {
        if (!replaysEnabled) return;
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse || browse.hasAttribute('hidden')) return;

        const items = browse.querySelectorAll(ITEM_SELECTOR);
        for (const item of items) {
            if (item.classList.contains(REPLAY_HIDDEN_CLASS)) continue;
            if (isReplayItem(item)) {
                item.classList.add(REPLAY_HIDDEN_CLASS);
            }
        }
    }

    function scheduleReplayPass() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            processReplays();
        });
    }

    function startReplayObserver() {
        if (observer) return;
        const root = document.documentElement || document.body;
        if (!root) return;
        observer = new MutationObserver(scheduleReplayPass);
        observer.observe(root, {
            childList: true,
            subtree: true,
            characterData: true, // metadata text fills in lazily after node insertion
        });
    }

    function stopReplayObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        // Restore previously-hidden replay items so the page reflects the new state.
        document.querySelectorAll('.' + REPLAY_HIDDEN_CLASS)
            .forEach(el => el.classList.remove(REPLAY_HIDDEN_CLASS));
    }

    function applyReplayToggle(enabled) {
        replaysEnabled = enabled;
        if (enabled) {
            startReplayObserver();
            scheduleReplayPass();
        } else {
            stopReplayObserver();
        }
    }

    // ------------------------------------------------------------------------
    // CSS-toggle bookkeeping
    // ------------------------------------------------------------------------

    function applyCssToggles(settings) {
        const root = document.documentElement;
        root.classList.toggle('ytc-hide-shorts', !!settings.hideShorts);
        root.classList.toggle('ytc-hide-live', !!settings.hideLive);
    }

    function applyAll(settings) {
        applyCssToggles(settings);
        applyReplayToggle(!!settings.hideReplays);
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

    // Re-run the replay pass on every YouTube SPA navigation.
    window.addEventListener('yt-navigate-finish', scheduleReplayPass);

    // ------------------------------------------------------------------------
    // Boot
    // ------------------------------------------------------------------------

    injectStyles();
    loadAndApply();
})();
