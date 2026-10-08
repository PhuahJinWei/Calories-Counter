# Calorie Tracker (iPhone web app)

A small offline app for logging daily calories and body weight.
All data is stored **on your iPhone** (IndexedDB inside the Home Screen app). Nothing is sent to a server.

## Files

| File | Purpose |
|---|---|
| `index.html` | The screens (Today, History, Settings) |
| `styles.css` | Look & feel (light + dark mode) |
| `app.js` | App logic: logging, history chart, backup/restore |
| `db.js` | On-device database (IndexedDB) |
| `sw.js` | Service worker: lets the app open with no internet |
| `manifest.webmanifest`, `icons/` | App name and Home Screen icon |

## One-time setup: put it on your iPhone

An iPhone can only install a web app from an `https://` address, so the files need to be hosted once.
This only serves the **code**. Your entries never leave the phone.

### 1. Host the files on GitHub Pages (free)

1. Sign in at <https://github.com> (create a free account if needed).
2. Click **New repository**, name it e.g. `calorie-tracker`, set it to **Public**, and click **Create repository**.
3. Click **uploading an existing file**. Drag in `index.html`, `styles.css`, `app.js`, `db.js`, `sw.js`,
   `manifest.webmanifest` and the whole `icons` folder. You don't need to upload `README.md` or `.claude`.
   Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and click **Save**.
5. After a minute or so the page shows your address: `https://<your-username>.github.io/calorie-tracker/`

### 2. Install it on the iPhone

1. Open that address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open the app **from the new Home Screen icon** (not from Safari) and go to **Settings → Storage**.
   It should say *Installed to Home Screen: Yes*. *Persistent storage* should normally say *Granted*.

After that, the app works fully offline. You'll only need the internet again when you update it.

## Keeping your data safe

- **The Home Screen app and Safari keep separate data.** Always use the icon.
- **Removing the app icon deletes its data.** Export a backup first.
- **Back up regularly:** Settings → *Export backup (JSON)* → **Save to Files** → iCloud Drive.
  The Today screen reminds you if your last backup is more than 7 days old.
- **To restore** (new phone, or after reinstalling): Settings → *Restore from backup…* and pick the JSON file.
  This replaces what is currently in the app.
- **Keep the same web address.** Data is tied to the address. If you ever move hosts, export first,
  install from the new address, then restore.
- *Export spreadsheet (CSV)* gives a daily summary (date, total kcal, entries, weight) for Excel or Numbers.
  It is not a full backup, so use the JSON export for that.

## Updating the app later

1. Edit the files.
2. In `sw.js`, bump `CACHE_VERSION` (e.g. `'v1'` → `'v2'`). Without this, phones keep the old cached version.
3. Upload the changed files to the GitHub repository again.
4. On the iPhone, open the app once with internet. The update downloads in the background
   and takes effect the next time you open the app. Your data is not affected.
