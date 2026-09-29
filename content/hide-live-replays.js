// ============================================================================
// Hide Live Replays: JS-marked filter (Subscriptions only)
// ============================================================================
// YouTube exposes no DOM attribute to distinguish replays from regular
// videos. The only signal is the metadata text starting with "Streamed "
// (English only; edit REPLAY_PREFIX for other locales).
//
// This file owns one MutationObserver (started only while the toggle is on)
// that translates MutationRecords into a `pendingItems` Set. childList ->
// newly-inserted feed items; characterData -> existing items whose metadata
// text just filled in. The set is drained on a requestAnimationFrame tick.
// A full sweep runs at toggle-on and on yt-navigate-finish, where there's
// no mutation record to lean on. Toggling off removes the marker class.
// ============================================================================

(function () {
    'use strict';

    const DEFAULTS = { hideReplays: false };
    const STYLE_ID = 'ytc-styles-replays';
    const HIDDEN_CLASS = 'ytc-hide-replay-item';

    const SUBS_PAGE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]';
    const ITEM_SELECTOR = 'ytd-rich-item-renderer';
    const META_SELECTOR =
        '.inline-metadata-item.ytd-video-meta-block, ' +
        'yt-content-metadata-view-model span';
    const REPLAY_PREFIX = 'Streamed '; // English YouTube only

    const STYLES = `
        ${ITEM_SELECTOR}.${HIDDEN_CLASS} {
            display: none !important;
        }
    `;

    let observer = null;
    let scheduled = false;
    const pendingItems = new Set();

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.documentElement.appendChild(style);
    }

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

    function flushPending() {
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
            if (item.classList.contains(HIDDEN_CLASS)) continue;
            if (isReplayItem(item)) item.classList.add(HIDDEN_CLASS);
        }
        pendingItems.clear();
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
        if (!observer) return;
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse) return;
        browse.querySelectorAll(ITEM_SELECTOR)
            .forEach(item => pendingItems.add(item));
        scheduleFlush();
    }

    function startObserver() {
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

    function stopObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        pendingItems.clear();
        document.querySelectorAll('.' + HIDDEN_CLASS)
            .forEach(el => el.classList.remove(HIDDEN_CLASS));
    }

    function apply(settings) {
        if (settings.hideReplays) {
            startObserver();
            scanAll();
        } else {
            stopObserver();
        }
    }

    function loadAndApply() {
        chrome.storage.sync.get(DEFAULTS)
            .then(apply)
            .catch(err => console.warn('[YouTube Tweaks] hide-live-replays: settings not applied', err));
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (Object.keys(changes).some(k => k in DEFAULTS)) loadAndApply();
    });

    window.addEventListener('yt-navigate-finish', scanAll);

    injectStyles();
    loadAndApply();
})();
