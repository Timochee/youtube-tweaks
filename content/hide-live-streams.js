// ============================================================================
// Hide Live streams — CSS-only filter
// ============================================================================
// Toggling on adds the `ytc-hide-live` class to <html>. CSS rules below
// hide currently-live items on the Subscriptions and Home feeds only.
// ============================================================================

(function () {
    'use strict';

    const DEFAULTS = { hideLive: false };
    const STYLE_ID = 'ytc-styles-live';
    const HTML_CLASS = 'ytc-hide-live';

    // Three badge mechanisms have shipped in parallel:
    //   - Legacy: [overlay-style="LIVE"] on ytd-thumbnail-overlay-time-status-renderer
    //   - Wiz kebab: .badge-shape-wiz--thumbnail-live
    //   - Wiz camelCase (current 2026): .ytBadgeShapeThumbnailLive
    //     (sits inside <yt-thumbnail-badge-view-model> with text "LIVE")
    // Newer feed items wrap content in <yt-lockup-view-model> instead of
    // ytd-rich-item-renderer, so we match both wrappers.
    const STYLES = `
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has([overlay-style="LIVE"]),
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(.badge-shape-wiz--thumbnail-live),
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(.ytBadgeShapeThumbnailLive),
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] yt-lockup-view-model:has([overlay-style="LIVE"]),
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] yt-lockup-view-model:has(.badge-shape-wiz--thumbnail-live),
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] yt-lockup-view-model:has(.ytBadgeShapeThumbnailLive),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has([overlay-style="LIVE"]),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(.badge-shape-wiz--thumbnail-live),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(.ytBadgeShapeThumbnailLive),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] yt-lockup-view-model:has([overlay-style="LIVE"]),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] yt-lockup-view-model:has(.badge-shape-wiz--thumbnail-live),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] yt-lockup-view-model:has(.ytBadgeShapeThumbnailLive) {
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
        document.documentElement.classList.toggle(HTML_CLASS, settings.hideLive);
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
