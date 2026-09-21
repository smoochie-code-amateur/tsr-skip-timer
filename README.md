# 📂 TSR Skip Download Timer

A Chromium (Manifest V3) extension for automatically downloading free files from **The Sims Resource** without manually waiting for the download countdown timer or dealing with "log in / leave your email" modals. Works in the guest flow — no account needed.

## Features

- **No timer, no navigation.** When you click Download on an item page, the extension intercepts the click, so the site's countdown page is never shown. The download starts automatically through the browser's download manager.
- **Silent pre-warming.** While you hover over or browse the page, the extension quietly starts the server-side countdown. If at least ~8 seconds have passed by the time you click, the file downloads instantly. If you click sooner, the remaining seconds pass invisibly and the download still starts on its own — no visible countdown digits, no clicks, no redirects.
- **Modal auto-dismissal.** Email request, "continue downloading" CTA, adblock notice, free sign-up and guest-limit login modals are closed automatically.
- **Guest mode toggle.** Resets the "5 guest downloads" session counter so you can keep downloading without an account.
- **On-screen status.** A small overlay reports progress and errors (e.g. VIP-exclusive files).

## How it works

The extension uses the same endpoints the site uses for guests:

1. `initDownload` returns a download `ticket` for the item.
2. Visiting the countdown URL sets the session cookie and starts the server's timer.
3. `getdownloadurl` returns the real file URL once the server releases it, and the extension hands the
   URL to `chrome.downloads.download`.

The ~8 second delay is enforced **server-side**: the file URL is only issued ~8 seconds after the countdown page is opened. Testing showed pre-made or older tickets do not bypass it, so a literally zero-second download is not possible — but the timer UI and interaction are removed entirely.

## Installation

1. Download/export this folder (must contain `manifest.json`).
2. Open `chrome://extensions` (or `edge://extensions` in Edge, `brave://extensions` in Brave) of just Three Dots -> Extensions.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extension folder.

## Usage

- Navigate to any free item page on The Sims Resource.
- Click **Download**.
- The file is saved by the browser's download manager automatically (you can browse any other pages while this is happening).

## Settings

Right-click the extension icon → **Options**:

- **Enabled** — toggle the whole extension on/off.
- **Guest mode** — reset the guest download counter and dismiss login/email prompts.

Settings are stored in `chrome.storage.local` under the key `tsrSkipSettings`.

## Limitations

- **VIP-exclusive / paid content is not bypassed.** The extension shows a warning and stops.
- A captcha page, if shown, must still be solved manually.
- The server keeps a short (about 8 s) gate after the countdown starts; this cannot be skipped client-side.
- The final file name comes from the server and may be generic (e.g. `file.zip`).

## Files

- `manifest.json` — extension manifest (MV3).
- `content.js` — page logic: click interception, pre-warming, URL polling, modal handling, overlay.
- `background.js` — receives the file URL and starts the browser download.
- `options.html` / `options.js` — settings page.
- `icons/` — extension icons.
