# Ruhwell Front Desk

A local Electron desktop app for Ruhwell Med (telehealth psychiatry, Texas). Maria Baig PA-C uses it every day on her
MacBook; Almas Baig MD develops and tests it on Windows. It reads RxNT (schedule, prescriptions, To-Do, billing),
RingRx (texts and calls) and Gmail, and puts the day's work in one calm, color-coded place.

## Rules that never change
- **Patient data stays on the computer.** Nothing patient-related is sent anywhere except texts and emails the user sends on purpose.
- **Patient email only from hello@ruhwellmed.com.** The app checks Gmail lists it as a verified Send-as address and refuses to send otherwise (never falls back to admin@).
- **Sending hours.** Texts/emails to patients go out only in Settings → Sending hours (default 8 AM–8 PM Mon–Sat) unless the user picks "Send now anyway". Scheduled items are never sent twice; one caught mid-send is shown as "Check this one".
- **RxNT is read-only, with one exception.** The app never writes prescriptions, charts, payments or anything else into RxNT. Every item has "Open in RxNT". The only write allowed (Almas, 2026-11-20): uploading a received fax PDF to a patient's Documents, one at a time, after Maria confirms the patient name and DOB shown from RxNT.
- **Alert texts never include patient names** (or drug names).
- **No passwords handled by Claude.** The user signs in to RxNT, RingRx, Gmail and Doximity themselves (the app may save them encrypted, as asked).
- **Updates keep the user's sign-ins, settings and data.** They live outside the app (Mac: ~/Library/Application Support/Ruhwell Front Desk; Windows: %APPDATA%\Ruhwell Front Desk).
- Name is always **Ruhwell Front Desk** (and the practice is **Ruhwell Med**).

## Releases: Windows and Mac are always the exact same version
- Changes are logged in `CHANGES.md` and committed, but **nothing is built or published until Almas asks for a build.**
- A release builds Windows and Mac from the same commit and version (`.github/workflows/release.yml`, run manually in the
  public repo `almasbaigg/ruhwell-front-desk-updates`, branch `source`). The update feed is only updated if **both** succeed.
- Update feed (main branch of that repo): `latest.yml` + `RuhwellFrontDesk-Setup.exe` (Windows installs on restart),
  `latest-mac.yml` (Mac downloads `RuhwellFrontDesk-<arch>.zip` from the GitHub Release `v<version>`, unpacks it and swaps
  itself in on "Restart to update"; downloads made by the app aren't flagged by macOS). DMGs and zips are attached to the Release.

## Building the Mac version on Maria's MacBook (only when GitHub's Mac machines are stuck)
Do this only for a version Almas has already asked to release, so both computers stay on the same version.
1. Get the code for that version: `git clone --branch source https://github.com/almasbaigg/ruhwell-front-desk-updates.git` into the connected
   `RuhwellBuild` folder (or `git pull` if it's already there). Check `package.json` "version" matches the version asked for.
2. Needs Node 22 and Apple's Command Line Tools (already installed on her Mac). Then: `npm ci && npm test`.
3. Build: `npx electron-builder --mac dmg zip --arm64 --x64 --publish never` → `dist/RuhwellFrontDesk-arm64.dmg`/`.zip`, `-x64.dmg`/`.zip`, `latest-mac.yml`.
4. Publish: attach both DMGs, both zips and `latest-mac.yml` to the GitHub Release `v<version>` (the Windows part should already be
   there), and commit `latest-mac.yml` to the main branch of `ruhwell-front-desk-updates` (normal push, never force-push).
5. Install on her Mac: open the arm64 DMG, drag to Applications (replace), then double-click "First open on Mac" once.
   If macOS asks to allow Keychain access, click "Always Allow". Her sign-ins and data stay.
Don't change app code from the Mac build chat. Code changes happen in Almas's chat and come through a release.

## Code map
- `main.js`: app shell, IPC, sync planner, notifications (wrap-up/chart nudges, end of day, prescriptions waiting).
- `watcher.js`: schedule alerts (confirmed cancellations, corrections, cancel+rebook = reschedule, delivery tiers, click targets).
- `rxnt-reader.js`: hidden RxNT windows (schedule, EHR To-Do counts, prescriber dashboard, Billing alerts and unposted payments, portal messages).
- `rxtasks.js`: prescriptions/To-Do/billing state, Schedule II flag, payment review flags.
- `timer.js`: the sidebar timer (runs in the background, menu-bar countdown). `updater.js`: Windows and Mac self-updates.
- `store.js`: encrypted, crash-safe saving; data that can't be unlocked is never overwritten.
- `faxes.js`: Doximity fax inbox (hidden signed-in window, PDFs encrypted on disk). Filing into a chart: `rxnt-reader.findChart` + `uploadToChart` (the only RxNT write; needs Maria's pick + confirmation, then verifies).
- `activity.js`: 90-day activity log (no names, no secrets). Settings → Records.
- `gmailapi.js`: Gmail through Google's sign-in (internal OAuth app in Google Cloud project `ruhwell-front-desk`; key .json loaded once per computer in Settings, kept encrypted, never in the repo). Inbox, threads, mark read, archive, send with attachments. `outbox.js`: Send later + sending hours for texts and emails. `renderer/js/emails.js`: Emails view, composer, schedule picker, Scheduled list; `emailsettings.js`: Settings → Email + Sending hours.
- RingRx read sync: reading in the app PATCHes `/voicemails/<id>` `{voicemail:{status:'read'}}` (what RingRx's site does); RingRx "read" shows as read/listened in the app. RingRx voicemail `duration` is milliseconds.
- `comms.js`, `ringrx.js`, `gmail.js`: texts, calls (spam list, listened/answered marks, voicemail audio via `/voicemails/<id>/voice_payload`), email. `checklist.js`: checklist (plain-language times, repeats, Top 3) and day-page notes.
- `renderer/`: one page app. `js/today.js` (home), `js/pad.js` (checklist + notes), `js/rx.js` (RxNT), `js/faxes.js` (Faxes), `js/texts.js`, `js/calls.js`, `js/settings.js`.
- Tests: `npm test` (must pass before any release).

## Style
Ruhwell palette: teal #005758, sage #a3b18a, terracotta #e4926e, ivory #f6f1eb, porcelain #fcf7f5. Fonts: DM Serif Display, Plus Jakarta Sans.
Built for an ADHD-friendly day: urgency colors (red → amber → green), the most urgent thing first, few things at once, visible time, no clutter.
