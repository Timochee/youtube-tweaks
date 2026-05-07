// ============================================================================
// Hide Shorts — CSS-only filter
// ============================================================================
// Toggling on adds the `ytc-hide-shorts` class to <html>. CSS rules below
// (gated on that class) hide Shorts items, shelves, and sidebar entries
// across every YouTube page. Toggling off removes the class.
// ============================================================================

(function () {
    'use strict';

    const DEFAULTS = { hideShorts: false };
    const STYLE_ID = 'ytc-styles-shorts';
    const HTML_CLASS = 'ytc-hide-shorts';

    const STYLES = `
        /* Individual Shorts items in feeds (rich grid, list, classic grid) */
        html.${HTML_CLASS} ytd-rich-item-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
        html.${HTML_CLASS} ytd-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),
        html.${HTML_CLASS} ytd-grid-video-renderer:has(ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]),

        /* Lockup-based components: items linking to /shorts/ */
        html.${HTML_CLASS} yt-lockup-view-model:has(a[href*="/shorts/"]),
        html.${HTML_CLASS} ytd-rich-item-renderer:has(a[href*="/shorts/"]),

        /* Shorts in search results: badged "Shorts" (English) or any video
           item whose link points to /shorts/ (URL fallback for other locales). */
        html.${HTML_CLASS} ytd-video-renderer:has(badge-shape[aria-label="Shorts"]),
        html.${HTML_CLASS} ytd-video-renderer:has(a[href*="/shorts/"]),

        /* Whole Shorts shelves on home / subscriptions */
        html.${HTML_CLASS} ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
        html.${HTML_CLASS} ytd-reel-shelf-renderer,
        html.${HTML_CLASS} grid-shelf-view-model:has(.shortsLockupViewModelHost),

        /* Sidebar "Shorts" entry — English attributes (legacy) plus URL-based
           fallback. The sidebar entry only ever links to one route, so matching
           by /shorts URL is safe (no risk of catching a video link). */
        html.${HTML_CLASS} ytd-guide-entry-renderer:has(a[title="Shorts"]),
        html.${HTML_CLASS} ytd-guide-entry-renderer:has(a[href*="/shorts"]),
        html.${HTML_CLASS} ytd-mini-guide-entry-renderer[aria-label="Shorts"],
        html.${HTML_CLASS} ytd-mini-guide-entry-renderer:has(a[href*="/shorts"]),

        /* Channel-page "Shorts" tab — yt-tab-shape carries the title in a
           tab-title attribute (no <a> child to match by URL). The legacy
           tp-yt-paper-tab variant did expose an aria-label; both kept. */
        html.${HTML_CLASS} yt-tab-shape[tab-title="Shorts"],
        html.${HTML_CLASS} tp-yt-paper-tab[aria-label="Shorts"] {
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

    function apply(settings) {
        document.documentElement.classList.toggle(HTML_CLASS, settings.hideShorts);
    }

    function loadAndApply() {
        chrome.storage.sync.get(DEFAULTS).then(apply).catch(() => {});
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (Object.keys(changes).some(k => k in DEFAULTS)) loadAndApply();
    });

    injectStyles();
    loadAndApply();
})();
