# Ruhwell Front Desk — changes

## 1.0.1
- New look in the Ruhwell Med palette (teal, sage, terracotta on ivory) with the website's fonts (DM Serif Display, Plus Jakarta Sans); one clean stylesheet.
- Today: balanced layout — summary tiles, Needs attention (first 6, "Show all"), Today's visits, Schedule changes, Checklist, Notes and Inbox (newest unread emails). Texts from unknown numbers are grouped into one item.
- Prescriptions: reads RxNT's Pending, Pharmacy Requests and Rx Tasks (read-only). Filters: All / Pending / Refills / Tasks. "Dr. Baig" filter removed.
- Texts: Needs reply / Inbox / Sent. Opening a conversation clears its dot.
- Calls: Missed filter and missed counts removed (the callback list covers them).
- Gmail opens on admin@ruhwellmed.com, not whichever Google account is first in the browser.
- Alert texts go to the practice's RingRx number unless another number is set.
- Checklist reminder times, Notes, Settings → Sync (intervals, resync per source), contacts file export, fuller backups.
- No user picker: one shared desk; logins and data carry over.
- Settings icon is a gear; sidebar status line opens Settings → Sync.
- Code cleanup: removed unused code and APIs, grouped modules.

## 1.0.2
- Today: Schedule changes / Recent changes panel removed.
- Needs attention more compact (smaller rows, first 5 shown).
- Home page in three clear rows: summary tiles; Needs attention beside Today's visits; Checklist, Notes, Inbox.
- Texts badge counts unread conversations that need a reply and drops as soon as one is opened.
- Prescriptions read in their own hidden RxNT window (max 75 s), so they can't stall the schedule reader or cause "Can't reach RxNT".
- Schedule: days with no visits lay out blocks on the timeline correctly; the empty Clear/Send bar no longer appears; no yellow focus outline on buttons.
- Today fits the normal window with no page scrolling: tiles on top, then Needs attention | Today's visits + Inbox | Checklist + Notes. Each panel scrolls on its own; no "Show all".
- Schedule: message menu is just the templates plus one "Edit message" (or "Write my own"); Custom/Preview removed.
- Bulk-send bar is fully hidden (not just moved off-screen) unless visits are selected.
- Checklist looks like a to-do list (ruled rows, round check circles, "+ Add a task" line); Notes look like lined notepad paper with a margin rule.
- Each Today panel has an icon; Inbox shows the 2 newest unread plus "+N more unread" (opens Gmail).
- Prescriptions fix: RxNT's EHR side must be opened from the dashboard's "Electronic Health Records" card (it sits inside an iframe, which the old reader missed), so the reader now does that whenever the Rx list doesn't load directly, every time, within a 90-second limit. Clear messages instead of an endless "Checking RxNT…": "Couldn't read RxNT · retrying" or "Sign in to RxNT".
- Gmail: one place only — the unread tile (now shows the latest sender). Inbox panel removed; Today's visits gets the full column.
- Prescriptions read from RxNT's EHR dashboard (the same Sent / Failed / Pending / Pharmacy Request tiles you see), then names for pending and refill requests when there are any. Failed sends now show too (tile, Needs attention, and a Failed filter). Tested against the live dashboard: Failed 0, Pending 0, Pharmacy Request 0.
- Sidebar status line is plain status (no click).

## 1.0.3
- One sync clock: schedule, texts and calls, prescriptions and Gmail all update together on the interval set in Settings → Sync (10 min to 1 hour, default 15). No separate faster timers; patient list stays once a day. Sync now button for an on-demand pull.
- Sign-in screen: Gmail step no longer shows the email address.

## 1.0.4

- New patients: RxNT patient list checked every 4 hours; anyone new (portal sign-ups) raises a "New patient registered" alert (computer and/or text, no names in texts) and a Needs attention item with Open patient.
- Alert texts default to the practice line (979) 205-5460 if RingRx doesn't report a number.
- Prescriptions: "Sent" filter shows RxNT's recently sent prescriptions (patient, provider, pharmacy, status) for reference; the count shows on the tile and page header but isn't counted as waiting.
- Prescriptions: Voided list (with reason) and named Failed sends (from RxNT's Recent list) added; filters All / Pending / Refills / Failed / Sent / Voided. Tested against live RxNT: Recent 18, Voided 3 read correctly.
- RxNT To-Do (critical only): lab results to review, unsigned encounters and patient tasks appear in Needs attention when above 0, with Open in RxNT. Read from the same EHR dashboard, no extra syncing.
- Smart sync (replaces fixed intervals): appointments and texts/calls every 15 min in office hours, hourly otherwise; email 30 min / 2 h; prescriptions and RxNT To-Do 1 h / 4 h; patient list 4 h / 12 h. Office hours set in Settings → Sync (weekdays, default 8 AM–5 PM). Opening or focusing the app catches up anything older than 15 minutes. Tray menu: Sync now.

## 1.0.5
- Stays signed in to RxNT: RxNT's sign-in cookies are kept across restarts and updates (they used to be thrown away when the app closed), and RxNT's own keep-alive page is pinged every 10 minutes so the session doesn't time out between syncs.
- No false sign-outs: a single RxNT login page during a sync no longer signs the app out; it re-checks first and only asks you to sign in if RxNT really ended the session.

## 1.2.0
- Needs attention grouped: Prescriptions & RxNT · Patients waiting · Schedule changes · Ready to send · New callers · Patient info to fix. Each group shows 3 with "Show N more". Unknown numbers older than a week drop off here (still in Texts/Calls).
- A cancellation plus a new booking for the same patient at the same time (RxNT moving a visit) is treated as one edit, not two alerts; existing pairs are hidden.
- Notifications show "Ruhwell Front Desk" with the app icon (Start-menu shortcut with the app's ID) instead of "com.ruhwellmed.messenger". Morning note reads "No visits today. Since yesterday: 2 new bookings, 1 cancellation."
- GitHub: every push builds Windows only; Mac builds only when asked (Run workflow → Mac), on the Intel Mac runner because Apple Silicon runners were unavailable.

## 1.1.0
- Windows installer instead of a zip (per-user, no admin, Start-menu entry). Data moves to AppData (copied once from the old folder or its safety copy) so installs and updates never touch it.
- Automatic updates (Windows): checks at start and every 4 hours from the public installers-only repo, downloads quietly, then "Update ready – Restart" in the sidebar; installs on quit if you don't restart. Mac updater to follow once Mac builds work.
- Installer is built on GitHub's Windows machine (needs Windows tools); publish to the public repo once it exists.

## 1.2.0 (also)
- Trustworthy alerts: cancellations/removals must be seen on two reads a few minutes apart; half-loaded reads (a day suddenly losing most visits) are re-checked, not believed; a reported cancellation that turns out still scheduled gets a "Correction" alert. Covered by a new automated test.
- Three alert levels: Now (visit soon; confirmed change today/tomorrow) pops up at once and may text during office hours; Soon is bundled into one notification every 30 min, never texted; FYI stays in the app.
- Urgency colors (red/amber/green edge) on every Needs attention item by type and waiting time; red first; "Next up" card for the single most urgent thing.
- Later button on items: snooze 1 h / later today / tomorrow; numbers not in your patients can be ignored for good.
- Sidebar clock with "Next visit in N min" countdown (amber at 10, red at 5).
- "RxNT work" tab (was Prescriptions): Encounters to sign, Not billed yet (Maria's part, from RxNT Billing), Lab results, Patient tasks as color tiles, then prescriptions.
- Update-ready button in the sidebar.

## Logged (not built)
- RxNT work: Voided list doesn't match RxNT (RxNT shows 3 voided; app shows none). Check the Voided tab read and count; show the voided count in the header like sent.
- RxNT work: the filter bar (All / Pending / Refills / Failed / Sent / Voided) is confusing. Replace with plain sections: "Needs action" (pending, refills, failed — only when there are any) and a collapsed "History" with Sent and Voided underneath.
- Checklist reminder: replace the browser's blue time picker with the app's own small menu (bell button → quick picks: In 30 min, In 1 hour, End of day, Tomorrow 9 AM, plus a styled "Pick a time" with simple hour/minute steppers), in the app's colors.
- [done in code] RxNT patient portal messages: read from RxNT's Messaging sidebar (messaging.rxnt.com conversation list); patient messages waiting for a reply show in Needs attention (Patients waiting, "RxNT portal" tag) and on the RxNT work tab; new ones alert as Soon; checked every 15 min in office hours. Settings shows "RxNT: Signed in as <name>". Previously: They live in RxNT's right-hand sidebar chat panel (Tasks · Chat/Support area, per-patient conversations). Needs mapping that panel (signed-in RxNT in the built-in browser). Then: show them in Needs attention ("Patients waiting") and Texts with an "RxNT portal" tag, alert as Soon, reply opens RxNT.

## 1.3.0
- RxNT work: one "Needs you" list ordered by urgency (encounters to sign, labs, portal messages, prescriptions, patient tasks, not billed yet), an "All clear" line for what's empty, and a collapsed History (sent + voided with counts). Filter bar and tiles removed. Voided shown from RxNT's count, with "Open RxNT for the full list" when rows can't be read.
- Alerts simplified: one "Schedule changes" setting (new, cancelled, no-show, rescheduled) and one "Patient messages" (texts + RxNT portal). Existing choices carried over.
- Cancel + rebook = one "Rescheduled" alert: cancellations for later visits wait 20 minutes so a rebooking can pair with them; a new booking right after a cancellation (same patient, within a day) becomes "rescheduled" and retires the earlier cancellation. Tested.
- Sidebar: clock on top, New message, Today (badge counts only red items), "Needs you" (Texts, Calls, RxNT work), "Look up" (Schedule, Patients); Settings, status and a small logo at the bottom.
- Settings → Updates: current version, status (checking / downloading / latest / ready), "Check for updates" and "Restart to update".
- Updates read from the updates repo's files (not GitHub Releases, which this setup can't create). One manual install of the next build, then automatic.
- Mac: checks for new versions and shows "Update available" with a download button (Mac can't self-install without paid signing).

## 1.3.1
- Status line says "Syncing…" instead of "Updating…".
- Settings → Accounts: each account shows a health pill (green "Connected · checked 2 min ago", amber "Can't reach · retrying", red "Signed out"). Reconnect only appears when something is wrong.
- Updates card shows the actual reason when a check fails.

## 1.3.2
- First release built for Windows and Mac together from the same code.

### Also in 1.3.2
- App is ~40 MB smaller: only the English language pack is included (Electron ships 50+ by default).
- Name: app ID is now com.ruhwellmed.frontdesk; Windows keeps its existing install key so updates still replace the app in place. Remaining "Messenger" mentions are only the one-time data carry-over from the old name.

## 1.4.0
- RxNT work grouped like RxNT: Clinical (encounters to sign, labs, documents to review, referrals, portal messages, patient tasks) · Prescriptions · Billing. Counts or "All clear" per group, red first, sent/voided in History.
- Prescriptions are time-sensitive: "waiting 2 h" on every one; amber after 1 hour, red after 3 hours or after closing; failed = red. Schedule II (stimulants, opioids) tagged "needs Dr. Baig, see patient first". Visit-today time shown. Pop-up (and optional text) once one waits over an hour in office hours; texts give only counts.
- Billing: "Payments to post" (unposted patient payments from RxNT Billing, with the oldest age), "Review payment" when the same patient is charged twice within 2 days, "awaiting billing" from the EHR To-Do (Maria's part). The biller's unbilled queue shows as information only.
- Today: the day as a time strip (visits as blocks, gaps labeled "Free 1h 20m", "Free now"), "6 done today" progress, and after closing time "Before you go …" or "All done for today".
- Wrap-up pop-up 5 minutes before the next visit while one is still going; "Chart this visit?" when a visit ends (opens RxNT). End-of-day pop-up at closing time. New alert rows: Prescriptions waiting, Wrap-up & chart reminders.
- Clicking a notification opens the exact place: the text conversation, the visit's day, RxNT work, or Patients.
- Checklist: plain-language times ("call pharmacy at 3", "payroll tomorrow", "fax check every day at 9"), a live hint of the reminder time, quick reminder picks (In 1 hour, In 3 hours, After visits, Tomorrow 8 AM, or a time), Top 3 stars, overdue amber → red, daily/weekly repeats, drag to reorder, friendly empty state. "Later → Add to checklist" on any Today item, with a link back.
- Notes: a page per day (older days kept), search all notes, pin a page, @ to link a patient (opens their record), "Line → task". The old single notes pad is kept as a pinned "Earlier notes" page.
- Texts: grouped by day; Needs reply shows how long each has waited (green → amber → red). Calls: callbacks show waiting time with urgency; today open, earlier days folded.
- Templates: compact list, click to edit in place, tap-to-insert chips, live preview with a sample patient, delete in a ⋯ menu with confirm, duplicate.
- CLAUDE.md: instructions for any Claude (including Maria's) to build the Mac version and keep both versions identical.

## 1.5.3 (Windows test build)
- Saved RxNT sign-in made safe (from the 1.5.2 review, verified): saved only after RxNT lets you in (a typo never replaces a good one); each sign-in step is submitted once, and a "wrong password" stops it immediately (no repeated attempts that could lock the account) and Settings says the saved sign-in needs updating; it only fills in on RxNT's own pages; nothing goes through the page console; "Forget it" deletes the file and confirms.
- RingRx: a dropped connection no longer signs you out (only a truly expired login does), and the password is kept encrypted so the app can sign back in once by itself.
- Gmail: the Google sign-in is kept for 6 months instead of ending with the session (no password stored; Google blocks automated sign-ins).
- STOP/START: replies are handled oldest-first, and START only counts if it came after the STOP. The retry after a RingRx session refresh re-checks STOP too.
- Mac self-update: the new version is staged on the same disk, must report it started fine within 3 minutes, otherwise the old version is put back automatically.
- Home screen: Needs attention is wider; names and details use up to two lines instead of being cut off; tags sit beside or under the title; more spacing. Visits show the status under the name. "Before you go" shows counts (2 texts · 1 call · 3 prescriptions). Notes header never gets cut off.
- RxNT history rows are numbered.

## 1.5.2 (Windows test build)
- RxNT stays signed in: the app remembers your RxNT sign-in (encrypted on this computer) the next time you sign in, and if RxNT ever signs it out, it signs itself back in quietly (also when the app opens). Only a verification-code step needs you. Session kept alive every 5 minutes. Settings → Your accounts shows "Sign-in saved" with Forget it.
- (Verified from the 1.5.0 review) Reschedule pairing only within 2 weeks; a same-slot replacement is a quiet edit; "Back on the schedule" alerts right away for today/tomorrow.
- STOP is separate from the Do-not-text switch: a number that replied STOP stays blocked until they text START (automatic) or you confirm they opted back in. The block is re-checked before every single text, with all numbers compared as 10 digits.
- Saving: written to disk before swapping in; an existing file that can't be read, or is empty, is locked (never treated as "no data").
- Mac self-update: the download must match the release checksum; the old app is kept until the new one runs (and put back if it doesn't); no shell tricks with file paths.

## 1.5.1 (Windows test build)
- Fix: RxNT work and dashboard counts failed to load (an empty value broke the reader). Regression test added.
- Fix: Schedule day view showed "undefined" cards on days with closed or out-of-office blocks.
- Timer: a clean pie that empties as time runs out.

## 1.5.0 (first Windows test build)
- Mac updates install themselves (needs the Mac build of 1.5.0 installed once): the app downloads the new version, replaces itself and restarts. Files the app downloads itself aren't flagged by macOS, so no "damaged" warning and no Terminal command after this first install.
- Timer (for anything she's doing): a timer button under the sidebar clock. Quick picks (5, 10, 15, 25, 45 min, or type a time) and an optional label ("Charting", "Call pharmacy"). While running, the sidebar clock becomes a big shrinking disc with the time left (teal → amber at 5 min → terracotta at 1 min), plus Pause, +5 min and Stop. At the end: a soft chime and a pop-up "Time's up: Charting" with +5 min / Done. The time left also shows in the Mac menu bar so she sees it while working in RxNT. One timer at a time, nothing to set up.
- (From code review, all verified in the code) Data safety: if saved data can't be decrypted (e.g. Mac Keychain access denied after an update), never treat it as empty and never overwrite it. Show a clear "Can't unlock your data" message instead. Refuse to save patient data unencrypted.
- Sync retries: a failed sync retries within a few minutes instead of waiting for the full interval (track last success separately from last attempt).
- RingRx: a failed pull is reported as failed, so old texts/calls are labeled stale instead of looking current.
- RxNT portal: fix new-message alerts when the inbox was empty before (the first message after an empty inbox could be missed).
- Prescriptions: if RxNT shows counts but the patient details didn't load, say "3 pending, details didn't load" instead of a short list that looks complete.
- Links: only open https links to known sites (RxNT, RingRx, Google, GitHub, review link) from the app.
- Today: the Next up item no longer repeats in the list below it. "Later today" becomes "In 3 hours" (or "Before closing" when that's sooner).
- Never show "All caught up" while a source failed to load; show which source is stale and when it last worked, right on Today.
- (From ChatGPT ideas, checked against the app) Wake from sleep: when the laptop wakes, catch up right away (today's schedule and messages first) and send one summary, not a replay of every change.
- Source health on Today: a small line per source (RxNT schedule, prescriptions, RingRx, Gmail) with when it last worked; stale ones amber with "check RxNT directly".
- Patient timeline: in a patient's record, one list of visits, texts, calls and prescriptions in time order (from what's already on the computer).
- Texts: if a send times out, check whether it actually went out before allowing a retry (no duplicate texts).
- Follow-up on outreach: when sending a text that needs an answer, optionally "remind me if no reply by …"; clears itself when they reply.
- (Verified from the ChatGPT backlog) Safe saving: write each data file to a temporary copy and swap it in, so a crash or power loss mid-save can't corrupt it.
- Automatic backups: if the daily backup fails, say so (Settings and the status line) instead of failing silently.
- Templates: if a text would go out with a blank where the date, time or name should be (e.g. "your appointment on  at "), stop and point it out before sending.
- Internet back: when the connection returns, catch up right away (same as waking from sleep).
- Schedule alerts (from a targeted review of watcher.js / rxnt-reader.js, each verified in the code), with regression tests:
  - A visit moved to a new time without a status change (same appointment, new time) now alerts as "Rescheduled". Today it's missed.
  - Cancel/rebook pairing becomes one-to-one and nearest-in-time, so a patient with several bookings can't get a wrong "rescheduled from…".
  - A day RxNT won't open is "couldn't read", not "closed". Only weekends/hidden days count as closed. (A failed weekday read could otherwise look like every visit was cancelled.)
  - A visit that disappears outright (RxNT normally keeps cancelled visits visible with a Canceled status) must stay gone across more reads before alerting, even on a day with a single visit.
  - A visit rebooked into the same slot after its cancellation was already reported alerts "Back on the schedule" instead of staying silent.
  - Small: the schedule-loaded check also compares visit times; the watched date range uses calendar days (daylight-saving edge).
- Texting safety (from a targeted review of comms.js / ringrx.js / send.js, verified in the code), with tests:
  - STOP blocks the phone number itself, for everyone who uses it. Today it marks only the first matching patient, and the send-time block checks only main phone numbers, so a sibling or a patient listed under the parent's number could still be texted after STOP.
  - Shared family numbers: a reply or "C" confirmation isn't pinned on one child. It names everyone on that number and confirms only the visit that was actually reminded. The send countdown says "Shared number: Jordan, Sam" so the recipient is clear.
- RxNT reading (verified from review 2): a failed portal-inbox read is "couldn't read", never an empty inbox (today a failed read wipes the known conversations); read all recent portal conversations, not just 40; the prescription counts are accepted only when all prescription tiles (Pending, Pharmacy Request, Failed) are present; prescription lists say "details for 2 of 3" when the grid shows fewer rows than the count; one bad payment date can't throw away the whole payments read.
- Data safety (verified from review 3): restoring a backup also restores reply/confirmation state (it's saved but was never restored); the checklist's size cap only trims old finished tasks, never unfinished ones.
- Quick capture from anywhere: a keyboard shortcut (Cmd+Shift+Space on Mac, Ctrl+Shift+Space on Windows) opens a small box over any app; type a task (times like "at 3" work), press Return, it's on the checklist.
- One-line brief before each visit, in Next up and the visit list: open items for that patient (pending prescription, unanswered text, missed call) and last visit.
- Undo for a few seconds after Done, snooze or delete.
- Tomorrow preview in the end-of-day check: first visit time, number of visits, new patients.
- Background reliability on Mac: keep macOS from putting the app to sleep (App Nap) during office hours, so checks and alerts stay on time while the window is hidden; pop-ups use the app's own icon, a short title saying what happened, one line of detail, and open the right place when clicked. On first run on the Mac, a one-time tip to set Ruhwell Front Desk's notifications to "Alerts" (they stay on screen until dismissed) in System Settings.
- Intuitive without a tutorial (applies to the whole build, checked screen by screen before release):
  - Every action says what it does in words (icon-only buttons get a label or a hover hint); same action, same place and wording everywhere.
  - Every empty area says what will show there and how to add it.
  - New features teach themselves with one small, dismissible tip the first time they appear (e.g. "Tip: type 'at 3' to set a reminder"), never more than one tip at a time, never a tour.
  - Settings reorganized around plain questions: "Who are you?" (name for the greeting, office hours), "How should we reach you?" (alerts, sounds), "Your messages" (templates), "Your accounts", "Your data". Each setting has one line explaining it, good defaults, and shows its effect right away.
  - Personal touch: Today greets her by name ("Good morning, Maria"), uses her office hours everywhere, and remembers her choices (filters, last view).

### Deferred
- Splitting main.js into smaller files (no behavior change): saved for a quiet release, so it can't mix with these fixes.

## 1.6.1 (Windows + Mac)
- Fix: 1.6.0 crashed on start ("Cannot find module './activity'"): two new files were left out of the installer. Added them, plus a test that fails the build if any file the app needs isn't packaged.

## 1.6.0 (Windows + Mac)
What's new, in short (details of each item are logged below):
- **Faxes from Doximity**, right in the app. Maria picks the patient, checks the name, DOB and chart # read fresh from RxNT, confirms, and the app files it into that chart and checks it arrived. This is the only thing the app ever writes to RxNT.
- **Schedule from three places**: Appointments + Availability (portal-confirmed visits, PNF) + the EHR's Today list, so confirmed visits never look cancelled. Cancel + rebook across a duplicate chart pairs as one reschedule; same-slot rebooks are visible; changes found after a gap say "While disconnected".
- **Real connection checks** every 5 min in office hours (10 after), and on start, wake and reconnect. Pills are green only after a real read; amber when stale; red when sign-in is needed. Start-up checks and quietly signs back in first, and only asks for what still needs you.
- **Settings → Connections** at the top (RxNT, RingRx, Gmail, Doximity, patient list) with Check & sync per row and Check everything now.
- **Sync card**: the Ruhwell mark fills with teal as each part finishes, with a live checklist; respects Reduce motion.
- **Calls & texts**: voicemail playback (1×/1.5×/2×), listened/read marks, Answered / Unanswered, a Spam button that remembers numbers for good (patients' numbers protected), Block in RingRx.
- **RxNT**: unsigned notes listed one by one (red), "Chart not started" on checked-in visits, the signed-in account name as RxNT shows it, sent & voided history inside Prescriptions. Sidebar says just "RxNT".
- **Schedule**: nothing is pre-ticked; one "Select all who need a text" button with the reason on each visit. "Review request" is now "Google Review Request".
- **Today**: "Schedule not checked since …" banner, a "Changes today" list, unsigned notes and new faxes in Needs attention, and a layout that fits smaller windows.
- **Window**: opens at about 90% of the screen and remembers its size; content never sits under the window buttons.
- **Activity log** (90 days, chart numbers only, CSV export) in Settings → Records, plus the spam list.

### Logged for 1.6.0
- RxNT work: prescription History (sent and voided) moves inside the Prescriptions group, as a collapsed "Sent & voided" line under the prescriptions that need you, instead of a separate section at the bottom.
- Bug (seen Nov 20): RxNT work said "Sign in to RxNT · RxNT signed you out" while the app showed RxNT as connected. Cause: the sign-in check only looks at RxNT's Scheduler page, but prescriptions/To-Do are read from the EHR pages, so when only the EHR side has signed out (or the check times out), the two disagree and the automatic re-sign-in never starts. Fix: check sign-in on the page that actually failed, start the saved-sign-in automatically whenever any RxNT read hits a login page, and when it truly needs you, show one clear "Sign in to RxNT" button (not "Check now") everywhere.
- Bug (seen Nov 20): RingRx asked to sign in again. Likely causes: the saved password only exists after signing in once on 1.5.3 or later, and a RingRx account with a 6-digit authenticator code can't be signed back in without that code. Fix: say exactly why ("RingRx needs your 6-digit code" vs "sign in once to save it"), keep the sign-in alive by refreshing it well before it expires (also while the app sits idle), and log (without passwords) why a refresh failed so the next case can be pinned down.
- Bug (seen Nov 20, after force-closing the app): the start-up sign-in screen asked only for RingRx; RxNT's sign-out only showed up later in Settings. Fixes: (1) on start-up, actually check every account (RxNT, RingRx, Gmail), quietly sign back in with saved sign-ins first, and show one screen listing only what still needs you; (2) write sign-in cookies to disk right after they're refreshed, so a force-close or crash can't lose the RxNT session; (3) never show RxNT as connected from a stale flag: trust only a real check.
- Real connection checks: every 10 minutes (5 during office hours, and right after start-up, waking or reconnecting) the app actually tests each account: RxNT on both the Scheduler and the EHR side, RingRx with a real request, Gmail by opening the inbox feed. The green/amber/red pills in Settings and the status line show the result of that test (with "checked 2 min ago"), not a remembered flag. A failed test starts the quiet re-sign-in right away; you're only asked when that can't work.
- Settings: one compact "Connections" card at the very top, merging Your accounts and Staying up to date. One row per account: RxNT (appointments, prescriptions & To-Do, portal), RingRx (texts and calls), Gmail, plus Patient list. Each row shows its health pill and when it last actually worked, with a "Check & sync" button that tests the sign-in and pulls fresh data right then. A "Check everything now" button at the top does all of them, always available. The long smart-sync explanation moves behind a small "How syncing works" link.
- Bug (seen Nov 20): RingRx showed green "Connected · checked 2 d ago" while texts and calls hadn't updated in 2 days. A pill must never be green when the last success is old: amber after 1 hour in office hours (4 hours otherwise), red when sign-in is needed.
- Bug (seen Nov 20): signing in (RxNT or RingRx) didn't refresh anything; only the manual Sync button brought the data in. Fix: a successful sign-in (manual or the quiet automatic one) immediately runs a full sync of that account's data (appointments, prescriptions & To-Do, portal / texts and calls) and updates the pills and screens.
- Window and layout fit (seen Nov 20): open at a roomier default size (about 90% of the screen, centered, remembered after you resize), and the Today board adapts to the window width instead of squeezing text: on narrower windows Next up puts its buttons under the text, checklist and notes stack under the visits, and the Needs attention column keeps enough width for names and actions on one line. Time strip labels that don't fit are hidden instead of being cut ("F…").
- Status line said "All connected" while Today showed "Couldn't check the RxNT schedule": both come from the same real check now (see Real connection checks).
- Window frame (seen Nov 20): the Windows minimize/maximize/close buttons sit on top of the page with a mismatched band, crowding the refresh button. Fix: a proper title strip the same color as the page, the same height as the drag area, with page content and header buttons starting below it (Mac: traffic lights lined up with the sidebar clock).
- Small layout fixes on Today: Next up keeps the full title ("Cancelled: Randy …" was cut), the checklist box hint fits ("e.g. call pharmacy at 3"), and the Notes header lines up (title left, day buttons right, no empty gap).
- Sync progress: pressing Sync / Check everything shows a small card with the Ruhwell cross mark filling up in teal as each part finishes, and a checklist beside it: RxNT schedule ✓ · Prescriptions & To-Do ✓ · Portal messages … · Texts & calls · Email · Patient list. Each line turns green ✓, or amber with the reason ("sign-in needed", "couldn't load") when it fails. Progress is real (parts finished), not a guessed percentage. The card closes by itself a few seconds after "All up to date", and doesn't block the app.
- Sync animation polish: the cross mark fills with teal like liquid rising from the bottom, easing smoothly toward each new step (no jumps). When everything finishes, it settles with a soft glow and the checkmarks pop in one after another. Checklist lines fade in as each part starts. If a part fails, that line turns terracotta gently instead of flashing. Animations stay subtle and short, and switch off when the computer's "Reduce motion" setting is on.
- RxNT schedule bug: appointments a patient confirms through the portal disappear from Scheduler → Appointments but still show under Availability (SchedulerV2/#/availabilitycalendar), with a status code badge. PNF = patient confirmed. Fix: also read the Availability calendar for each day, merge with the Appointments list by appointment (no duplicates), and never treat "missing from Appointments" as cancelled while it's still on Availability. Read the status badges (PNF, PND, CKC, etc.) and map them using RxNT's own status legend rather than guessing; show "Patient confirmed" on the visit card and count it as confirmed (no reminder text needed). Unknown codes show as-is. Add a test so a portal-confirmed visit never triggers a "cancelled" alert.
- Schedule cross-check (3 sources): for today, also read EHR → Today's Appointments (ehrv9/legacy/prescriberDashboard#/dashboard/appt, Individual tab), which correctly lists portal-confirmed visits. Merge Scheduler Appointments + Scheduler Availability + EHR Today's Appointments by patient + time; a visit counts as real if any source has it. "Cancelled" only when it's gone from all sources that cover that day (confirmed over 3 reads / 10 min as now). If sources disagree, trust the visit exists and note which source missed it in the log (no names). Future days use Scheduler Appointments + Availability; EHR list is today-only.
- RxNT account title wrong in the app: after sign-in, read the account name exactly as RxNT shows it in its top-right header (practice name + signed-in user, e.g. "Ruhwell Med · Almas Muhammad Baig"), save it, and show that in Settings → Connections and the status line. Refresh it on every successful sign-in/check; never show a stale or guessed name, a username/email, or a placeholder.
- Texts: one-tap "Spam" button on every incoming text/thread from a number that isn't a known patient (also in the ⋯ menu for any thread). It moves the thread to a collapsed "Spam" list, mutes alerts and badges for that number, keeps it out of counts and follow-ups, and shows a toast with Undo. Spam list is local; "Not spam" restores. If RingRx supports blocking a number, also offer "Block in RingRx" (opens RingRx; nothing blocked silently). Known patients' numbers ask "This is a patient's number — mark as spam anyway?" first.
- Voicemail playback: a ▶ Play button on each voicemail (Calls tab and patient timeline) with a slim progress bar, 1×/1.5×/2× speed, and the transcript underneath. Audio is fetched from RingRx on tap with the signed-in session, played from memory, and never saved to disk. Playing marks it "listened" (dims the badge). If RingRx doesn't give the recording for a message, show "Listen in RingRx" instead. First verify which field/endpoint on the RingRx voicemail record carries the audio before building.
- Schedule: stop pre-selecting patients. Currently visits are auto-checked when they look eligible (seen today → after-visit text; upcoming → reminder), which feels random and risks an unintended send. New: nothing is selected on open; a clear "Select all who need a text (N)" button checks the eligible ones in one tap, with the reason under each ("Seen today · no review ask yet", "Tomorrow · not confirmed"). Selections reset when switching days.
- Missed reschedule (today, patient cancelled + rebooked, no alert). Likely causes in current code, fix all:
  1. RxNT reads were failing today while the pill said "connected" → watcher saw nothing. Fix with the real connection checks above, plus: if the schedule hasn't been read successfully for 20+ min in office hours, show an amber "Schedule not checked since 2:10" banner on Today and in the menu bar. After reads recover, diff against the last good snapshot and report anything missed as "While disconnected: …".
  2. Portal-confirmed visits vanish from the Appointments list (see 3-source fix). The "suspect day" guard (count dropped by half → assume bad read) can then hide a real cancel. Use the merged 3-source list for counts and diffs.
  3. Cancel + rebook into the same slot, or a new record with the same time, is reported as quiet "rebooked". Make it a visible "Rebooked" alert when the old one was cancelled by the patient/portal.
  4. Matching uses patientId only; a duplicate chart under the same name gives "new" + "removed" (or nothing if held). Also pair by normalized name + DOB.
  5. Changes for later days wait 20 min to merge cancel+rebook; if the app sleeps/quits in that window the pending change can be lost. Persist pending changes and flush them on next start.
- "Changes today" list on Today (collapsed): every schedule change seen today, including quiet ones, so nothing depends on catching a notification. Each schedule read logs a no-PHI line (time, source, count, ok/fail) for troubleshooting; Settings → "Copy diagnostics".
- Rename "Review request" → "Google Review Request" everywhere: template name (default + migrate existing saved template if still named "Review request"/"Review"), Today batch ("Send 3 Google Review Requests"), pills ("Google review asked Nov 20"), history/log labels. Keep id 'review' so past history still counts.
- Unsigned encounters get real attention (count is read today but only sits in the To-Do list):
  - Top of Today as a red "Sign 1 note" card with patient + visit date per note, oldest first, age shown ("from yesterday", "3 days"), and "Open in RxNT" per note (read from the Unsigned Encounters list).
  - Nudges: after each visit's wrap-up time, "Sign today's note?" if still unsigned; at end of day the closing card won't say "all done" while any are unsigned; any note unsigned 24h+ gets one desktop notification next morning (no names in notification text) and shows on the menu-bar badge.
  - Visit checked in ("Check-In Completed") with no encounter started (RxNT shows the "+") → "Chart not started" on that visit.
- EHR dashboard appointment Status column gives full words (Pending / Patient Confirmed / Check-In Completed) — use it as the source of truth for status mapping instead of guessing codes (PND/PNF/CKC).
- NEW: Faxes (Doximity). Doximity has no public API, so read the Doximity fax inbox the same way as RxNT: hidden signed-in window (sign-in saved locally/encrypted like the others; Doximity may ask for a code → notify). Every sync: list new received faxes, download each as PDF (Doximity offers "Download PDF"), store encrypted in the app, never in plain files.
  - Faxes tab + Today card "2 new faxes": preview pages in-app, sender fax/name, received time, page count.
  - Patient pick (Almas, 2026-11-20 — safest approach): the app does NOT guess or pre-select a patient. Each new fax shows its preview and "Which patient is this for?" with a searchable patient list (type a few letters of name or DOB; today's/this week's patients listed first for speed). Maria picks the patient herself.
  - "Add to chart" uploads directly (Almas approved 2026-11-20: the ONE exception to RxNT read-only). Flow: confirm screen shows the fax preview next to the RxNT patient's name + DOB + chart # (read fresh from RxNT, not from the fax) → Maria taps "Yes, this is the right patient" → app uploads the PDF to that patient's Documents with a clear name (Type – Sender – Date) → reads the chart back to verify the document is there → marks "Filed to chart ✓" with an "Open in RxNT" link. The patient shown is always the one she picked; if that chart can't be read from RxNT, upload is blocked. No upload without that tap; never in bulk; if upload/verification fails, nothing is marked filed and she gets "Didn't upload — try again / open in RxNT". Each upload logged locally (time, chart #, doc name). Add tests: no-confirm = no upload; no pick = no upload; chart unreadable = blocked; failed verify = not marked filed.
  - Also: "Not patient-related"/spam, link to open the fax in Doximity, filed faxes auto-cleared from the app after 30 days. Alert text: "New fax" only, no names.
- Sidebar: rename "RxNT work" → "RxNT" (nav label, page title, tooltips, notification click targets that say "RxNT work").
- Activity log (RxNT + Doximity), kept 90 days then auto-pruned: one line per action the app takes — fax received (sender fax #, pages, time), fax filed (chart #, document name, who confirmed, verified ✓/✗), upload failures, sign-ins/sign-in failures, sync reads (ok/fail, counts), schedule alerts sent. Chart # instead of patient names; no fax content, no passwords. Stored encrypted locally, append-only (app can't edit old lines). Settings → Activity log: filter by date/type, "Export CSV" for bookkeeping.
- Read/listen + answered status (in-app only; nothing is sent to the patient):
  - Voicemails: "New" → "Listened" (played ≥5s, or transcript opened) with time. Incoming texts: "New" → "Read" when the thread is opened. Bold/dot until read; counts on sidebar and Today use unread only.
  - Every incoming call/voicemail/text also shows "Unanswered" (amber) until there's a later call out, text out, or "Mark handled"; then "Answered · called back 3:40" / "texted back 3:42" / "handled". Filter chips: Unread · Unanswered · All.
  - Mark unread / un-handle available (with Undo). Status kept per item locally on that computer; logged in the activity log.
- Calls: same "Spam" button as Texts on every call/voicemail from a non-patient number. Shares one spam list with Texts (marking a caller spam also covers their texts and vice versa): hides from Calls, mutes alerts/badges, never counts as "Unanswered" or "needs callback". Undo + "Not spam"; patient numbers ask first; "Block in RingRx" link if RingRx supports blocking.
- Spam is remembered permanently: numbers marked spam are saved (encrypted, included in backups, survive updates/restarts). Any future call, voicemail or text from that number goes straight to Spam automatically — no alert, no badge, not Unanswered. Settings → Spam numbers: list with date marked, "Not spam" to remove. A patient's number is never auto-spammed (if a saved spam number later becomes a patient's number, it's un-spammed and flagged once for review).
- Doximity sign-in follows the exact same rules as RxNT/RingRx/Gmail: sign-in saved locally (encrypted) only after a successful login; quiet automatic re-sign-in (single submit, origin-checked) when the session drops; keep-alive + session cookies persisted; code/2FA prompt → one notification "Doximity needs a code"; wrong password → mark bad, stop retrying, ask once; "Forget sign-in" in Settings. Included in the periodic real connection checks (pill green only on a successful fax-inbox read, amber when stale, red when sign-in needed), the startup "check all, sign back in quietly, show only what still needs you", the Connections card with "Check & sync", and the sync progress checklist ("Faxes").
- Sync settings: add Doximity (Faxes) alongside RxNT, RingRx and Gmail — on/off toggle, how often to check (same choices as the others; default every 10 min, 5 in office hours), last checked / last new fax time, per-row "Check & sync", and included in "Sync now" / "Check everything".

## Next release (logged)
