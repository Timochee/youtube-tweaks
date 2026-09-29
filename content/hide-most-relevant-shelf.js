// ============================================================================
// Hide "Most relevant" shelf — JS-marked filter (Subscriptions only)
// ============================================================================
// YouTube's algorithmic shelf at the top of Subscriptions has no DOM
// attribute marking it. The only signal is the section header text
// "Most relevant" (English only — edit RELEVANT_LABELS for other locales).
//
// Mirror of replays.js but watching ytd-rich-section-renderer instead of
// individual items. Self-contained MutationObserver, started only while
// the toggle is on. Toggling off removes the marker class.
// ============================================================================

(function () {
    'use strict';

    const DEFAULTS = { hideRelevant: false };
    const STYLE_ID = 'ytc-styles-relevant';
    const HIDDEN_CLASS = 'ytc-hide-relevant-section';

    const SUBS_PAGE_SELECTOR = 'ytd-browse[page-subtype="subscriptions"]';
    const SECTION_SELECTOR = 'ytd-rich-section-renderer';
    const RELEVANT_LABELS = ['Most relevant']; // English YouTube only

    const STYLES = `
        ${SECTION_SELECTOR}.${HIDDEN_CLASS} {
            display: none !important;
        }
    `;

    let observer = null;
    let scheduled = false;
    const pendingSections = new Set();

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.documentElement.appendChild(style);
    }

    function isRelevantSection(section) {
        // Section header text lives in the first descendant #title (the shelf
        // header). Nested video titles share the id but appear deeper, so the
        // first match in document order is the shelf-level one.
        const titleEl = section.querySelector('#title');
        if (!titleEl) return false;
        const text = (titleEl.textContent || '').trim();
        return RELEVANT_LABELS.includes(text);
    }

    function collectFromMutations(mutations) {
        for (const m of mutations) {
            if (m.type === 'characterData') {
                const parent = m.target.parentElement;
                const section = parent && parent.closest(SECTION_SELECTOR);
                if (section) pendingSections.add(section);
                continue;
            }
            for (const node of m.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                if (node.matches(SECTION_SELECTOR)) {
                    pendingSections.add(node);
                } else {
                    node.querySelectorAll(SECTION_SELECTOR)
                        .forEach(section => pendingSections.add(section));
                }
            }
        }
    }

    function flushPending() {
        if (!observer) {
            pendingSections.clear();
            return;
        }
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse || browse.hasAttribute('hidden')) {
            pendingSections.clear();
            return;
        }
        for (const section of pendingSections) {
            if (!browse.contains(section)) continue;
            if (section.classList.contains(HIDDEN_CLASS)) continue;
            if (isRelevantSection(section)) section.classList.add(HIDDEN_CLASS);
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
        if (!observer) return;
        const browse = document.querySelector(SUBS_PAGE_SELECTOR);
        if (!browse) return;
        browse.querySelectorAll(SECTION_SELECTOR)
            .forEach(section => pendingSections.add(section));
        scheduleFlush();
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver(mutations => {
            const before = pendingSections.size;
            collectFromMutations(mutations);
            if (pendingSections.size !== before) scheduleFlush();
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
        pendingSections.clear();
        document.querySelectorAll('.' + HIDDEN_CLASS)
            .forEach(el => el.classList.remove(HIDDEN_CLASS));
    }

    function apply(settings) {
        if (settings.hideRelevant) {
            startObserver();
            scanAll();
        } else {
            stopObserver();
        }
    }

    function loadAndApply() {
        chrome.storage.sync.get(DEFAULTS)
            .then(apply)
            .catch(err => console.warn('[YouTube Tweaks] hide-most-relevant-shelf: settings not applied', err));
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
        if (Object.keys(changes).some(k => k in DEFAULTS)) loadAndApply();
    });

    window.addEventListener('yt-navigate-finish', scanAll);

    injectStyles();
    loadAndApply();
})();
