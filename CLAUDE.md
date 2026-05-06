# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**YouTube Tweaks** is a Manifest V3 Chrome extension with five independent toggles in a popup: four hide YouTube clutter (Shorts / live streams / past live replays / the "Most relevant" Subscriptions shelf), one **acts** on the user's account (auto-like videos from subscribed channels after `AUTOLIKE_THRESHOLD_S` seconds of actual play time — currently 2). There is **no build system, no package manager, no test suite, and no lint config** — every file is shipped as-is to Chrome.

(The folder is still named `youtube-cleaner` from the project's earlier identity. The `manifest.json` `name` field is the canonical display name; the folder rename was kept out of scope to avoid forcing a re-pin of the unpacked extension.)

## Working on the extension

- **Reload after edits**: visit `chrome://extensions` → enable Developer mode → "Load unpacked" pointing at this folder. Subsequent edits require clicking the reload icon on the extension card; a YouTube tab refresh is also needed because the content script runs at `document_start`.
- **Regenerate icons** (only after editing `scripts/make_icons.py`): `python3 scripts/make_icons.py` — needs Pillow (`pip install pillow`). Writes `icons/icon{16,48,128}.png`.
- **Debug content script**: open DevTools on a youtube.com tab; logs/errors from each `content/<feature>.js` appear in the page console (filter by source filename to isolate a single feature).
- **Debug popup**: right-click the toolbar icon → "Inspect popup".

## Architecture

**One feature = one file.** Each toggle owns a single content script under `content/`, listed independently in `manifest.json`. There is **no shared module, no central registry, no `applyAll`**. Each script is an IIFE that:

1. Declares its own `DEFAULTS` object listing only the storage keys it cares about.
2. Reads those keys via `chrome.storage.sync.get(DEFAULTS)`.
3. Listens to `chrome.storage.onChanged` and re-applies *only when one of its own keys changed* (guard: `Object.keys(changes).some(k => k in DEFAULTS)`). Sibling toggles don't trigger anything.
4. Owns its own DOM side-effects (CSS injection, MutationObserver, setInterval) and cleans them up entirely on toggle-off.

**The popup is also stateless** — `popup.js` derives the toggle list from `data-setting` attributes in `popup.html` and writes to `chrome.storage.sync` on change. No code synchronization is required between `popup.js` and content scripts.

State direction is one-way: **popup writes, content scripts read**. They never message each other.

Three mechanisms are in use, mapped to specific files:

1. **CSS-only — `hide-shorts.js`, `hide-live-streams.js`.** YouTube exposes DOM attributes/classes that pin these items down. Each script injects its own `<style id="ytc-styles-<feature>">` once at boot, with selectors gated on a class on `<html>` (`ytc-hide-shorts`, `ytc-hide-live`). Toggling is a single `classList.toggle()` on the root element. Keep both the legacy attribute forms (`[overlay-style="LIVE"]`, `[overlay-style="SHORTS"]`) and the newer `badge-shape-wiz--thumbnail-live` / `yt-lockup-view-model` forms; YouTube ships them in parallel during rollouts.

2. **JS-marked + CSS — `hide-live-replays.js`, `hide-most-relevant-shelf.js`.** Neither past live replays nor the "Most relevant" shelf has a DOM attribute that distinguishes them; they're identified by metadata/header text (English only — `REPLAY_PREFIX` in `hide-live-replays.js`, `RELEVANT_LABELS` in `hide-most-relevant-shelf.js`). Each script owns its own `MutationObserver` (started only while its toggle is on) that watches `document.documentElement` with `childList + subtree + characterData`. `collectFromMutations` translates `MutationRecord`s into a pending set (added subtrees + the closest matching ancestor of any `characterData` target — text fills in lazily after node insertion), drained on a `requestAnimationFrame` tick. A **full sweep** runs at toggle-on and on `yt-navigate-finish` (SPA navigation). The two scripts intentionally do not share an observer — full independence is the whole point of the file split. Cost: two observer callbacks per mutation when both toggles are on, vs one. Negligible.

3. **Action via interval — `auto-like.js`.** The only feature that *acts* on the user's account rather than hiding DOM. While the toggle is on, a 1-Hz `setInterval` increments a `watchedSeconds` counter only when the `<video>` element is actually playing (so seeks and pauses don't count). It detects SPA navigation between videos by comparing the URL's `v=` param against `lastTickVideoId` and resets the counter on change. At `AUTOLIKE_THRESHOLD_S` (2 by default), it reads three DOM states — subscribe (`ytd-subscribe-button-renderer[subscribed]` or `aria-pressed="true"`), like, dislike — and clicks Like at most once per video (`actedOnVideoId` guard). Skips when the user has explicitly disliked. No API call. Selectors are the part most likely to break on a YouTube redesign; `findLikeButton`, `findDislikeButton`, `isSubscribedHere` are the surgery points.

When a filter stops working after a YouTube redesign, the fix path differs by mechanism: for `hide-shorts.js`/`hide-live-streams.js`, find the new attribute or class on a thumbnail badge and add a selector to that file's `STYLES`; for `hide-live-replays.js`/`hide-most-relevant-shelf.js`, check whether the metadata text constants (`REPLAY_PREFIX`, `RELEVANT_LABELS`) still match what YouTube renders; for `auto-like.js`, inspect the like/dislike/subscribe buttons and update the selectors there.

## Adding a new feature

1. Create `content/<verb>-<thing>.js` (verb-prefixed kebab-case, e.g. `hide-comments.js`, `auto-skip-ads.js`) following the IIFE skeleton in any existing content file. Pick the closest existing file as a template:
   - CSS-only filter → start from `hide-shorts.js` (smaller) or `hide-live-streams.js`.
   - JS-marked filter (text-based identification, marker class) → start from `hide-live-replays.js` or `hide-most-relevant-shelf.js`.
   - Action / DOM mutation → start from `auto-like.js`.
2. Add the path to `manifest.json` `content_scripts[0].js`. Order doesn't affect behavior.
3. Add a `<label class="row">` in `popup.html` with a unique `data-setting` attribute matching the new key. The popup picks it up automatically — no `popup.js` edit needed.
4. Reload the extension at `chrome://extensions` and refresh a YouTube tab to test.

No central object, no `STORAGE_DEFAULTS` to update, no `applyAll` dispatch table.

## Constraints worth remembering

- **Least privilege on permissions.** `manifest.json` requests only `storage` and `https://www.youtube.com/*`. Do not broaden these without a concrete reason — and prefer `optional_permissions` + `chrome.permissions.request()` if a future feature ever needs more. The extension's value is its minimal permission surface.
- **No remote code (MV3 requirement).** All JS must live in this folder. No `eval`, no `new Function`, no `<script src="https://…">`, no dynamic `import()` from a URL. Anything that looks like loading external code is both a CSP violation and a Web Store policy violation.
- **`run_at: "document_start"` is load-bearing.** The stylesheet must be injected before YouTube paints, otherwise unfiltered Shorts/live items flash on screen before being hidden. Don't move script execution later (e.g. `document_idle`) without redesigning the no-FOUC story.
- **Content script runs in the page's DOM context — treat YouTube's DOM as untrusted input.** The current code only ever reads with `textContent` and mutates with `classList` — keep it that way. Never use `innerHTML` (or `insertAdjacentHTML`, etc.) with strings derived from page nodes; if HTML construction is ever needed, build it with the DOM API.
- **Storage API choice is intentional.** `chrome.storage.sync` (not `local`) so settings follow the user's Chrome profile across machines; the ~100 KB quota is plenty for three booleans. Never use `localStorage` here — it's not available from a service worker context (none today, but keep the door open) and isn't synced.
- **No central settings registry.** Each `content/<feature>.js` declares its own `DEFAULTS` slice. The popup derives the union from `data-setting` attributes on `popup.html`. There is no canonical list of all keys anywhere — this is intentional and lets you add features without editing a shared object.
- `REPLAY_PREFIX` (in `content/hide-live-replays.js`) and `RELEVANT_LABELS` (in `content/hide-most-relevant-shelf.js`) assume English YouTube. Non-English users edit the source — accepted limitation, documented in README.

## After a validated change

Once the user validates a change (a feature lands, a refactor is approved, a fix is confirmed working), update **both** this file and `README.md` to describe the new steady state — not a stale picture. The parts that drift fastest: the toggle list / count, the architecture summary, the per-file responsibilities, and the English-only constants (`REPLAY_PREFIX` in `content/hide-live-replays.js`, `RELEVANT_LABELS` in `content/hide-most-relevant-shelf.js`). There is no docs CI, so keeping these in sync with the code is part of "done."

## Out of scope (intentionally)

This is a small personal extension, not a Web Store product. Do **not** introduce, unless explicitly asked: a build system or bundler, TypeScript, a framework (WXT/Plasmo), tests/CI, multi-browser polyfills, a service worker, message passing, or analytics. Each addition has a real maintenance cost and the project's appeal is that there is none.
