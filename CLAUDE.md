# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension with five independent toggles in a popup: four hide YouTube clutter (Shorts / live streams / past live replays / the "Most relevant" Subscriptions shelf), one **acts** on the user's account (auto-like videos from subscribed channels after `AUTOLIKE_THRESHOLD_S` seconds of actual play time — currently 2). There is **no build system, no package manager, no test suite, and no lint config** — every file is shipped as-is to Chrome.

## Working on the extension

- **Reload after edits**: visit `chrome://extensions` → enable Developer mode → "Load unpacked" pointing at this folder. Subsequent edits require clicking the reload icon on the extension card; a YouTube tab refresh is also needed because the content script runs at `document_start`.
- **Regenerate icons** (only after editing `scripts/make_icons.py`): `python3 scripts/make_icons.py` — needs Pillow (`pip install pillow`). Writes `icons/icon{16,48,128}.png`.
- **Debug content script**: open DevTools on a youtube.com tab; logs/errors from `content.js` appear in the page console.
- **Debug popup**: right-click the toolbar icon → "Inspect popup".

## Architecture

The split between `content.js` and `popup.js` is deliberately one-way and stateless: **the popup only writes to `chrome.storage.sync`; the content script only reads from it**. They never message each other. State propagates through `chrome.storage.onChanged`, which means new tabs and existing tabs converge on the same settings without extra wiring.

Inside `content.js`, the three filters use **two different mechanisms** depending on whether YouTube exposes a DOM signal:

1. **Shorts and live streams — pure CSS.** A single `<style>` is injected once at `document_start`. All selectors are gated on classes on `<html>` (`ytc-hide-shorts`, `ytc-hide-live`). Toggling a filter is a single `classList.toggle()` call on the root element — no DOM walking, no observers, no per-item work. When updating these selectors, keep both the legacy attribute form (`[overlay-style="LIVE"]`, `[overlay-style="SHORTS"]`) and the newer `badge-shape-wiz--thumbnail-live` / `yt-lockup-view-model` forms; YouTube ships them in parallel during rollouts.

2. **Past live replays + "Most relevant" shelf — shared `MutationObserver`.** Neither has a DOM attribute that distinguishes them; both are identified by header/metadata text (English-only — `REPLAY_PREFIX` and `RELEVANT_LABELS` in `content.js`). They share **one** observer to avoid double-watching the document. Each filter has its own `pending*` set, predicate (`isReplayItem`, `isRelevantSection`), and marker class (`ytc-hide-replay-item` on `ytd-rich-item-renderer`, `ytc-hide-relevant-section` on `ytd-rich-section-renderer`). The observer runs while at least one of the two toggles is on; turning a toggle off removes that filter's markers so the page reflects the new state without reload. Processing is **incremental**: `collectFromMutations` translates `MutationRecord`s into the pending sets (added subtrees + the closest matching ancestor of any `characterData` target — text fills in lazily after node insertion), drained on a `requestAnimationFrame` tick. A **full sweep** runs at toggle-on and on `yt-navigate-finish` (SPA navigation), where there's no mutation record to lean on.

3. **Auto-like — 1-Hz polling interval on `/watch`.** The only feature that *performs an action* rather than hides DOM. While the toggle is on, an interval ticks once per second; each tick increments a `watchedSeconds` counter only when the `<video>` element is actually playing (so seeks and pauses don't count). The interval also detects SPA navigation between videos by comparing the URL's `v=` param against `lastTickVideoId` and resets the counter on change. At the `AUTOLIKE_THRESHOLD_S` threshold (2 seconds by default) it reads three pieces of DOM state: subscribe-button state (`ytd-subscribe-button-renderer[subscribed]` or `aria-pressed="true"`), like-button state, and dislike-button state. It clicks Like at most once per video (`actedOnVideoId` guard), and respects an explicit dislike by skipping. No API call — everything is on-page DOM. Selectors are the most likely to break on YouTube redesigns; `findLikeButton` / `findDislikeButton` / `isSubscribedHere` are the surgery points.

When a filter stops working after a YouTube redesign, the fix path differs by mechanism: for Shorts/Live, find the new attribute or class on a thumbnail badge and add a selector to `STYLES`; for replays, check whether the `"Streamed "` metadata prefix has changed.

## Constraints worth remembering

- **Least privilege on permissions.** `manifest.json` requests only `storage` and `https://www.youtube.com/*`. Do not broaden these without a concrete reason — and prefer `optional_permissions` + `chrome.permissions.request()` if a future feature ever needs more. The extension's value is its minimal permission surface.
- **No remote code (MV3 requirement).** All JS must live in this folder. No `eval`, no `new Function`, no `<script src="https://…">`, no dynamic `import()` from a URL. Anything that looks like loading external code is both a CSP violation and a Web Store policy violation.
- **`run_at: "document_start"` is load-bearing.** The stylesheet must be injected before YouTube paints, otherwise unfiltered Shorts/live items flash on screen before being hidden. Don't move script execution later (e.g. `document_idle`) without redesigning the no-FOUC story.
- **Content script runs in the page's DOM context — treat YouTube's DOM as untrusted input.** The current code only ever reads with `textContent` and mutates with `classList` — keep it that way. Never use `innerHTML` (or `insertAdjacentHTML`, etc.) with strings derived from page nodes; if HTML construction is ever needed, build it with the DOM API.
- **Storage API choice is intentional.** `chrome.storage.sync` (not `local`) so settings follow the user's Chrome profile across machines; the ~100 KB quota is plenty for three booleans. Never use `localStorage` here — it's not available from a service worker context (none today, but keep the door open) and isn't synced.
- `STORAGE_DEFAULTS` is duplicated in `content.js` and `popup.js` (as `DEFAULTS`). Keep them in sync when adding a new toggle.
- `REPLAY_PREFIX` assumes English YouTube. Non-English users currently need to edit the source — this is documented in the README as an accepted limitation.

## After a validated change

Once the user validates a change (a feature lands, a refactor is approved, a fix is confirmed working), update **both** this file and `README.md` to describe the new steady state — not a stale picture. The parts that drift fastest: the toggle list / count, the architecture summary, and the English-only constants (`REPLAY_PREFIX`, `RELEVANT_LABELS`). There is no docs CI, so keeping these in sync with the code is part of "done."

## Out of scope (intentionally)

This is a small personal extension, not a Web Store product. Do **not** introduce, unless explicitly asked: a build system or bundler, TypeScript, a framework (WXT/Plasmo), tests/CI, multi-browser polyfills, a service worker, message passing, or analytics. Each addition has a real maintenance cost and the project's appeal is that there is none.
