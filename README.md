# YouTube Cleaner

A tiny Chrome extension to tweak YouTube. Five independent toggles — four
cleanup filters and one action — no account, no telemetry, no settings
beyond the popup.

## What it hides

| Filter | Where it applies |
|---|---|
| **Shorts** | All YouTube pages (feed items, shelves, sidebar entries, search results) |
| **Live streams** | Subscriptions and Home feeds (currently-live items only) |
| **Live replays** | Subscriptions feed (videos labelled *"Streamed X ago"*) |
| **"Most relevant" shelf** | Subscriptions feed (the algorithmic shelf at the top) |

## What it does

| Action | Where it applies |
|---|---|
| **Auto-like** | `/watch` pages, only on channels you're subscribed to, after 2 seconds of actual play time. Skips videos you've already liked or disliked. |

Each filter is off by default — toggle the ones you want from the extension
popup. Settings sync across Chrome installs via `chrome.storage.sync`.

## How it works

For Shorts and live streams, the extension injects a single CSS stylesheet
that targets YouTube's component classes (`overlay-style="SHORTS"`, the new
`badge-shape-wiz--thumbnail-live` for live, etc.). Toggling a filter just
adds or removes a class on `<html>` — no DOM walking, no per-item JavaScript.

Past live replays and the "Most relevant" shelf are different: YouTube
exposes no DOM attribute that distinguishes them from neighbouring items.
The only available signals are the metadata text `Streamed X ago` for
replays, and the section header text `Most relevant` for the shelf. A
single `MutationObserver` scans new feed items / sections as they're
inserted and adds a marker class to matches. The observer is started only
while at least one of those two toggles is on.

Auto-like is the one feature that *acts* rather than hides. It runs a 1-Hz
interval on `/watch` pages, accumulates only seconds where the `<video>`
element is actually playing (so seeks and pauses don't count), and at the
`AUTOLIKE_THRESHOLD_S` mark (2 seconds by default) reads the Subscribe
button state and the Like/Dislike button states from the DOM. If the
channel is subscribed and the user hasn't already liked or disliked, it
clicks Like exactly once per video. No API call is made — every signal
comes from on-page DOM.

The Shorts and Live filters mostly target DOM attributes (`overlay-style`,
`badge-shape-wiz--thumbnail-live`, etc.) and `/shorts` URLs, with the
English label attributes (`title="Shorts"`, `aria-label="Shorts"`) kept as
extra fallbacks so the filters still work on the renderer variants where
URL-based matching falls short. The replay and "Most relevant" filters
are English-only: they match the metadata prefix `Streamed ` and the
section title `Most relevant` respectively. If your interface is in
another language, edit `REPLAY_PREFIX` and `RELEVANT_LABELS` in
`content.js` (e.g. `Diffusé en direct ` for French replays).

## Installing the unpacked extension

1. Open `chrome://extensions` (or `arc://extensions` for Arc).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked**.
4. Select the `youtube-cleaner` folder.
5. Pin the extension to the toolbar so the popup is one click away.

The folder needs to stay where you put it — Chrome reads from the path you
loaded. If you move or delete the folder, the extension breaks.

## Project layout

```
youtube-cleaner/
├── manifest.json        Manifest V3
├── content.js           Filter logic injected into youtube.com pages
├── popup.html           Three-toggle popup UI
├── popup.css            Popup styling (light/dark via prefers-color-scheme)
├── popup.js             Reads/writes settings to chrome.storage.sync
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── scripts/
    └── make_icons.py    Regenerates the three PNG icons from code
```

## Updating after YouTube redesigns

YouTube changes its DOM regularly. If a filter stops working:

- **Shorts / Live**: open DevTools on a video item that should be hidden,
  inspect the thumbnail badge, find the new attribute or class, and add a
  selector to the relevant rule in `content.js`.
- **Replays**: find a replay item whose metadata you can see (something
  like *"Streamed 2 hours ago"*), check whether the prefix has changed, and
  update `REPLAY_PREFIX`.

The selectors in this extension were cross-checked against an actively-
maintained uBlock filter list as of early 2026, but the moment YouTube
ships a new lockup variant the rules may need a refresh.
