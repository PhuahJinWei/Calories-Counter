# 食事日記 / Food Diary (iPhone web app)

A small offline app for logging daily calories and body weight, made for everyday use in Japan.
All data is stored **on your iPhone** (IndexedDB inside the Home Screen app). Nothing is sent to a server.

**Language:** the app opens in Japanese on a Japanese iPhone and in English otherwise.
It can be switched at any time under その他 → 言語 / Language (More → Language).

**Light and dark:** the app follows the iPhone's Light/Dark setting by default. It can be fixed to
light or dark under その他 → 表示モード (More → Appearance). The choice is included in backups.

**Suggested daily goal:** during setup the app asks gender, age, height, weight and activity level.

- Resting calories (BMR): 国立健康・栄養研究所の式 (Ganpule et al. 2007, built from Japanese adults).
- Calories to stay the same weight = BMR × activity level (低い 1.50 / ふつう 1.75 / 高い 2.00,
  厚生労働省「日本人の食事摂取基準（2025年版）」). Losing weight subtracts 300 kcal and gaining adds 300 kcal.
  The suggestion is never below 1,200 kcal or the person's BMR.
- BMI uses the Japanese standards, not the US/WHO ones: categories from 日本肥満学会 (JASSO), where obesity starts
  at BMI 25 (not 30), and target ranges by age from the 2025 guideline (18–49: 18.5–24.9, 50–64: 20.0–24.9, 65+: 21.5–24.9).
- The app advises against losing weight when BMI is below the target range, and against gaining weight at BMI 25 or more.
  For people aged 65 and over who choose to lose weight, it shows a caution about frailty (フレイル).
- The weight entered during setup is saved as that day's weigh-in. If weight later changes by 3 kg or more,
  the Today screen offers to review the goal.

**Calorie balance (My progress):** for each week (Monday–Sunday) or month, the app adds up
"calories needed to stay the same weight − calories eaten" for every day that has food written down.
Days with nothing written down are left out rather than counted as a full deficit. The daily need is
recalculated from that day's weight. The total is also shown as body fat at 7,200 kcal ≈ 1 kg.
Without height/age/activity it compares with the daily goal instead, and says so.

**My progress layout:** one 週/月 switch and one ‹ › control the whole screen, and every number appears once.
1. Summary card: "維持カロリーより 1,878 kcal 少なめ", then average a day / days within goal / weight change.
   The week view adds a bar per day (coloured like the calendar: rose ○ within goal, amber △ over, with the
   目標 and 維持 lines labelled on the chart; tap a bar to open that day). The month view shows the calendar.
2. Weight card: today's weight, BMI (Japanese standard), the last 30 days with a kg scale and a straight trend line.
3. Steps card (only when steps were saved): average and days the target was reached, plus bars in the week view.
4. "ⓘ 計算方法について": all explanations and sources, closed by default.

Charts are plain SVG (they work offline) with text of at least 13px.

**Steps:** web apps cannot read Apple Health, so steps are typed in from the iPhone Health app (Today → 歩数を記録する).
The daily target line is from 厚生労働省「健康づくりのための身体活動・運動ガイド2023」: 8,000 steps for adults,
6,000 for people aged 65 and over. Steps are shown for information only and are not added to the calorie balance,
because the activity level chosen in setup already includes everyday walking.

All of these numbers are at the top of `app.js`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: tab bar and dialogs (the screens are drawn by `app.js`) |
| `styles.css` | Look & feel (light + dark mode) |
| `app.js` | App logic: screens (Today, My progress with the month calendar and calorie balance charts, More), adding food, weigh-ins, steps, backup/restore |
| `i18n.js` | All on-screen text, in Japanese and English. Edit wording here |
| `foods.js` | Built-in Japanese food list (with kana readings for search, English names and rough calories). Edit freely |
| `db.js` | On-device database (IndexedDB). Version 2 added the steps store; upgrades must only add stores, never remove data |
| `sw.js` | Service worker: lets the app open with no internet |
| `manifest.webmanifest`, `icons/` | App name and Home Screen icon |

## One-time setup: put it on your iPhone

An iPhone can only install a web app from an `https://` address, so the files need to be hosted once.
This only serves the **code**. Your entries never leave the phone.

### 1. Host the files on GitHub Pages (free)

1. Sign in at <https://github.com> (create a free account if needed).
2. Click **New repository**, name it e.g. `calorie-tracker`, set it to **Public**, and click **Create repository**.
3. Click **uploading an existing file**. Drag in `index.html`, `styles.css`, `app.js`, `i18n.js`, `foods.js`, `db.js`, `sw.js`,
   `manifest.webmanifest` and the whole `icons` folder. You don't need to upload `README.md` or `.claude`.
   Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and click **Save**.
5. After a minute or so the page shows your address: `https://<your-username>.github.io/calorie-tracker/`

### 2. Install it on the phone

Best done **before** the setup screens. The same guide is in the app: the start page has a
"ホーム画面に追加する方法" link (and More → このアプリをホーム画面に置く), with iPhone and Android tabs.

**iPhone (Safari)**
1. Open that address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.

**Android (Chrome)**
1. Open that address in **Chrome**.
2. Tap the in-app **アプリとしてインストール** button if it appears (Chrome offers one-tap install),
   or tap **⋮** → **Add to Home screen** / **Install app** → **Install**.

Then open the app **from the new icon** and go to **More → Show extra options**.
It should say *Opened from home screen: Yes*. *Protected storage* should normally say *Yes*.

After that, the app works fully offline. You'll only need the internet again when you update it.

## Keeping your data safe

- **iPhone: the Home Screen app and Safari keep separate data.** Always use the icon.
  (On Android, the installed app and Chrome share the same data.)
- **Removing the app icon deletes its data.** Export a backup first.
- **Back up regularly:** More → *Keep my diary safe* → *Save a copy now* → **Save to Files** → iCloud Drive.
  The Today screen reminds you if your last copy is more than 7 days old.
- **To restore** (new phone, or after reinstalling): More → *Show extra options* → *Bring back a saved copy*
  and pick the JSON file. This replaces what is currently in the app. Backups made by the earlier version still work.
- **Keep the same web address.** Data is tied to the address. If you ever move hosts, export first,
  install from the new address, then restore.
- *Download a spreadsheet (CSV)* (under extra options) gives a daily summary (date, total kcal, entries, weight) for Excel or Numbers.
  It is not a full backup, so use the JSON export for that.

## Updating the app later

1. Edit the files.
2. In `sw.js`, bump `CACHE_VERSION` (e.g. `'v1'` → `'v2'`). Without this, phones keep the old cached version.
3. Upload the changed files to the GitHub repository again.
4. On the iPhone, open the app once with internet. The update downloads in the background
   and takes effect the next time you open the app. Your data is not affected.
