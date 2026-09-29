// ============================================================================
// Auto-like — action filter (Watch page only, subscribed channels only)
// ============================================================================
// The only feature that *acts* on the user's account rather than hiding DOM.
// While the toggle is on, a 1 Hz interval increments a per-video
// "actual playing time" counter only when <video> is not paused (so seeks
// and pauses don't count). At AUTOLIKE_THRESHOLD_S, if the channel is
// subscribed and the user hasn't already liked or disliked, click Like
// exactly once. SPA navigation between videos is detected by comparing
// the URL's `v=` param against lastTickVideoId.
// ============================================================================

(function () {
    'use strict';

    const DEFAULTS = { autoLike: false };
    const AUTOLIKE_THRESHOLD_S = 2;
    const VIDEO_SELECTOR = 'ytd-watch-flexy video, video.html5-main-video';
    const SUBSCRIBE_RENDERERS = [
        'ytd-watch-flexy ytd-subscribe-button-renderer',
        'ytd-watch-flexy yt-subscribe-button-view-model',
    ].join(', ');

    let interval = null;
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
        // Scoped to ytd-watch-flexy: YouTube keeps previously visited pages
        // (e.g. a subscribed channel's ytd-browse) hidden in the DOM.
        if (document.querySelector('ytd-watch-flexy ytd-subscribe-button-renderer[subscribed]')) return true;
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

    function tick() {
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

    function start() {
        if (interval) return;
        interval = setInterval(tick, 1000);
    }

    function stop() {
        if (interval) {
            clearInterval(interval);
            interval = null;
        }
        watchedSeconds = 0;
        lastTickVideoId = null;
        actedOnVideoId = null;
    }

    function apply(settings) {
        if (settings.autoLike) start();
        else stop();
    }

    function loadAndApply() {
        chrome.storage.sync.get(DEFAULTS)
            .then(apply)
            .catch(err => console.warn('[YouTube Tweaks] auto-like: settings not applied', err));
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (Object.keys(changes).some(k => k in DEFAULTS)) loadAndApply();
    });

    loadAndApply();
})();
