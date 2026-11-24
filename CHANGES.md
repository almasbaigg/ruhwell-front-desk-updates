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

## 2.3.0 (built into the code, not released yet; waiting on the ChatGPT test pass)
Everything listed below is done, except the RxNT/Doximity "extra page" detection (still to do). Summary of how:
- Today: wider page; two main columns plus a Checklist | Notes card with tabs; visit status pill on the name line; faxes are their own group with the fax icon; Next up wraps cleanly; one action-button width; shorter checklist placeholder; unread-emails tile shows "—" until Gmail is read.
- Emails: one reading surface (no box in a box, natural height, system font); header is the subject + Done icon + ⋯ + Reply; read time on hover; list newest first, grouped by day, initials, unread dot at the left edge, HTML codes decoded, patient names for known addresses; both sides scroll on their own.
- "Scheduled emails" / "Scheduled texts" show only their own kind, with the count.
- Composer: borderless To/Subject fields; the app's own recipient list (name, email, next visit or DOB; starts-with matches first; top 6; arrow keys).
- Texts: New text button; compact Needs reply pill on the name line; range picker moved next to search. Sidebar: New text | New email.
- Faxes: list + full-width document; "Add to chart" opens as a side sheet (opens by itself when a likely patient was found); Read/Done/Filed times under each fax; chips in one scrolling row; simpler header.
- Sync: checks centered; Sync now (and opening with old information) shows a big centered card over a soft blur, with Keep working; it tucks into the corner when done or when clicked away.
- Clock: next visit on two lines. Settings: "Communication" tab (also reachable from Texts/Emails), drawn (i) icon, aligned template rows, signature placeholder, wider cards.
- Motion: view fade, sheet-style windows, Done check drawn + row slides out, badge roll, button press, gentle blur on panels still updating, a small celebration when To do reaches zero. All off with the system's Reduce motion.
- Focus rings show only when using the keyboard.

### 2.3.0 fixes from ChatGPT's test pass (each checked against the code)
- Email: the patient picked in To stays picked; typing a different address clears it; an address shared by two patients is never matched to one of them (composer, list names, replies, outgoing record).
- Email: switching threads clears the old one first, and a late answer for the previous thread can't take over the pane. Opening an email no longer cancels "Load older emails" (separate request counters).
- Email: read time is per newest message, so a new reply in an old thread gets its own time. Older messages expand with the keyboard. Long emails re-measure on expand and window resize.
- Scheduled: Cancel / Send now / Change time say what really happened ("Too late: it's already being sent") and refresh only that window, never over a composer. Scheduled texts count messages, not batches.
- Faxes: a late RxNT answer for a fax you've left can't change the fax on screen (a background success just updates the list). A refresh keeps the patient pick/confirmation and doesn't reopen a closed sheet. Read/unread failures are shown and undone. Closed sheet can't take keyboard focus.
- Sync card: a new run cancels the previous run's timers and click action.
- Today: Done counts once, and if saving fails the row comes back. Checklist: unchecking takes it off the Done count.
- Reduce motion: no button scaling, check mark still shows. Headings in Emails/Faxes use the serif font (wrong variable name before).

### Logged items (for reference)
**Cosmetic issues from Almas's Today screenshot (2.2.0, wide Windows screen)**
- On a wide window the page sits in a narrow centered column with large empty space beside the sidebar; use the width (or align left with a sensible max).
- Today's visits header is crowded: the title wraps to two lines next to "Updating…" and "Schedule". Keep the title on one line; move the freshness label under it or make it a small dot.
- While updating, Today's visits shows "No visits today" and the tile "0 visits today", which reads as fact. Show the saved schedule, or "Checking…", until RxNT has answered.
- Next up card: a long title wraps and the "· 12h ago" falls onto its own line.
- "New faxes" sits under "Prescriptions & RxNT" with the prescription icon; faxes should be their own group with the fax icon.
- Counts disagree: Today badge vs Needs attention count, and Texts nav badge vs the "texts to answer" tile. One definition per count, everywhere.
- Patient rows: the "RxNT portal" tag sometimes drops to its own line; keep tags on the name line or truncate the name.
- Row action buttons vary in width ("Open in RxNT", "Reply", "Send welcome"); align them in one column with a consistent width.
- Unread emails tile icon is a filled teal square, unlike the other tiles' soft icons.
- Checklist placeholder is cut off; use a shorter one.
- Notes header controls look off-center; the last Needs attention row is cut at the panel's bottom edge.
- General spacing and button alignment pass across all screens.
**Emails screen looks weird/cheap (Almas's screenshot)**
- Reading pane: the message sits in a box inside a box, on a white iframe block with a fixed height and empty space below; the email text uses Arial while the app uses its own font. Make it one clean reading surface (like Apple Mail): sender row with avatar, subject as the title, the body flowing naturally with comfortable margins and height that fits the content.
- Header is heavy: four buttons (Mark unread, More, Done, Reply) plus "1 message" and a letter avatar. Keep Reply as the one primary action, Done as a quiet icon button, the rest in a ⋯ menu.
- "Read 6:22 AM · Done archives it in Gmail" line looks like debug text; show the read time subtly (or on hover), drop the explanation.
- List rows: snippets show raw HTML codes (e.g. &#39;); decode them. The unread dot sits inside the subject line; move it to the left edge with a bold sender. Add small avatars/initials, tidy the date column, and keep long sender names from crowding.
- Selected row looks like a plain box; give it a clear but soft selected state.
- The eyebrow line in capitals with two email addresses is long and loud; shorten (e.g. "hello@ruhwellmed.com").

- Emails: both sides should be the same height and scroll on their own (the list runs past the window while the reading side is short). The message itself should scroll inside the reading side, not in a small inner box with its own scrollbar.
- Emails list sorting: newest first everywhere (Sent included), grouped by day like Faxes (Today, Yesterday, Nov 21…), with a clear count; "Load older emails" at the bottom.
- Sent list: show the recipient's name when known instead of "To: email@address"; decode HTML codes in snippets (&#39;).

- The "Scheduled" button says what it holds: "Scheduled emails" on Emails (shows only emails) and "Scheduled texts" on Texts (only texts), with the count.

- Composer fields: the Subject field shows a boxed input with a focus ring that overflows the right edge and doesn't match the borderless To line; the To field shows a dark ▼ (browser datalist arrow). Make To and Subject the same: borderless lines, soft focus underline, no browser arrow (own suggestion list for patients).

- Recipient suggestions use the browser's black dropdown (email first, name tiny and grey). Replace with the app's own list: light card under the field, patient name first in bold with initials, email underneath, next visit or DOB on the right; matches the start of first/last name or email (typing "a" shouldn't list everyone with an "a" anywhere); arrow keys + Enter; top 6 only. Practice addresses (@ruhwellmed.com) are never suggested as a patient's email (one patient record carries admin@ as its email).

- Texts gets its own **New text** button (like New email). The sidebar's "New message" becomes a split choice: **New text** and **New email** (two compact buttons, or one button with a small menu), both opening the same Message window on the right tab.
- Texts list polish: the "Needs reply" pill stretches across the row; make it a compact pill. The selected sidebar item shows a heavy dark focus outline after clicking; keep the outline for keyboard focus only.

**Faxes screen (Almas's screenshots)**
- Read/Done time belongs under each fax in the list (like Calls: "Done 6:23 AM"), not only in the header line.
- Three columns feel unbalanced: the document is small (53%) with empty space around it, the patient column is a long plain list, and in Done view the right column only says "Not filed to a chart." Plan: list (about 300 px) + the document filling the rest; the patient picker opens as a side sheet only when you choose "Add to chart" (search on top, this week's patients as compact cards, the chosen one shows name/DOB/chart with the confirm step). Done/filed faxes show their status as a pill in the header and no right column.
- Category chips take three rows at the top of the list; make them one compact scrolling row (or a dropdown).
- Header extras: drop the repeated "Done and Spam stay in this app" line (keep it in the (i) of More); shorten "received Thursday · 11:46 AM".
- List rows: the time gets cut off ("1:…"); give time its own spot next to the age badge, and keep the "Possibly <patient>" suggestion as a small second line.

**Sync card (loved, keep it)**
- The check marks sit off-center inside their filled circles (nudged left/down); center them exactly. Also check the spinner rings line up with the checks.

- Make syncing more visible without stopping work. Plan: (1) When it matters (app start with nothing fresh, or Sync now): the sync card appears larger in the middle over a soft blur of the page, with a "Keep working" button that shrinks it into the sidebar; it never blocks clicks for long and closes itself when done. (2) Background syncs: only the small sidebar status, no blur. (3) A panel whose information is old and being replaced gets a gentle blur with "Updating…" on it, while everything else stays usable.

**Settings → Messages**
- Rename the tab **Communication** (texts, emails, templates, sending hours belong together). Also reachable from where they're used: a small "Templates & settings" button in the Texts and Emails headers opens this same tab.
- Polish seen in the screenshot: template rows' chevrons don't line up (long previews push them); the empty Signature box is large and unlabeled (add a placeholder such as "Add your email signature"); cards stop at 860 px leaving empty space on wide screens.

**To investigate**
- Patient emails from RxNT aren't showing. The reader only looks for fields named Email/EmailAddress on the person record; RxNT may use another name (e.g. PatientEmail, PrimaryEmail) or another place. Next build: search the whole patient record for any field with "mail" in its name holding a valid address, and confirm the real field on a sanitized record.
- Record the actual error for each part (schedule, prescriptions, portal) and show it in Accounts and the sync card, so "couldn't load" always says what failed and why.
- RxNT shows "Needs a look · couldn't load" right after signing in (2.2.0, Windows), with Today's visits stuck on Updating and prescriptions "Checking RxNT…". Need which part failed (schedule or prescriptions) and why; the Accounts row should name the part and the reason instead of "couldn't load", and a successful sign-in should clear old failure counts and re-run both parts at once.

**Connection stability plan** (RxNT fixed itself a few minutes after sign-in: the first read failed, the retry worked)
- Right after a successful sign-in or Reconnect: clear old failures and read schedule, prescriptions and portal straight away (after a short pause so the new session settles).
- First failure retries in about 40 seconds (then 2, 5, 10 minutes) and shows "Retrying…", not "Needs a look". Amber only after two failures in a row; red only when sign-in is really needed.
- After sleep/wake or Wi-Fi coming back: wait until the internet is actually reachable and a few seconds have passed before syncing, so it doesn't fail on the first try.
- Keep one signed-in hidden RxNT window warm (light keep-alive every ~10 minutes, rebuilt if it misbehaves or grows), instead of starting fresh windows that each have to sign in.
- Recognize RxNT/Doximity extra pages (security check, notice, "continue") and say so with a one-click "Open RxNT to finish", instead of a vague failure.
- Save what was read even if one part times out, and record the exact reason for each failure (shown in Accounts and the sync card).

**Diagnostics log** (asked by Almas)
- A technical log kept on the computer for troubleshooting: each sync part (start, finish, how long, exact error), sign-ins and reconnects, sleep/wake and network changes, updates, crashes and background errors.
- No patient names, phone numbers, emails, message text or passwords/tokens: only part names, counts, timings and error reasons (scrubbed before writing).
- In the data folder under Logs/, one file per day, kept 30 days.
- Settings → App → "Save diagnostics" makes one file to send to Claude (or ChatGPT) when something goes wrong.

**Notes card (Almas's screenshot)**
- The day controls (‹ Today › search pin) drop to a second row, floating right and not lined up with the "Notes" title. Put them on the title row (compact) or as one tidy row under it aligned to the left edge.
- The writing doesn't sit on the ruled lines: the placeholder and text float between lines, and the first ruled lines are spaced unevenly. Match the line height to the ruling exactly so every line of text sits on a line.
- The margin line and the bottom rule use different colors from the other lines; make them consistent and lighter.

**Today feels crammed (Almas's screenshot)**
- Bug: the same new booking shows twice in Schedule changes (one "2m ago", one "12h ago"); one alert per patient + appointment.
- Four columns fight for space: Today's visits is narrow (title wraps, "Schedule" link cut off, time-strip hours squeezed), while Checklist sits mostly empty. Plan: Needs attention (wide) + Today's visits (wider) side by side; Checklist and Notes become one card with two tabs (Checklist | Notes) so they take one column, or move under on smaller windows.
- Visit rows are tall: time, name, type, note, then the status pill on its own line. Put the status pill on the right of the name line; keep the note line short.
- Needs attention rows: more breathing room between groups, quieter group headers, and one action column so buttons line up; show at most 3 per group with "Show more" (already) but keep the counts visible in the group header.
- Header row of each panel: title on one line, freshness as a small dot + time, actions right.

**Clock card**
- "Next visit in 8 h 25 min · Fi…" is cut off. Show it on two lines: "Next visit 3:00 PM" (bold) and "in 8 h 25 min · patient name" underneath; far-off visits (over 2 hours) can show just the time.

**"Syncing…" stuck in the sidebar**
- Cause: the patient-list refresh (every 4 hours) reads RxNT letter by letter, A to Z, plus patient details, which takes many minutes, and the sidebar counts it as "Syncing…" the whole time. Keep the sidebar on "Synced · 2 min ago" during that background refresh; show its progress ("Patient list 12 of 26") only in Settings → Accounts. Add a time limit so a stuck letter can't hold it forever.
- Also why patient emails are missing: patient details are only re-read every 14 days, so records read before email support haven't been re-read. Re-read details once for every patient that has never had its email checked (then back to every 14 days).

**Settings (i) buttons look off**
- The italic serif "i" in a thin ring sits slightly high/off-center and doesn't match the app's icons. Replace with a proper info icon (circle + dot + stem, same stroke as other icons), sized and vertically centered with the label text; tooltip opens on hover/focus with a short delay.

**Planned with it**: subtle macOS-style motion (view transitions, Done slide-out with a drawn check, count roll, sheet-style windows, list collapse, button press, Today panels fading from Updating to fresh, small celebration at To do = 0), short and quiet, honoring "Reduce motion". Then a ChatGPT test-and-debug pass on that version before release.

## 2.2.0 (Windows + Mac, Nov 24)
**Asked for**
- **No more 5-second auto-send.** The confirm window waits for you: Send, Send later, or Cancel (outside sending hours: "Send today at 8:00 AM" or "Send now anyway").
- **Simpler filters, the same everywhere**: To do · All · Sent (Done for faxes) · Spam. Unread is shown in the list itself (dot + bold), not as its own filter. The sidebar group is now "Inbox".
- **Email writing area**: a clean sheet with a quiet header (From / To / Subject), a soft toolbar, the body as a white page, and the actions in a footer that always stays visible.
- **Premium pass** across the app: softer layered shadows, finer borders, warmer background light, refined buttons and toggles, blurred backdrop behind windows, slimmer scrollbars.
- **Clock**: big serif time with small AM/PM, the full date, and a thin line showing how far through office hours the day is.
- **Settings, reorganized and shorter**: four tabs (Accounts · You & alerts · Messages · App). Explanations moved into a small (i) you can hover; each account row has one main button and a ⋯ menu (Check now, Sign out). Texts and Emails each have one card (sign-off, review link, templates / sender name, welcome packet, signature, templates). Data, backups, activity log and spam numbers are together under App.
- Faxes: one Done button; Download, Open in Doximity, Mark unread, Not patient-related and Spam are under More.

## 2.2.0 also includes: fixes from ChatGPT's second review, each checked against the code
- **Reply to the right number**: replying in a conversation from a patient's second number now goes to that number (it could use their main number). The number is shown next to Send. A slow-loading conversation can't paint over the one you just opened.
- **STOP check order**: both the patient list and STOP list are read first, then checked for a lock, before every text and its retry (the first text after a new lock could still go).
- **STOP never skipped after a crash**: replies are marked "processed" in the same save as the STOP itself, separate from the text history.
- **Fax chart match**: a matching chart number no longer passes when the DOB or name disagrees; names with accents compare correctly; no names at all isn't enough. Maria's confirmation is still required.
- **Failed or scheduled replies stay in Needs you**: only a reply that really went out clears the draft and marks the conversation done (Texts and Patients).
- **Siblings on one number**: a pending patient is merged into a chart only when it's clearly the same person (one pending record on that number and the name/DOB agree).
- **Back up now / before update**: the new backup is built and checked first, then replaces today's file; works even with daily backups off; reports the real result.
- **Emails don't count as text replies** (and don't show in the text thread or count as appointment reminders).
- **Scheduling IDs**: each Message window has its own random ID (two different texts at the same time can't collide); the welcome email gets its own ID from the same action.
- **Notes**: if a day's text can't save, the app stays on that day and retries, instead of moving on.
- **Fax download temp files** are removed at every start (a crash mid-download can't leave a copy).
- **Scheduled batch interrupted** by a lock or sign-out is tried again later; patients already texted are skipped; counts show all intended recipients.
- **Mark unread** on a text sticks even if RingRx already has it as read.
- **Emails**: "Load older emails" always shows when there are more; fixed a duplicate button id.
- **Slow sign-in pages** (RxNT, Doximity) no longer mark a saved password as wrong; only an explicit error does.
- **RingRx read retries**: up to 5,000 kept; ones that keep failing move to the back.
- Handled faxes stay handled for good (no 400-day expiry).
- Faster lists and badges: the combined text/call timeline is reused until something is saved.
- Alert clicks open the visit's local date (an evening visit no longer opens the next day).
- **Small windows / high scaling**: the window never opens bigger than the screen; Today's tiles stay on one row and drop their second line; Needs attention and Today's visits get more room; the sidebar tightens so Sync now stays visible; the fax side panel narrows.
- Texts: Mark unread, Spam and Block moved into one More menu. Calls: search also filters the callback list. Today panels stay clickable while updating.
- Settings loads its Email section directly (no longer depends on script order).
- Not taken: removing the send countdown (kept as before); renaming Emails "All" or Calls "Unread" (kept the same filter names on every screen, as asked).

## 2.1.0 (Windows + Mac, Nov 23)
**Same everywhere**
- Texts, Emails, Calls and Faxes share one set of filters: **Needs you · Unread · All · Sent (or Done) · Spam**, with counts.
- **Read and Done carry a time everywhere** ("Read 9:42 PM", "Done 9:50 PM", "Listened 9:44 PM"). Faxes now have Read/Unread (opening marks read, Mark unread), a **Done** button, and Spam / Not patient-related under More. Emails: Done = archive in Gmail, Report spam / Not spam, Spam folder.
- **One Message window**: Text and Email are two tabs of the same window, with the same **Send later** and **Send** buttons, from Today, the visit list, Patients and New message.
**Today and layout**
- Today opens with the last saved schedule right away. Each panel says **Updated 9:42** or **Updating…**; while it re-reads and what's shown is over 10 minutes old, the panel dims, then repaints when fresh.
- **Sync now** is in the sidebar under the status line ("Synced · 2 min ago"; click it for details). Duplicate refresh buttons removed.
- **Settings in four tabs**: Connections · Messages · Alerts · App.
**Safety fixes (from the code review, checked against the code)**
- If the patient list or STOP list can't be unlocked, no text is sent. Restoring a backup keeps every STOP (a later START still counts).
- Sending hours are checked for each patient in a batch; anyone not reached before closing goes to the morning. Scheduled batches remember who was already texted, so a retry never texts anyone twice.
- A double click or repeated request queues a message only once.
- An email whose sending was cut off (timeout, server error after submitting) is marked **Check this one** and never re-sent on its own. A sent email is never turned into "failed" by a logging hiccup.
- Notes: typing then switching days can no longer save one day's text onto another.
- Faxes already handled stay handled after the PDF is cleared (a small record is kept for a year).
- Shortening the schedule look-ahead no longer looks like cancellations.
- RingRx and Gmail: one sign-in refresh at a time; an expired access is refreshed and the read retried once; RingRx needing a code keeps the saved sign-in and stops retrying the password. Reads marked in the app that RingRx didn't take are retried after each sync.
- Visible keyboard focus.
**Not taken from the review (on purpose)**: removing the 5-second send countdown (kept; it already pauses for warnings and outside sending hours), per-item Done for texts (the current per-conversation Done works with the new Read/Done times).

## 2.0.0 (Windows + Mac, Nov 23)
- **Emails section**: the practice Gmail in the app. Read, reply, write, archive, mark unread; reading here marks it read in Gmail (and the other way round). Attachments can be saved.
- **Email composer**: formatting (bold, brand colors, headings, lists, links), templates, attachments, preview, signature. The Welcome template matches the practice's Gmail welcome, with the New Patient Welcome Packet attached by default (replaceable in Settings → Email).
- **Patients get email only from hello@ruhwellmed.com** ("Name patients see" in Settings). Sending is refused if Gmail doesn't list hello@ as a Send-as address.
- **Welcome email with the welcome text**: when RxNT has the patient's email, the welcome text window offers "Also email the welcome packet". Patient pages show the email (from RxNT, editable) with Email and Welcome email buttons.
- **Send later** for texts and emails (quick picks or a custom time) and **Sending hours** (default 8 AM–8 PM Mon–Sat): outside them the app offers "Send tomorrow at 8 AM" first; "Send now anyway" is still there. **Scheduled** list (Texts and Emails) to send now, change the time or cancel. Nothing is sent twice.
- **Read sync with RingRx**: a voicemail played or a text read in the app is marked read in RingRx; anything read in RingRx shows as read here.
- Google sign-in: Google Cloud project "Ruhwell Front Desk" (internal app, Gmail only). Load the key .json once per computer in Settings → Email, then Sign in with Google.
- Faxes: Download button saves a copy of the PDF (Downloads by default, named with the date and sender). The app's own copy stays encrypted; each save is in the activity log.
- Calls, calmer layout: time | name with one status chip ("Not called back", "Called back 4:54 PM", "New voicemail") | one short detail line | buttons on the right that never wrap (Text always last). Back-and-forth with the same number within an hour (missed → voicemail → call back) is one card with a small timeline. Voicemail text is one line; tap to read it all. The phone number no longer shows twice for unknown callers.
- Fix: voicemail length showed "268:48". RingRx gives it in milliseconds; it now reads "0:16".

## 1.6.4 (Windows + Mac, Nov 23)
- Fix: the app crashed with "Only absolute URLs are supported" when it started reading faxes. Inside Electron the reading library treated its language file as a web address. The file is now placed where the library always looks first, so it never goes online. Tested in a packaged build.
- Safety net: a background error is now written to the activity log instead of showing an error box.

## 1.6.3 (Windows + Mac, Nov 23)
Everything below (the 1.6.2 work plus the fixes from both reviews). 1.6.2 was a Windows-only test build.

### 1.6.2 work
Everything logged below is now in the code, tested (`npm test`) and smoke-run, except where noted: "cancelled & moved" is in Today and the Day view (not yet in the Week view or patient timeline), and the startup cleanup still needs a look at the names and paths of the entries on Almas's PC. The Windows installer script can only be compiled on the Windows build machine (CI).

### Installer and startup
- Installer takes care of processes: closes Ruhwell Front Desk (and any older Ruhwell app, e.g. Ruhwell Messenger) gently, then for sure, before installing (no locked files, nothing mid-save) and copies the saved data to "%APPDATA%\Ruhwell Front Desk Backup (before update)" before installing.
- "Restart to update" makes a fresh backup of today's data first (Windows and Mac).
- Installer takes care of startup: it removes every old or duplicate Ruhwell entry from Windows Startup apps (current user only; only entries with "Ruhwell" in the name or path). The app then registers itself once as "Ruhwell Front Desk", and also cleans leftovers on each start.

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
- Schedule: a cancelled visit whose patient is booked again (same chart, or same name + DOB; same day or within 14 days) is a **move**, not a cancellation (seen Nov 20: a patient cancelled at 10:00, was rebooked at 1:20 and checked in, but the 10:00 card still showed "Cancelled" with Message/Send).
  - The old card turns muted and compact: "Cancelled · moved to 1:20 PM" (or "Cancelled · moved to Mon, Nov 23"; wording chosen by Almas), with no Message/Send and no "Offer new time" anywhere (Day view, Today, alerts).
  - The new card says "Moved from 10:00 AM".
  - The day summary says "1 cancelled & moved" instead of a plain "1 cancelled"; the time strip and "not checked in" counts ignore the old one.
  - Same linking in the Week view and the patient's timeline. Add a test with this exact case.
- Today's visits: redo the time strip (current one reads as a "blob": back-to-back visits merge into one shape, no hours, cancelled/moved visits confuse it).
  - Each visit is its own small block with a 2px gap, colored by status (green checked in, teal confirmed, sand booked, grey not checked in); cancelled and moved visits are left out.
  - Hour ticks along the bottom (8, 9, 10 …) from office hours; a thin terracotta "now" line during the day.
  - Free time shows as a soft label only when the gap is 30 min or more ("Free until 12:40"), never squeezed or cut.
  - Hover or tap a block: name, time, status; click opens that visit.
  - If the day has no open gaps worth showing, the strip hides instead of drawing something meaningless.
- Fix (seen Nov 20 on 1.6.1): voicemail didn't play, and "Listen in RingRx" opened a page that doesn't exist.
  - Calls RingRx marks as voicemail now always find their recording (voicemail messages are kept with the calls and matched by number and time); before, some calls had no recording id and the app asked RingRx for the wrong one.
  - A failed play is written to the activity log with the reason (status and type only) so it can be traced.
  - "Listen in RingRx" and other RingRx links open the RingRx dashboard (its Activity list has voicemails and texts) instead of a missing page.
- In-app browser (seen Nov 20: "Open in Doximity" opened a normal browser that wasn't signed in). Every "Open in Doximity" and "Open in RxNT" opens inside the app, in a Ruhwell Front Desk window that uses the app's own saved sign-in (the same hidden session that reads faxes and the schedule), so it's already signed in. Back/forward/reload buttons and a "Open in my browser" option for anything else. Links to other sites still open in the normal browser.
- Fax preview (seen Nov 20: fax wouldn't open in the app): render the PDF pages in-app with a bundled PDF viewer (pdf.js) instead of relying on the built-in PDF plugin; page thumbnails, zoom, rotate. Still kept only in memory and the encrypted store.
- Fax pickup accuracy (seen Nov 20: "not picking up the right faxes"): verify each fax against its own page (sender, fax number, pages, received date and time) instead of guessing the date from the inbox's day headings; never treat an older fax as new; on the first run, show what was found and let Maria choose how far back to bring in (today / 3 days / 7 days). Recheck against what Maria saw before building.
- Voicemail (checked on RingRx's website Nov 23): Maria has only her own mailbox, no shared one, so that wasn't the cause. RingRx's own player uses /voicemails/<id>/voice_payload with the same sign-in the app uses, and it returns the MP3 fine. So the problem is the app picking the wrong recording id for some calls (fixed above); the activity log will now show the reason if one still fails. The voicemail record's "voicemail" field is the MP3 file name, not a link.
  - Reported Nov 20: faxes were missing (not wrong). To discuss in detail before building. Likely suspects: only the first page of the inbox list is read (Doximity loads more as you scroll), the first-run 3-day cutoff hides recent ones whose day heading wasn't read, and a fax whose PDF download fails is skipped silently. Fix all: scroll to load the full list back to the cutoff, show a fax even if its PDF didn't download yet ("Retry download"), and log each missed one.

- Fix (found Nov 23): fax preview was blocked by the app's own security setting (object-src 'none' stops the built-in PDF viewer). Allow it for the in-memory fax only (object-src blob:), on top of the bundled PDF viewer planned above.
- Fax dates (found Nov 23 on Doximity): the inbox groups recent faxes under weekday names ("Thursday", "Tuesday", "Monday"), not dates. The app couldn't read those and treated them as "now", so recent faxes got the wrong day. Fixed: a weekday means the most recent past one. (Still to confirm with Almas which faxes were missing.)

### From ChatGPT's review of 1.6.1 (Nov 23), each checked against the code
- **Missing faxes, root cause confirmed:** weekday headings ("Thursday") were read as Jan 1, 2026, so on the first run those faxes counted as older than 3 days and were put on the ignore list for good. The weekday fix is in. Also needed: on update, clear that ignore list and re-read the inbox so the skipped faxes come in; treat a date the app can't read as "unknown", never as old.
- **Faxes whose download fails** are saved in the list as "Download failed · Retry" instead of vanishing. Retries rotate, so a few bad ones can't block the rest.
- **Download button bug:** a script error on the fax page counted as "clicked". Only an actual click counts, and the TIF fallback runs whenever the PDF doesn't arrive. The download catcher only accepts files from that fax's own window.
- **Fax type from the file itself:** a PDF that Doximity sends as generic data was labeled TIF with no preview. The app now checks the first bytes (PDF or TIFF), stores the real type, rejects anything else (an HTML error page, for example), and fixes existing faxes when they're opened.
- **Read the whole inbox:** scroll the sidebar until no new faxes load, back to the cutoff.
- **"Open in Doximity"** uses the app's signed-in window (in-app browser above) with Doximity's own link format.
- **Fax list race:** clicking faxes quickly could show fax A's filing controls while fax B is highlighted. Each open is numbered and stale ones are dropped.
- **Filing to RxNT, safety fixes (must be in before filing is used on real charts):**
  - Document title includes the fax's own ID, and verification needs an exact match on that title in that chart after refresh. Two faxes from the same sender on the same day can't stand in for each other.
  - No double uploads: the fax is claimed before the upload starts, and the attempt (fax, confirmed chart, state) is saved before Save is pressed. After a crash or an uncertain result the app only re-checks the chart; it never presses Save again on its own. One filing at a time.
  - Right patient: if RxNT opens a chart directly from the search, its chart number, name and DOB must match the picked patient. Missing DOB, more than one match, or anything conflicting stops it. The main process re-checks the confirmed chart right before Save.
  - "Filled" and "saved" only count when they really happened: create the file with the RxNT page's own File/DataTransfer objects and the real file type, check that RxNT's form shows the attachment, title and category, check that Save is enabled, and treat clicking Save as an attempt, not a success.
  - Before 1.6.2 goes to Maria, test filing once on a test patient chart.
- **Voicemail:**
  - Play only shows when the call has a real recording id; it never falls back to the call's own id.
  - If reading voicemails fails during a sync, keep the existing voicemail-to-call matches instead of wiping them.
  - Match voicemails to calls only when it's one-to-one (an unclaimed call that went to the mailbox); otherwise the voicemail gets its own row.
  - Give clear failure reasons (no recording id, HTTP status, wrong file type, playback blocked) in the activity log, including when play() fails.
- **Installer:** do the close-the-app + backup in the customCheckAppRunning hook (runs right where electron-builder checks for the running app, before the old version is removed). Back up to a dated folder, verify the copy, and stop the update if copying existing data fails; a first install with no data is fine. Local `dist:win` builds the NSIS installer too (it was building the portable version, so the installer was never exercised locally).
- **Startup entries:** one stable name and the installed exe path. Remove only confirmed old Ruhwell entries (check names and paths on Almas's PC before writing the cleanup), then check the result: one entry when on, none when off.
- Voicemail labels (seen Nov 23 on Almas's PC): two calls showed "New voicemail · Play" (1 min, 31 sec), but RingRx's own list has no message for them (its 4 voicemails are 15–39 sec). RingRx sends a call to the mailbox ("mbx-" in its call path) whether or not the caller leaves a message, and the app took that as a voicemail. New rule: it's a voicemail only when RingRx has the message. Otherwise the call shows as "Missed · went to voicemail, no message" (still a missed call that may need a callback), with no Play button and no "New voicemail" badge.
- Faxes page wording: when Doximity isn't signed in on this computer, say so plainly with a "Sign in to Doximity" button right there, instead of "No faxes waiting".
- Status line (seen Nov 23: it said "All connected" while Doximity wasn't signed in in the app and the Faxes page said to sign in): the line now comes from the same real checks as Settings → Connections. A red account says "<name> sign-in needed", amber says what's wrong, and a source that isn't set up is named ("Connected · Doximity not set up"). It never says "All connected" unless every set-up account passed its last real read.
- Settings, simplified (asked Nov 23: "super complicated"):
  - Settings becomes 4 short sections with a small menu on the left: **Connections · Alerts · Messages · App**. Each opens on its own; nothing else on screen.
  - **Connections:** one line per account, like "● RxNT · Working · 5 min ago". Click a line to see the details (signed in as, saved sign-in / Forget it, Doximity on/off, how far back faxes go, Sign out). One "Check everything" button at the top. The explanation text goes into a small (i) tooltip. The patient list folds into the RxNT line.
  - **Alerts:** instead of a grid of checkboxes, a short list where each alert has one simple choice: **Pop-up · Pop-up + text · Off**. The alert-cell number only appears once something is set to text. "Visit starting in 15 min" stays as a single line.
  - **Messages:** your name/signature, templates (compact list as now), Google review link.
  - **App:** updates, start with Windows/Mac, backups, activity log, spam numbers.
  - Same look as now (Ruhwell colors), just fewer things at once. Nothing is removed, only tucked one click deeper.
- Modular app (asked Nov 23: "so future changes don't break the whole app"):
  - Split by feature. Each section (Schedule, Texts, Calls, Faxes, RxNT, Timer, Checklist & notes, Settings, Updates) gets its own folder with its main-process part, its screen and its tests. main.js keeps only start-up, the window, and wiring the sections in.
  - Each section registers its own IPC channels under its own name (e.g. "faxes:…"), and the window only talks to a section through its small preload API.
  - Fault isolation: if a section fails to load or throws, only that section shows "This part had a problem · Retry"; the rest of the app keeps working. Background syncs run per section with their own error handling, so one failing source never stops the others.
  - Shared pieces stay in one place: storage, activity log, notifications, sign-in helpers, colors and components.
  - Each section can be switched off with a setting, so a new feature can ship turned off and be tried first on Windows.
  - Tests per section plus the packaging check. A build only goes out if every section's tests pass.
  - Do this as its own release with no new features in it, then confirm everything behaves exactly the same before adding anything new.
- Fixes from the first look at 1.6.2 on Windows (Nov 23):
  - Fax preview showed the page turned sideways and zoomed into the margin: the viewer ignored the page's own rotation (faxes are often stored turned). It now keeps it, opens at "Fit width", and Zoom/Rotate/Fit width work from there.
  - Monday's fax (5 pages) was missing: "last 7 days" counted back from this exact minute, so a fax from that morning fell just outside. It now counts whole days, and the ignore list is cleared once more so it comes in.
  - "Which patient is this for?" showed "No matches" with nothing typed: "this week's patients" now come from each patient's last/next visit. Clearer hint when a search finds nothing.
- Faxes, round 2 (Nov 23, after comparing with Doximity):
  - Everything in the Doximity inbox comes into the app (not just the last few days); the first full import doesn't send alerts. Settings can still limit it.
  - Sorting help: each fax's first pages are read on this computer (OCR, bundled; nothing leaves the computer) and get a category: Prior authorization, Pharmacy, Lab results, Records, Referral, Insurance, Notice, Other or Unreadable. Category chips above the list filter by type.
  - Possible patients found on the fax (name and/or DOB) show under the fax and at the top of "Which patient is this for?" with what matched. Still only a suggestion: Maria picks and confirms the chart before anything is filed. Only the category and suggestions are kept, never the fax text.
  - "Which patient is this for?" search box: one clean border (the double box is gone).
- Calls, RingRx-style timing: the time and day are on the left of every row, and each row says exactly what happened, e.g. "Inbound · 0:43 · Left voicemail 0:16 at 4:53 PM", "Inbound · 0:04 · Hung up at voicemail, no message", "Outbound · 4:09". The voicemail's own length and time come from RingRx, so a voicemail never seems missing just because it's shown on its call.

### From ChatGPT's hands-on test of 1.6.2 on Windows (Nov 23), checked against the code
Passed there: voicemail playback (2 recordings, speeds), "no message" labels, installer backup + kept sign-ins, Open in Doximity in-app, moved visits, quick capture.
Fixed now:
- **Release blocker: filing never pressed Save.** The save step was lost when the fill/ready checks were rewritten. Restored, with the checks repeated right before a single click (right chart, one file, title, valid form, Save enabled) and a guard against a second click. Test added.
- A chart re-check that couldn't read the chart now counts as "unknown", never as "not there", so it can't lead to a second upload.
- No chart number from RxNT: filing is blocked (on the screen and in the main process).
- STOP no longer overwrites a do-not-text Maria set by hand, so a later START can't undo her choice.
- A "YES" on a shared or reused number only confirms when exactly one person got an appointment reminder there (sent texts now store the appointment id). Otherwise: "Reply needs review".
- One confirmed send = one operation id; a duplicate request returns the first result instead of texting twice.
- Two cancellations/bookings with no patient id are never paired as one reschedule (all three pairing paths). Test added.
- RxNT shows green only when every part is fresh (schedule AND prescriptions); otherwise "checking prescriptions…".
- A fax date the app can't read shows "Date unavailable", never "Today".
- A Front Desk text hides its RingRx copy only when the words match too.
- RingRx: a dropped connection during re-sign-in keeps the saved sign-in.
- Fax viewer: every fax opens upright and fit to the pane (rotation/zoom no longer carry over); the previous fax is released when switching.
Logged for later (not done yet):
- Today: one count per queue everywhere (tile, summary and sidebar agree, e.g. "10 need a reply · 3 unread"), one clear next action on the top card.
- Speed: draw only visible fax pages; RxNT portal messages only re-read changed conversations; show the last snapshot instead of blank screens while syncing; record time-to-first-screen.
- Small polish: "Quick task · Ctrl+Shift+Space" hint next to the checklist; "Line → task" becomes "Add this line to checklist"; fall back to another shortcut if that one is taken; time strip after hours says "Today's visits have ended" / "First visit at …"; keep "Needs callback" separate from "Unheard".
- Bigger ideas, ranked by time saved: one follow-up per patient across calls/texts/portal; pre-visit readiness line; refill follow-through; a "waiting on" queue; end-of-day handoff to tomorrow.
- Startup entry count: Windows blocked ChatGPT from reading it; check by hand in Task Manager.
