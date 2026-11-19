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

## 1.5.0 (Windows test build)
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
