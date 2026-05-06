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

    // Two badge mechanisms coexist: the legacy [overlay-style="LIVE"] and
    // the newer .badge-shape-wiz--thumbnail-live class. We catch both.
    const STYLES = `
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has([overlay-style="LIVE"]),
        html.${HTML_CLASS} ytd-browse[page-subtype="subscriptions"] ytd-rich-item-renderer:has(.badge-shape-wiz--thumbnail-live),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has([overlay-style="LIVE"]),
        html.${HTML_CLASS} ytd-browse[page-subtype="home"] ytd-rich-item-renderer:has(.badge-shape-wiz--thumbnail-live) {
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
