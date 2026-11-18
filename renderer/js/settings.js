/* Settings: accounts, messages, notifications, alerts, templates, data and backups. */
/* ---------- Settings ---------- */
let draft = null;
const AUD = [['after', 'After visit (checked in)'], ['upcoming', 'Upcoming visits'], ['cancelled', 'Cancellations / no-shows'], ['any', 'Anywhere']];
async function loadSettings() {
  settings = await window.api.getSettings(); accounts = await window.api.accounts();
  draft = JSON.parse(JSON.stringify(settings));
  $('s-rxnt-state').textContent = accounts.rxnt.connected ? 'Connected' : 'Not connected';
  window.api.syncStatus().then((st) => { if (accounts.rxnt.connected && st.rxntUser) $('s-rxnt-state').textContent = `Signed in as ${st.rxntUser}`; });
  $('s-ringrx-state').textContent = accounts.ringrx.connected ? `Signed in as ${accounts.ringrx.username || 'you'}` : 'Not connected';
  $('s-ringrx-out').textContent = accounts.ringrx.connected ? 'Sign out' : 'Sign in';
  $('s-from').textContent = accounts.ringrx.connected ? 'Finding sending number…' : '';
  window.api.ringrxFrom().then((n) => { sendFrom = n || ''; $('s-from').textContent = accounts.ringrx.connected ? (n ? `Texts send from ${fmtPhone(n)}` : 'Sending number not available from RingRx') : ''; });
  const G = accounts.gmail || {};
  $('s-gmail-state').textContent = G.connected ? `Signed in${G.account ? ' as ' + G.account : ''}${G.unread != null ? ` · ${G.unread} unread` : ''}` : 'Not connected';
  $('s-gmail-connect').textContent = G.connected ? 'Reconnect' : 'Sign in';
  $('s-gmail-out').classList.toggle('hidden', !G.connected);
  // Alerts: the cell that gets alert texts
  const cell = (draft.alertCells || {})[settings.currentProfile] || '';
  $('s-cell').value = cell ? fmtPhone(cell) : '';
  // Empty means the practice's RingRx number (the default); type a cell to send elsewhere.
  if (!cell) window.api.ringrxFrom().then((n) => { if (n && !$('s-cell').value) $('s-cell').placeholder = `${fmtPhone(n)} (RingRx)`; });
  const ap = draft.alertPrefs || {};
  document.querySelectorAll('#view-settings input[data-k]').forEach((x) => { x.checked = !!(ap[x.dataset.k] || {})[x.dataset.c]; });
  $('w-soon').value = String((ap.soon || {}).minutes || 15);
  $('w-days').value = String(draft.watch.daysAhead);
  $('sy-start').value = (draft.sync || {}).busyStart || '08:00'; $('sy-end').value = (draft.sync || {}).busyEnd || '17:00';
  paintSyncTimes();
  $('s-review').value = draft.reviewLink || ''; $('s-sig').value = draft.signature || ''; $('s-sig-on').checked = !!draft.signatureOn;
  $('s-sum-on').checked = !!draft.summary.on; $('s-sum-time').value = draft.summary.time;
  $('s-nudge-on').checked = !!draft.nudge.on; $('s-nudge-time').value = draft.nudge.time;
  $('s-login').checked = !!draft.openAtLogin; $('s-close').checked = !!draft.closeToTray; $('s-min').checked = !!draft.minimizeToTray; $('s-sound').checked = draft.sound !== false;
  $('s-keep').value = draft.historyKeep || 'forever';
  $('s-autobackup').checked = draft.autoBackup !== false;
  window.api.backupList().then((l) => { $('b-auto-line').textContent = l.length ? `Every day · last saved ${new Date(l[0].date + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${l.length} kept` : 'Every day, last 14 kept in the data folder'; });
  $('data-path').textContent = info?.dataDir || ''; $('s-saved').textContent = '';
  renderTemplates();
  paintHealth();
}
/* Accounts: a clear health pill per account. Reconnect only shows when something is wrong. */
async function paintHealth() {
  const st = await window.api.syncStatus(), G = st.gmail || {};
  const set = (k, ok, warn, when, btn) => {
    const pill = $(`s-${k}-health`); if (!pill) return;
    pill.className = 'health ' + (!ok ? 'bad' : warn ? 'warn' : 'good');
    pill.textContent = !ok ? 'Signed out' : warn ? "Can't reach · retrying" : `Connected${when ? ' · checked ' + minsAgo(when) : ''}`;
    if (btn) { $(btn).classList.toggle('hidden', ok && !warn); $(btn).textContent = ok ? 'Reconnect' : 'Sign in'; }
  };
  set('rxnt', st.rxnt, !!(st.alerts || {}).lastError, (st.alerts || {}).lastRun || (st.schedule || {}).at, 's-rxnt-connect');
  set('ringrx', st.ringrx, (st.messages || {}).error === 'failed', (st.messages || {}).at);
  set('gmail', !!G.connected, !!G.error, G.at, 's-gmail-connect');
}
function renderTemplates() {
  $('t-list').innerHTML = draft.templates.map((t, i) => `
    <div class="tpl" data-i="${i}">
      <div class="tpl-top"><input type="text" class="t-name" value="${esc(t.name)}" placeholder="Template name">
        <select class="t-aud" title="Where this template is offered">${AUD.map(([k, l]) => `<option value="${k}" ${audienceOf(t) === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label class="radio" title="Pre-filled for checked-in patients"><input type="radio" name="deftpl" ${draft.defaultTemplate === t.id ? 'checked' : ''}>Default</label>
        <button class="btn ghost t-del">Delete</button></div>
      <textarea class="t-text" rows="5">${esc(t.text)}</textarea>
    </div>`).join('') || '<p class="muted small" style="margin-top:8px">No templates yet.</p>';
  $('t-list').querySelectorAll('.tpl').forEach((el) => {
    const t = draft.templates[+el.dataset.i];
    el.querySelector('.t-name').oninput = (e) => (t.name = e.target.value);
    el.querySelector('.t-text').oninput = (e) => (t.text = e.target.value);
    el.querySelector('.t-aud').onchange = (e) => { t.audience = e.target.value; delete t.seenOnly; };
    el.querySelector('input[type=radio]').onchange = () => (draft.defaultTemplate = t.id);
    el.querySelector('.t-del').onclick = () => { draft.templates.splice(+el.dataset.i, 1); if (draft.defaultTemplate === t.id) draft.defaultTemplate = draft.templates[0]?.id || null; renderTemplates(); };
  });
}
$('t-add').onclick = () => { draft.templates.push({ id: 't' + Date.now(), name: 'New template', text: 'Hi {first}, ', audience: 'any' }); renderTemplates(); };
$('s-save').onclick = async () => {
  if (draft.templates.some((t) => !t.name.trim() || !t.text.trim())) return toast('Every template needs a name and text.');
  const cellIn = $('s-cell').value.trim(), cellD = digits(cellIn);
  if (cellIn && cellD.length !== 10) return toast('Alert texts: enter a 10-digit cell number.');
  const prefs = JSON.parse(JSON.stringify(draft.alertPrefs || {}));
  document.querySelectorAll('#view-settings input[data-k]').forEach((x) => { prefs[x.dataset.k] = { ...(prefs[x.dataset.k] || {}), [x.dataset.c]: x.checked }; });
  prefs.soon = { ...prefs.soon, minutes: +$('w-soon').value };
  await window.api.setSettings({
    alertPrefs: prefs, alertCells: { ...(draft.alertCells || {}), [settings.currentProfile]: cellD },
    watch: { ...draft.watch, enabled: true, daysAhead: +$('w-days').value },
    sync: { busyStart: $('sy-start').value || '08:00', busyEnd: $('sy-end').value || '17:00' },
    reviewLink: $('s-review').value.trim(), signature: $('s-sig').value.trim(), signatureOn: $('s-sig-on').checked,
    summary: { on: $('s-sum-on').checked, time: $('s-sum-time').value || '07:30', sms: false },
    nudge: { on: $('s-nudge-on').checked, time: $('s-nudge-time').value || '17:00' },
    openAtLogin: $('s-login').checked, closeToTray: $('s-close').checked, minimizeToTray: $('s-min').checked, sound: $('s-sound').checked,
    historyKeep: $('s-keep').value, autoBackup: $('s-autobackup').checked, templates: draft.templates, defaultTemplate: draft.defaultTemplate,
  });
  settings = await window.api.getSettings(); $('s-saved').textContent = 'Saved'; toast('Settings saved');
};
$('s-rxnt-connect').onclick = async () => { if (await window.api.rxntSignIn()) { paintConnections(); loadSettings(); toast('RxNT connected'); } };
$('s-rxnt-out').onclick = async () => { await window.api.rxntLogout(); paintConnections(); loadSettings(); };
$('s-ringrx-out').onclick = async () => { if (accounts.ringrx.connected) await window.api.ringrxLogout(); accounts = await window.api.accounts(); showOnboarding(); };
$('open-data').onclick = () => window.api.openDataFolder();
function passwordModal(title, confirmTwice, onOk) {
  openModal(`<h2>${title}</h2><p class="muted small">${confirmTwice ? 'Choose a password. You\'ll need it to restore this backup; it can\'t be recovered.' : 'Enter the password used when the backup was made.'}</p>
    <label class="field"><span>Password</span><input type="password" id="bp-1"></label>
    ${confirmTwice ? '<label class="field"><span>Confirm password</span><input type="password" id="bp-2"></label>' : ''}
    <p class="form-err" id="bp-err"></p>
    <div class="actions"><button class="btn" id="bp-cancel">Cancel</button><button class="btn primary" id="bp-ok">Continue</button></div>`);
  $('bp-cancel').onclick = closeModal;
  $('bp-ok').onclick = async () => {
    const a = $('bp-1').value;
    if (a.length < 6) return ($('bp-err').textContent = 'Use at least 6 characters.');
    if (confirmTwice && a !== $('bp-2').value) return ($('bp-err').textContent = 'Passwords don\'t match.');
    $('bp-ok').disabled = true; await onOk(a);
  };
  setTimeout(() => $('bp-1').focus(), 50);
}
$('b-export').onclick = () => passwordModal('Back up', true, async (pw) => {
  const r = await window.api.backupExport(pw); closeModal();
  if (r.ok) toast(`Backup saved · ${r.patients} patients, ${r.history} messages`); else if (!r.canceled) toast('Backup failed. Try a different folder.');
});
$('b-restore').onclick = () => passwordModal('Restore backup', false, async (pw) => {
  const r = await window.api.backupImport(pw);
  if (r.canceled) { closeModal(); return; }
  if (r.error) { $('bp-err').textContent = r.error; $('bp-ok').disabled = false; return; }
  closeModal(); toast(`Restored ${r.patients} patients and ${r.history} messages`); loadSettings();
});


$('b-auto-restore').onclick = async () => {
  const list = await window.api.backupList();
  openModal(`<h2>Restore an automatic backup</h2><p class="muted small">Adds back patients, history and settings from that day. Nothing you have now is deleted.</p>
    ${list.length ? `<div class="lines">${list.map((b) => `<div class="line"><strong>${esc(new Date(b.date + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}</strong><button class="btn" data-f="${esc(b.file)}">Restore</button></div>`).join('')}</div>` : '<div class="empty-state" style="padding:20px">No automatic backups yet. The first one is made a minute after the app opens.</div>'}
    <div class="actions"><button class="btn" id="ab-now">Back up now</button><span style="flex:1"></span><button class="btn" id="ab-close">Close</button></div>`);
  $('ab-close').onclick = closeModal;
  $('ab-now').onclick = async () => { const r = await window.api.backupNow(); toast(r.ok ? 'Backup saved' : 'Backup failed'); closeModal(); loadSettings(); };
  $('modal').querySelectorAll('button[data-f]').forEach((b) => (b.onclick = async () => {
    b.disabled = true; const r = await window.api.backupRestoreAuto(b.dataset.f);
    closeModal(); toast(r.ok ? `Restored ${r.patients} patients and ${r.history} messages` : r.error);
  }));
};

$('s-gmail-connect').onclick = async () => { if (await window.api.gmailSignIn()) { toast('Gmail connected'); loadSettings(); paintConnections(); } else toast('Gmail sign-in was closed.'); };
$('s-gmail-out').onclick = async () => { await window.api.gmailSignOut(); loadSettings(); paintConnections(); };
$('s-cell-test').onclick = async () => {
  const d = digits($('s-cell').value);
  if (d && d.length !== 10) return toast('Enter a 10-digit number, or leave it empty to use the RingRx number.');
  await window.api.setSettings({ alertCells: { ...(settings.alertCells || {}), [settings.currentProfile]: d } });
  settings = await window.api.getSettings();
  const r = await window.api.testAlertText(); toast(r.ok ? 'Test text sent' : (r.error || 'Couldn\'t send'));
};

/* Sync: last update per source, from the same status the sidebar uses. */
async function paintSyncTimes() {
  const st = await window.api.syncStatus(), ago = (iso) => (iso ? `Updated ${minsAgo(iso)}` : 'Not yet');
  $('sx-rxnt').textContent = ago((st.alerts || {}).lastRun || (st.schedule || {}).at);
  $('sx-comms').textContent = ago((st.messages || {}).at);
  $('sx-rx').textContent = (st.rx || {}).error && !(st.rx || {}).available ? 'Couldn\'t read · retrying' : ago((st.rx || {}).at);
  $('sx-gmail').textContent = ago((st.gmail || {}).at);
  $('sx-pat').textContent = (st.patients || {}).running ? 'Syncing…' : `${((st.patients || {}).total || 0).toLocaleString()} patients · ${ago((st.patients || {}).at).toLowerCase()}`;
}
$('sy-now').onclick = async () => { $('sy-now').disabled = true; await syncEverything(); $('sy-now').disabled = false; paintSyncTimes(); };
$('b-contacts').onclick = async () => { const r = await window.api.backupContacts(); if (r.ok) toast(`Saved ${r.count} contacts`); else if (!r.canceled) toast('Couldn\'t save. Try a different folder.'); };

