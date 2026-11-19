/* Sign-in, navigation, status panel and the date picker. */
/* ---------- Boot and sign-in ---------- */
function screen(id) { ['onboarding', 'shell'].forEach((s) => $(s).classList.toggle('hidden', s !== id)); }
async function boot() {
  settings = await window.api.getSettings(); info = await window.api.info();
  $('s-login-label').textContent = info.platform === 'darwin' ? 'Open at login' : 'Start with Windows';
  $('app-version').textContent = `Version ${info.version}`;
  $('up-ver').textContent = `Version ${info.version}`;
  $('p-kbd').textContent = isMac ? '⌘F' : 'Ctrl F';
  accounts = await window.api.accounts();
  if (accounts.rxnt.connected && accounts.ringrx.connected) return showShell();
  showOnboarding();
}
function showOnboarding() {
  screen('onboarding');
  $('rr-user').value = ''; $('rr-pass').value = ''; $('rr-otp').classList.add('hidden'); $('rr-err').textContent = '';
  markStep('step-rxnt', accounts.rxnt.connected); markStep('step-ringrx', accounts.ringrx.connected); markStep('step-gmail', accounts.gmail && accounts.gmail.connected);
}
function markStep(id, done) {
  $(id).classList.toggle('done', !!done); $(id).querySelector('.done-badge').classList.toggle('hidden', !done);
  $('ob-continue').disabled = !($('step-rxnt').classList.contains('done') && $('step-ringrx').classList.contains('done'));
}
$('ob-rxnt').onclick = async () => {
  $('ob-rxnt').textContent = 'Waiting for RxNT…'; $('ob-rxnt').disabled = true;
  const ok = await window.api.rxntSignIn();
  $('ob-rxnt').textContent = 'Sign in to RxNT'; $('ob-rxnt').disabled = false;
  if (ok) { accounts.rxnt.connected = true; markStep('step-rxnt', true); } else toast('RxNT sign-in was closed.');
};
$('ob-ringrx-form').onsubmit = async (e) => {
  e.preventDefault(); $('rr-err').textContent = ''; $('rr-submit').disabled = true; $('rr-submit').textContent = 'Signing in…';
  const r = await window.api.ringrxLogin({ username: $('rr-user').value.trim(), password: $('rr-pass').value, otp: $('rr-otp').value.trim() });
  $('rr-submit').disabled = false; $('rr-submit').textContent = 'Sign in to RingRx';
  if (r.ok) { $('rr-pass').value = ''; accounts.ringrx = { connected: true, username: r.username }; markStep('step-ringrx', true); return; }
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
  ({ today: loadToday, visits: () => loadDay(currentDate), calendar: () => loadWeek(weekStart || mondayOf(currentDate)), patients: () => loadPatients(), texts: loadTexts, calls: loadCalls, rx: loadRx, settings: loadSettings }[v] || (() => {}))();
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
  navBadge('nb-texts', N.texts); navBadge('nb-calls', N.calls); navBadge('nb-rx', ((st.rx || {}).count || 0) + ((st.rx || {}).work || 0));
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
async function syncEverything() {
  toast('Checking RxNT, RingRx and Gmail…');
  window.api.syncPatients();
  await Promise.all([window.api.watchCheck(), window.api.commsSync(), window.api.rxRefresh(), window.api.gmailCheck()]);
  paintConnections(); if (view === 'today') loadToday();
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
