# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that hides three categories of YouTube clutter (Shorts / live streams / past live replays) via three independent toggles in a popup. There is **no build system, no package manager, no test suite, and no lint config** — every file is shipped as-is to Chrome.

## Working on the extension

- **Reload after edits**: visit `chrome://extensions` → enable Developer mode → "Load unpacked" pointing at this folder. Subsequent edits require clicking the reload icon on the extension card; a YouTube tab refresh is also needed because the content script runs at `document_start`.
- **Regenerate icons** (only after editing `scripts/make_icons.py`): `python3 scripts/make_icons.py` — needs Pillow (`pip install pillow`). Writes `icons/icon{16,48,128}.png`.
- **Debug content script**: open DevTools on a youtube.com tab; logs/errors from `content.js` appear in the page console.
- **Debug popup**: right-click the toolbar icon → "Inspect popup".

## Architecture

The split between `content.js` and `popup.js` is deliberately one-way and stateless: **the popup only writes to `chrome.storage.sync`; the content script only reads from it**. They never message each other. State propagates through `chrome.storage.onChanged`, which means new tabs and existing tabs converge on the same settings without extra wiring.

Inside `content.js`, the three filters use **two different mechanisms** depending on whether YouTube exposes a DOM signal:

1. **Shorts and live streams — pure CSS.** A single `<style>` is injected once at `document_start`. All selectors are gated on classes on `<html>` (`ytc-hide-shorts`, `ytc-hide-live`). Toggling a filter is a single `classList.toggle()` call on the root element — no DOM walking, no observers, no per-item work. When updating these selectors, keep both the legacy attribute form (`[overlay-style="LIVE"]`, `[overlay-style="SHORTS"]`) and the newer `badge-shape-wiz--thumbnail-live` / `yt-lockup-view-model` forms; YouTube ships them in parallel during rollouts.

2. **Past live replays — `MutationObserver`.** YouTube exposes no DOM attribute distinguishing a replay from a regular video. The only signal is the metadata text starting with `"Streamed "` (English only — controlled by `REPLAY_PREFIX` in `content.js`). The observer is **only started when the toggle is on**, and `stopReplayObserver()` removes the marker class from previously-hidden items so toggling off restores the page without reload. Processing is **incremental**: `collectFromMutations` translates `MutationRecord`s into a `pendingItems` set (added subtrees + the closest `ytd-rich-item-renderer` of any `characterData` target — metadata text fills in lazily after insertion). The set is drained on a `requestAnimationFrame` tick. A **full sweep** is only done at toggle-on and on `yt-navigate-finish` (SPA navigation), where there's no mutation record to lean on.

When a filter stops working after a YouTube redesign, the fix path differs by mechanism: for Shorts/Live, find the new attribute or class on a thumbnail badge and add a selector to `STYLES`; for replays, check whether the `"Streamed "` metadata prefix has changed.

## Constraints worth remembering

- **Least privilege on permissions.** `manifest.json` requests only `storage` and `https://www.youtube.com/*`. Do not broaden these without a concrete reason — and prefer `optional_permissions` + `chrome.permissions.request()` if a future feature ever needs more. The extension's value is its minimal permission surface.
- **No remote code (MV3 requirement).** All JS must live in this folder. No `eval`, no `new Function`, no `<script src="https://…">`, no dynamic `import()` from a URL. Anything that looks like loading external code is both a CSP violation and a Web Store policy violation.
- **`run_at: "document_start"` is load-bearing.** The stylesheet must be injected before YouTube paints, otherwise unfiltered Shorts/live items flash on screen before being hidden. Don't move script execution later (e.g. `document_idle`) without redesigning the no-FOUC story.
- **Content script runs in the page's DOM context — treat YouTube's DOM as untrusted input.** The current code only ever reads with `textContent` and mutates with `classList` — keep it that way. Never use `innerHTML` (or `insertAdjacentHTML`, etc.) with strings derived from page nodes; if HTML construction is ever needed, build it with the DOM API.
- **Storage API choice is intentional.** `chrome.storage.sync` (not `local`) so settings follow the user's Chrome profile across machines; the ~100 KB quota is plenty for three booleans. Never use `localStorage` here — it's not available from a service worker context (none today, but keep the door open) and isn't synced.
- `STORAGE_DEFAULTS` is duplicated in `content.js` and `popup.js` (as `DEFAULTS`). Keep them in sync when adding a new toggle.
- `REPLAY_PREFIX` assumes English YouTube. Non-English users currently need to edit the source — this is documented in the README as an accepted limitation.

## Out of scope (intentionally)

This is a small personal extension, not a Web Store product. Do **not** introduce, unless explicitly asked: a build system or bundler, TypeScript, a framework (WXT/Plasmo), tests/CI, multi-browser polyfills, a service worker, message passing, or analytics. Each addition has a real maintenance cost and the project's appeal is that there is none.
