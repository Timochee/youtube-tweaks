# YouTube Cleaner

A tiny Chrome extension to declutter YouTube. Three independent toggles, no
account, no telemetry, no settings beyond the popup.

## What it hides

| Filter | Where it applies |
|---|---|
| **Shorts** | All YouTube pages (feed items, shelves, sidebar entries, search results) |
| **Live streams** | Subscriptions and Home feeds (currently-live items only) |
| **Live replays** | Subscriptions feed (videos labelled *"Streamed X ago"*) |

Each filter is off by default — toggle the ones you want from the extension
popup. Settings sync across Chrome installs via `chrome.storage.sync`.

## How it works

For Shorts and live streams, the extension injects a single CSS stylesheet
that targets YouTube's component classes (`overlay-style="SHORTS"`, the new
`badge-shape-wiz--thumbnail-live` for live, etc.). Toggling a filter just
adds or removes a class on `<html>` — no DOM walking, no per-item JavaScript.

Past live replays are different: YouTube exposes no DOM attribute that
distinguishes them from regular videos. The only available signal is the
metadata text `Streamed X ago`, which means we need a small `MutationObserver`
that scans new feed items as they're inserted. That observer is started only
when the corresponding toggle is on.

The extension assumes English YouTube. If your interface is in another
language, edit `REPLAY_PREFIX` in `content.js` (e.g. `Diffusé en direct ` for
French — though uBlock filter lists confirm English is the default match
worldwide for this metadata format).

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
