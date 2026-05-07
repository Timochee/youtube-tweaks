// ============================================================================
// Disable autoplay — action filter (Watch page only)
// ============================================================================
// On every /watch page load (and on SPA navigation between videos), find
// the autoplay toggle in the player and click it once if it's currently
// ON. The toggle's ON/OFF state is read from `aria-checked` on the
// `.ytp-autonav-toggle-button` element.
//
// The player isn't always present on the page right when the script runs,
// so we poll briefly (250 ms intervals, 5 s deadline) until the toggle
// appears, then act and stop. Subsequent /watch navigations re-arm the
// poll only if the video ID changed — same video re-rendered, no work.
// ============================================================================

(function () {
    'use strict';

    const DEFAULTS = { disableAutoplay: false };
    const TOGGLE_STATE_SELECTOR = '.ytp-autonav-toggle-button[aria-checked]';
    const POLL_INTERVAL_MS = 250;
    const POLL_DEADLINE_MS = 5000;

    let enabled = false;
    let pollHandle = null;
    let pollDeadline = 0;
    let handledVideoId = null;

    function currentWatchVideoId() {
        if (location.pathname !== '/watch') return null;
        return new URLSearchParams(location.search).get('v');
    }

    function attemptDisable() {
        const stateEl = document.querySelector(TOGGLE_STATE_SELECTOR);
        if (!stateEl) return false;
        if (stateEl.getAttribute('aria-checked') === 'true') {
            const clickable = stateEl.closest('button') || stateEl;
            clickable.click();
        }
        return true; // toggle found — done, whether it was on or off
    }

    function stopPoll() {
        if (pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
        }
    }

    function startPoll() {
        const id = currentWatchVideoId();
        if (!id || handledVideoId === id) return;
        stopPoll();
        pollDeadline = Date.now() + POLL_DEADLINE_MS;
        pollHandle = setInterval(() => {
            if (attemptDisable()) {
                handledVideoId = id;
                stopPoll();
                return;
            }
            if (Date.now() > pollDeadline) stopPoll();
        }, POLL_INTERVAL_MS);
    }

    function apply(settings) {
        const wasEnabled = enabled;
        enabled = settings.disableAutoplay;
        if (enabled && !wasEnabled) {
            // Toggle just turned on — try once for the current page.
            handledVideoId = null;
            startPoll();
        } else if (!enabled) {
            stopPoll();
            handledVideoId = null;
        }
    }

    function loadAndApply() {
        chrome.storage.sync.get(DEFAULTS).then(apply).catch(() => {});
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (Object.keys(changes).some(k => k in DEFAULTS)) loadAndApply();
    });

    window.addEventListener('yt-navigate-finish', () => {
        if (enabled) startPoll();
    });

    loadAndApply();
})();
