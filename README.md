# YouTube Tweaks

A tiny Chrome extension that tweaks YouTube to your taste. Six
independent toggles — four cleanup filters and two actions — no account,
no telemetry, no settings beyond the popup.

## What it hides

| Filter | Where it applies |
|---|---|
| **Shorts** | All YouTube pages (feed items, shelves, sidebar entries, search results, channel-page tab) |
| **Live streams** | Subscriptions and Home feeds (currently-live items only) |
| **Live replays** | Subscriptions feed (videos labelled *"Streamed X ago"*) |
| **"Most relevant" shelf** | Subscriptions feed (the algorithmic shelf at the top) |

## What it does

| Action | Where it applies |
|---|---|
| **Auto-like** | `/watch` pages, only on channels you're subscribed to, after 2 seconds of actual play time. Skips videos you've already liked or disliked. |
| **Disable autoplay** | `/watch` pages. On each page load (and SPA navigation between videos), if the player's autoplay toggle is on, click it once to turn it off. |

Each filter is off by default — toggle the ones you want from the extension
popup. Settings sync across Chrome installs via `chrome.storage.sync`.

## How it works

Each toggle lives in its own content script under `content/`. They run
independently — there's no shared module, no central state, no
coordination. Each script reads only its own keys from
`chrome.storage.sync`, owns its own DOM side-effects, and cleans up when
toggled off. Adding a feature is one new file plus one row in the popup.

For Shorts and live streams (`content/hide-shorts.js`,
`content/hide-live-streams.js`), each script injects its own CSS
stylesheet that targets YouTube's component classes
(`overlay-style="SHORTS"`, the new `badge-shape-wiz--thumbnail-live` for
live, etc.). Toggling a filter just adds or removes a class on `<html>`
— no DOM walking, no per-item JS.

Past live replays (`content/hide-live-replays.js`) and the "Most relevant"
shelf (`content/hide-most-relevant-shelf.js`) are different: YouTube
exposes no DOM attribute that distinguishes them. The only signals are
the metadata text `Streamed X ago` for replays and the section header
text `Most relevant` for the shelf. Each script owns its own
`MutationObserver` (started only while its toggle is on) that scans
newly-inserted items/sections and adds a marker class to matches.

Auto-like (`content/auto-like.js`) and disable-autoplay
(`content/disable-autoplay.js`) are the two features that *act* rather
than hide. Auto-like runs a 1-Hz interval on `/watch` pages, accumulates
only seconds where the `<video>` element is actually playing (so seeks
and pauses don't count), and at the `AUTOLIKE_THRESHOLD_S` mark (2
seconds by default) reads the Subscribe button state and the Like/Dislike
button states from the DOM. If the channel is subscribed and the user
hasn't already liked or disliked, it clicks Like exactly once per video.
Disable-autoplay polls every 250 ms (up to 5 s deadline) for the player's
autoplay toggle to mount, then clicks it once if currently on. The poll
re-arms on every SPA navigation to a new video. No API call — every
signal comes from on-page DOM.

The Shorts and Live filters mostly target DOM attributes (`overlay-style`,
`badge-shape-wiz--thumbnail-live`, etc.) and `/shorts` URLs, with the
English label attributes (`title="Shorts"`, `aria-label="Shorts"`) kept as
extra fallbacks so the filters still work on the renderer variants where
URL-based matching falls short. The replay and "Most relevant" filters
are English-only: they match the metadata prefix `Streamed ` and the
section title `Most relevant` respectively. If your interface is in
another language, edit `REPLAY_PREFIX` in `content/hide-live-replays.js`
and `RELEVANT_LABELS` in `content/hide-most-relevant-shelf.js` (e.g.
`Diffusé en direct ` for French replays).

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
├── content/                          One content script per toggle (loaded independently)
│   ├── hide-shorts.js                CSS-only — hides Shorts everywhere
│   ├── hide-live-streams.js          CSS-only — hides live streams (Subs/Home)
│   ├── hide-live-replays.js          MutationObserver — hides "Streamed X ago" items
│   ├── hide-most-relevant-shelf.js   MutationObserver — hides the "Most relevant" shelf
│   ├── auto-like.js                  Interval — auto-likes subscribed-channel videos
│   └── disable-autoplay.js           Polled-click — turns off the player's autoplay toggle
├── popup.html           Toggle UI; toggles auto-discovered via data-setting
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

YouTube changes its DOM regularly. If a filter stops working, edit the
corresponding `content/<feature>.js`:

- **Shorts / Live** (`content/hide-shorts.js`,
  `content/hide-live-streams.js`): open DevTools on an item that should
  be hidden, inspect the thumbnail badge, find the new attribute or
  class, and add a selector to the file's `STYLES`.
- **Replays** (`content/hide-live-replays.js`): find a replay item whose
  metadata you can see (something like *"Streamed 2 hours ago"*), check
  whether the prefix has changed, and update `REPLAY_PREFIX`.
- **"Most relevant"** (`content/hide-most-relevant-shelf.js`): inspect
  the section header, check that the label still reads `Most relevant`,
  and adjust `RELEVANT_LABELS` if needed.
- **Auto-like** (`content/auto-like.js`): if no like fires, inspect the
  Like / Dislike / Subscribe buttons on a `/watch` page and update the
  selectors in `findLikeButton`, `findDislikeButton`, `isSubscribedHere`.
- **Disable autoplay** (`content/disable-autoplay.js`): if autoplay is
  not turned off, inspect the player's autoplay toggle and update
  `TOGGLE_STATE_SELECTOR` to match the new aria-checked-bearing element.

The selectors in this extension were cross-checked against an actively-
maintained uBlock filter list as of early 2026, but the moment YouTube
ships a new lockup variant the rules may need a refresh.
