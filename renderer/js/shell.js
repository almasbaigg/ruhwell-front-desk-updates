/* Sign-in, navigation, status panel and the date picker. */
/* ---------- Boot and sign-in ---------- */
function screen(id) { ['booting', 'onboarding', 'shell'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
async function boot() {
  settings = await window.api.getSettings(); info = await window.api.info();
  $('s-login-label').textContent = info.platform === 'darwin' ? 'Open at login' : 'Start with Windows';
  $('app-version').textContent = `Version ${info.version}`;
  $('up-ver').textContent = `Version ${info.version}`;
  $('p-kbd').textContent = isMac ? '⌘F' : 'Ctrl F';
  accounts = await window.api.accounts();
  // Check for real and sign back in quietly first; only show the sign-in screen for what still needs you.
  // If both look signed in, open straight away and check in the background.
  const verify = window.api.verifyAccounts().catch(() => null);
  if (accounts.rxnt.connected && accounts.ringrx.connected) {
    showShell();
    const v = await verify;
    if (v && (!v.rxnt || !v.ringrx)) { accounts.rxnt.connected = v.rxnt; accounts.ringrx.connected = v.ringrx; showOnboarding(); }
    return;
  }
  screen('booting');
  const v = await verify;
  if (v) { accounts.rxnt.connected = v.rxnt; accounts.ringrx.connected = v.ringrx; }
  if (allSet()) return showShell();
  showOnboarding();
}
function showOnboarding() {
  screen('onboarding');
  $('rr-user').value = ''; $('rr-pass').value = ''; $('rr-otp').classList.add('hidden'); $('rr-err').textContent = '';
  markStep('step-rxnt', accounts.rxnt.connected); markStep('step-ringrx', accounts.ringrx.connected); markStep('step-gmail', accounts.gmail && accounts.gmail.connected);
  // Returning user: hide what's already working and say plainly what still needs them.
  const returning = !!settings.currentProfile && (accounts.rxnt.connected || accounts.ringrx.connected);
  $('step-rxnt').classList.toggle('hidden', returning && accounts.rxnt.connected);
  $('step-ringrx').classList.toggle('hidden', returning && accounts.ringrx.connected);
  $('step-gmail').classList.toggle('hidden', returning);
  $('ob-title').textContent = returning ? `Sign back in to ${[!accounts.rxnt.connected && 'RxNT', !accounts.ringrx.connected && 'RingRx'].filter(Boolean).join(' and ')}` : 'Welcome';
}
const allSet = () => accounts.rxnt.connected && accounts.ringrx.connected;
function markStep(id, done) {
  $(id).classList.toggle('done', !!done); $(id).querySelector('.done-badge').classList.toggle('hidden', !done);
  $('ob-continue').disabled = !($('step-rxnt').classList.contains('done') && $('step-ringrx').classList.contains('done'));
}
$('ob-rxnt').onclick = async () => {
  $('ob-rxnt').textContent = 'Waiting for RxNT…'; $('ob-rxnt').disabled = true;
  const ok = await window.api.rxntSignIn();
  $('ob-rxnt').textContent = 'Sign in to RxNT'; $('ob-rxnt').disabled = false;
  if (ok) { accounts.rxnt.connected = true; markStep('step-rxnt', true); if (allSet()) showShell(); } else toast('RxNT sign-in was closed.');
};
$('ob-ringrx-form').onsubmit = async (e) => {
  e.preventDefault(); $('rr-err').textContent = ''; $('rr-submit').disabled = true; $('rr-submit').textContent = 'Signing in…';
  const r = await window.api.ringrxLogin({ username: $('rr-user').value.trim(), password: $('rr-pass').value, otp: $('rr-otp').value.trim() });
  $('rr-submit').disabled = false; $('rr-submit').textContent = 'Sign in to RingRx';
  if (r.ok) { $('rr-pass').value = ''; accounts.ringrx = { connected: true, username: r.username }; markStep('step-ringrx', true); if (allSet()) showShell(); return; }
  if (r.code === 'OTP_REQUIRED') { $('rr-otp').classList.remove('hidden'); $('rr-otp').focus(); }
  $('rr-err').textContent = r.error;
};
$('ob-gmail').onclick = async () => {
  $('ob-gmail').textContent = 'Waiting for Google…'; $('ob-gmail').disabled = true;
  const ok = await window.api.gmailSignIn();
  $('ob-gmail').textContent = 'Sign in to Gmail'; $('ob-gmail').disabled = false;
  if (ok) { accounts.gmail = { connected: true }; markStep('step-gmail', true); } else toast('Gmail sign-in was closed. You can do it later in Settings.');
};
$('ob-continue').onclick = showShell;

/* ---------- Shell & navigation ---------- */
let view = 'today', schedMode = 'visits';
function showShell() {
  screen('shell'); paintConnections(); go('today');
  window.api.spamReview().then((l) => { if (l && l.length) toast(`${l.length === 1 ? 'A number' : l.length + ' numbers'} on your spam list now belong to a patient, so ${l.length === 1 ? 'it was' : 'they were'} taken off: ${l.map(fmtPhone).join(', ')}`); }).catch(() => {});
  window.api.ringrxFrom().then((n) => { sendFrom = n || ''; }).catch(() => {});
}
document.querySelectorAll('.nav').forEach((b) => (b.onclick = () => go(b.dataset.view === 'schedule' ? schedMode : b.dataset.view)));
document.querySelectorAll('.sched-toggle button').forEach((b) => (b.onclick = () => { schedMode = b.dataset.mode; if (schedMode === 'calendar') weekStart = mondayOf(currentDate); go(schedMode); }));
function go(v) {
  if (v === 'alerts' || v === 'desk') v = 'today';
  view = v; hidePopover();
  if (v === 'visits' || v === 'calendar') schedMode = v;
  const navKey = v === 'visits' || v === 'calendar' ? 'schedule' : v;
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('active', b.dataset.view === navKey));
  document.querySelectorAll('.sched-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.mode === v));
  document.querySelectorAll('.view').forEach((x) => x.classList.toggle('hidden', x.id !== 'view-' + v));
  $('actionbar').style.display = v === 'visits' ? '' : 'none';
  $('content').scrollTop = 0;
  ({ today: loadToday, visits: () => loadDay(currentDate), calendar: () => loadWeek(weekStart || mondayOf(currentDate)), patients: () => loadPatients(), texts: loadTexts, calls: loadCalls, rx: loadRx, faxes: loadFaxes, settings: loadSettings }[v] || (() => {}))();
}
window.api.onNav((v) => go(v));
window.api.onNavDate((d) => { go('visits'); loadDay(d); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    const box = { texts: 'tx-search', calls: 'ca-search' }[view];
    if (box) $(box).focus(); else { if (view !== 'patients') go('patients'); setTimeout(() => $('p-search').focus(), 30); }
  }
  if (e.key === 'Escape') { hidePopover(); if (!$('overlay').classList.contains('hidden') && !modalLocked()) closeModal(); }
});

/* ---------- Status: one quiet line; details on click ---------- */
const minsAgo = (iso) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} hr ago` : `${Math.round(m / 1440)} d ago`; };
function navBadge(id, n) { $(id).textContent = n || ''; $(id).classList.toggle('hidden', !n); }
function paintSync(st) {
  if (st) lastSync = st; st = lastSync; if (!st) return;
  const N = st.needs || {};
  navBadge('nb-texts', N.texts); navBadge('nb-calls', N.calls); navBadge('nb-rx', ((st.rx || {}).count || 0) + ((st.rx || {}).work || 0)); navBadge('nb-faxes', (st.faxes || {}).count || 0);
  window.__lastSync = st;
  const G = st.gmail || {}, P = st.patients || {};
  // The one line: green when all is well, otherwise the first thing that needs you.
  const backupFailed = st.backup && st.backup.ok === false && st.backup.failedAt && Date.now() - new Date(st.backup.failedAt) < 2 * 864e5;
  const problem = st.locked ? 'Saved data locked · restart the app' : !st.rxnt ? 'RxNT sign-in needed' : !st.ringrx ? 'RingRx sign-in needed' : !G.connected ? 'Gmail sign-in needed' : (st.alerts || {}).lastError ? 'Can\'t reach RxNT · retrying' : (st.messages || {}).error === 'failed' ? 'Can\'t reach RingRx · retrying' : backupFailed ? 'Backup failed · see Settings' : null;
  const working = busy.high || busy.low || P.running || (st.messages || {}).running;
  $('status-line').className = 'status-line ' + (problem ? 'warn' : working ? 'busy' : 'on');
  $('status-text').textContent = problem || (working ? 'Syncing…' : `All connected · ${minsAgo((st.alerts || {}).lastRun || (st.schedule || {}).at) || 'just now'}`);
}
async function paintConnections() { const st = await window.api.syncStatus(); accounts.rxnt.connected = st.rxnt; accounts.ringrx.connected = st.ringrx; paintSync(st); }
window.api.onSync((st) => { paintSync(st); if (!st.patients.running && view === 'patients') loadPatients(true); if (view === 'settings') paintSyncTimes(); });
setInterval(() => paintSync(), 30000);
// The status line only shows status; details and resync live in Settings → Sync.
// Sync / Check everything: a small card with the Ruhwell mark filling with teal as each part finishes,
// and a checklist beside it. Progress is real (parts done), not a guessed percentage. Never blocks the app.
const MARK = '<rect y="43.34" width="43.16" height="43.16" rx="2.88"/><rect x="47.48" y="87.31" width="43.16" height="43.16" rx="2.88"/><path d="m131.62,43.56h-34.99s-2.43,0-2.43,0c-.04,0-.08,0-.13.01h-3.15v-3.17s.01-.07.01-.11v-.99s0-36.43,0-36.43C90.93,1.28,89.65,0,88.06,0h-37.42c-.92,0-1.73.43-2.24,1.1v.02c-.35.41-.61.93-.61,1.51,0,25.41,2.98,43.69,21.68,62.39s37.39,21.67,62.44,21.67c.56,0,1.06-.26,1.45-.6h.02c.67-.51,1.1-1.32,1.1-2.24v-37.41c.01-1.59-1.28-2.88-2.87-2.88Z"/>';
const SYNC_PARTS = [['schedule', 'RxNT schedule'], ['rx', 'Prescriptions & To-Do'], ['portal', 'Portal messages'], ['comms', 'Texts & calls'], ['gmail', 'Email'], ['faxes', 'Faxes']];
let syncCardBusy = null;
async function syncEverything(only) {
  if (syncCardBusy) return syncCardBusy;
  const parts = SYNC_PARTS.filter(([k]) => !only || only.includes(k));
  const card = $('sync-card');
  card.innerHTML = `<div class="sc-mark"><svg viewBox="-4 -4 142.5 138.5" aria-hidden="true"><defs><clipPath id="sc-clip">${MARK}</clipPath></defs>
      <g class="sc-base">${MARK}</g><g clip-path="url(#sc-clip)"><g class="sc-fill" style="transform:translateY(131px)"><path class="sc-wave" d="M-140 0 q17.5 -7 35 0 t35 0 t35 0 t35 0 t35 0 t35 0 t35 0 t35 0 V140 H-140Z"/></g></g></svg></div>
    <div class="sc-body"><b class="sc-title">Syncing…</b><ul>${parts.map(([k, l]) => `<li data-k="${k}"><i></i><span>${l}</span><em></em></li>`).join('')}</ul></div>`;
  card.className = 'sync-card show';
  const fill = card.querySelector('.sc-fill');
  let done = 0; const total = parts.length, bad = [];
  const level = () => { fill.style.transform = `translateY(${131 - (131 + 8) * (done / total)}px)`; };
  requestAnimationFrame(() => card.querySelectorAll('li').forEach((li, i) => setTimeout(() => li.classList.add('in', 'run'), i * 70)));
  window.api.syncPatients();
  syncCardBusy = Promise.all(parts.map(async ([k, label]) => {
    let r; try { r = await window.api.syncPart(k); } catch { r = { ok: false, reason: "couldn't load" }; }
    const li = card.querySelector(`li[data-k="${k}"]`);
    li.classList.remove('run'); li.classList.add(r.off ? 'off' : r.ok ? 'ok' : 'bad');
    if (r.off) li.querySelector('em').textContent = 'not set up';
    if (!r.ok) { li.querySelector('em').textContent = r.reason || "couldn't load"; bad.push(label); }
    done++; level();
  })).then(() => {
    const t = card.querySelector('.sc-title');
    t.textContent = bad.length ? `${bad.length} need${bad.length === 1 ? 's' : ''} attention` : 'All up to date';
    card.classList.add(bad.length ? 'warn' : 'done');
    paintConnections(); if (view === 'today') loadToday();
    setTimeout(() => card.classList.remove('show'), bad.length ? 9000 : 3200);
    card.onclick = () => { card.classList.remove('show'); if (bad.length) go('settings'); };
  }).finally(() => { syncCardBusy = null; });
  return syncCardBusy;
}

/* ---------- Date popover ---------- */
let popMonth = null;
const knownDays = {};
function hidePopover() { $('popover').classList.add('hidden'); }
function showDatePopover(anchor) {
  const [y, m] = popMonth.split('-').map(Number), first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
  let cells = ''; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); const s = ymd(d); cells += `<button data-d="${s}" class="${d.getMonth() !== m - 1 ? 'out' : ''} ${s === ymd() ? 'today' : ''} ${s === currentDate ? 'sel' : ''}">${d.getDate()}${knownDays[s] > 0 ? '<i></i>' : ''}</button>`; }
  const P = $('popover');
  P.innerHTML = `<div class="mini-head"><button id="pm-prev"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><b>${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><button id="pm-next"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
    <div class="mini-grid">${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => `<span>${x}</span>`).join('')}${cells}</div>
    <div class="popover-actions"><button class="btn link" id="pm-today">Today</button><button class="btn link" id="pm-tomorrow">Tomorrow</button></div>`;
  const r = anchor.getBoundingClientRect(); P.style.top = `${r.bottom + 6}px`; P.style.left = `${Math.max(12, r.left + r.width / 2 - 134)}px`; P.classList.remove('hidden');
  $('pm-prev').onclick = () => { popMonth = ymd(new Date(y, m - 2, 1)).slice(0, 7); showDatePopover(anchor); };
  $('pm-next').onclick = () => { popMonth = ymd(new Date(y, m, 1)).slice(0, 7); showDatePopover(anchor); };
  $('pm-today').onclick = () => { hidePopover(); loadDay(ymd()); };
  $('pm-tomorrow').onclick = () => { hidePopover(); loadDay(addDays(ymd(), 1)); };
  P.querySelectorAll('.mini-grid button').forEach((b) => (b.onclick = () => { hidePopover(); loadDay(b.dataset.d); }));
}
document.addEventListener('mousedown', (e) => { if (!$('popover').contains(e.target) && !e.target.closest('#day-pick')) hidePopover(); });
$('day-pick').onclick = (e) => { if (!$('popover').classList.contains('hidden')) return hidePopover(); popMonth = currentDate.slice(0, 7); showDatePopover(e.currentTarget); };


/* ---------- Automatic updates: a quiet note when a new version is ready ---------- */
function paintUpdate(st) {
  const b = $('update-ready'), ready = st && st.status === 'ready', avail = st && st.status === 'available';
  b.classList.toggle('hidden', !(ready || avail));
  if (ready) b.innerHTML = `${I.check}<span>Update ready (${esc(st.version)})<small>Restart to finish</small></span>`;
  if (avail) b.innerHTML = `${I.check}<span>Update available (${esc(st.version)})<small>Download, then drag to Applications</small></span>`;
  // Settings > Updates
  const MSG = { checking: 'Checking…', downloading: `Downloading version ${st && st.version}…`, current: "You're on the latest version.",
    ready: `Version ${st && st.version} is ready. Restart to finish.`, available: `Version ${st && st.version} is out. Download it, quit this app, then drag the new one to Applications.`, error: `Couldn't check for updates${st && st.error ? ` (${String(st.error).split('\n')[0].slice(0, 90)})` : ''}. It tries again on its own.`,
    idle: 'The app checks on its own every few hours and downloads quietly.' };
  if ($('up-msg')) {
    $('up-msg').textContent = (st && st.status === 'unavailable') ? st.error : MSG[(st && st.status) || 'idle'] || MSG.idle;
    $('up-restart').classList.toggle('hidden', !(ready || avail));
    $('up-restart').textContent = avail ? 'Download update' : 'Restart to update';
    $('up-check').disabled = !!st && (st.status === 'checking' || st.status === 'downloading');
  }
}
if ($('up-ver')) {
  $('up-check').onclick = async () => paintUpdate(await window.api.updateCheck());
  $('up-restart').onclick = () => window.api.updateRestart();
}
window.api.onUpdate(paintUpdate);
window.api.updateStatus().then(paintUpdate);
$('update-ready').onclick = () => window.api.updateRestart();

/* ---------- Clock with a next-visit countdown (time awareness at a glance) ---------- */
function paintClock() {
  const now = new Date();
  $('clock-time').textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('clock-date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const next = (((typeof dayStore !== 'undefined' && dayStore[ymd()]) || {}).items || [])
    .filter((v) => ['booked', 'confirmed'].includes(stateOf(v)) && new Date(v.start) > now - 5 * 60000)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
  const el = $('clock-next');
  if (!next) { el.textContent = ''; el.className = ''; return; }
  const mins = Math.round((new Date(next.start) - now) / 60000);
  el.textContent = mins <= 0 ? `Visit now · ${fullName(next)}` : `Next visit in ${mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min'} · ${fullName(next)}`;
  el.className = mins <= 5 ? 'u-red' : mins <= 10 ? 'u-amber' : '';
  el.title = typeof visitBrief === 'function' ? visitBrief(next) : '';
}
paintClock();
setInterval(paintClock, 15000);
