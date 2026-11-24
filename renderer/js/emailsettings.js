/* Settings → Email (connection, sender name, signature, welcome packet, email templates) and Sending hours. */
async function loadEmailSettings() {
  if ($('em-pane') && $('em-pane').querySelector('#em-key')) $('em-pane').innerHTML = '';
  const st = await window.api.emailStatus();
  // Gmail's own row above says Connected; this only shows the two setup steps, or a problem to fix.
  $('es-conn').innerHTML = st.connected
    ? (st.error === 'failed' || (st.sendAs && st.sendAs.ok) ? '' : `<div class="conn-note">hello@ruhwellmed.com isn't set up as a "Send mail as" address in Gmail, so emails can't be sent.</div>`)
    : emConnectHTML(st);
  bindConnect();
  if ($('es-reconnect')) $('es-reconnect').onclick = async () => { const r = await window.api.emailConnect(); toast(r.ok ? 'Gmail connected' : 'Sign-in didn’t finish'); loadEmailSettings(); paintConnections(); };
  if ($('es-out')) $('es-out').onclick = async () => { if (!confirm('Disconnect Gmail on this computer? Scheduled emails will wait until it is connected again.')) return; await window.api.gmailSignOut(); loadEmailSettings(); paintConnections(); };
  $('es-name').value = settings.emailFromName || (st.sendAs && st.sendAs.name) || 'Ruhwell Med';
  $('es-name').onchange = async () => { settings.emailFromName = $('es-name').value.trim().slice(0, 60); await window.api.setSettings({ emailFromName: settings.emailFromName }); toast('Saved'); };
  $('es-sig').innerHTML = cleanHtml(settings.emailSignature || '');
  $('es-sig').onblur = async () => { const h = cleanHtml($('es-sig').innerHTML).trim(); if (h === (settings.emailSignature || '')) return; settings.emailSignature = $('es-sig').innerText.trim() ? h : ''; await window.api.setSettings({ emailSignature: settings.emailSignature }); toast('Signature saved'); };
  const pk = await window.api.emailPacketInfo();
  $('es-packet-name').textContent = pk.name; $('es-packet-sub').textContent = `${pk.custom ? 'Replaced ' + (pk.at ? fmtDateShort(pk.at) : '') : 'Original'} · ${fmtSize(pk.size)}`;
  $('es-packet-reset').classList.toggle('hidden', !pk.custom);
  $('es-packet-open').onclick = () => window.api.emailPacketOpen();
  $('es-packet-replace').onclick = async () => { const r = await window.api.emailPacketReplace(); if (r.error) toast(r.error); else if (r.ok) toast('Welcome packet replaced'); loadEmailSettings(); };
  $('es-packet-reset').onclick = async () => { await window.api.emailPacketReset(); toast('Back to the original packet'); loadEmailSettings(); };
  emTemplates = await window.api.emailTemplates();
  $('es-tpls').innerHTML = emTemplates.map((t, i) => `<div class="conn-row"><div class="conn-main"><strong>${esc(t.name)}</strong><span class="muted small">${esc(t.subject)}${t.packet ? ' · welcome packet attached' : ''}</span></div><div class="row-gap"><button class="btn small" data-e="${i}">Edit</button><button class="icon-btn" data-d="${i}" title="Delete">${I.x}</button></div></div>`).join('');
  $('es-tpls').querySelectorAll('[data-e]').forEach((b) => (b.onclick = () => editEmailTemplate(+b.dataset.e)));
  $('es-tpls').querySelectorAll('[data-d]').forEach((b) => (b.onclick = async () => { const t = emTemplates[+b.dataset.d]; if (!confirm(`Delete the "${t.name}" email template?`)) return; emTemplates.splice(+b.dataset.d, 1); await window.api.emailTemplatesSave(emTemplates); loadEmailSettings(); }));
  $('es-tpl-add').onclick = () => editEmailTemplate(-1);
  // Sending hours
  const q = await window.api.outboxQuiet();
  const hours = Array.from({ length: 33 }, (_, i) => 6 + i * 0.5).filter((h) => h <= 22);
  const opt = (sel) => hours.map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${esc(fmtTime(new Date(2000, 0, 1, Math.floor(h), (h % 1) * 60)))}</option>`).join('');
  $('qh-start').innerHTML = opt(q.start); $('qh-end').innerHTML = opt(q.end);
  $('qh-days').innerHTML = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<button class="chip ${q.days.includes(i) ? 'on' : ''}" data-d="${i}">${d}</button>`).join('');
  const saveQ = async () => {
    const start = +$('qh-start').value, end = +$('qh-end').value, days = [...$('qh-days').querySelectorAll('.chip.on')].map((b) => +b.dataset.d);
    if (end <= start) { toast('"Until" has to be after "From".'); return loadEmailSettings(); }
    if (!days.length) { toast('Pick at least one day.'); return loadEmailSettings(); }
    await window.api.setSettings({ quietHours: { start, end, days } }); toast('Sending hours saved');
  };
  $('qh-start').onchange = $('qh-end').onchange = saveQ;
  $('qh-days').querySelectorAll('.chip').forEach((b) => (b.onclick = () => { b.classList.toggle('on'); saveQ(); }));
}
function editEmailTemplate(i) {
  const t = i >= 0 ? { ...emTemplates[i] } : { id: 'em-' + Date.now().toString(36), name: '', subject: '', html: '<p>Hello {first},</p><p><br></p>', packet: false };
  openModal(`<div class="em-compose"><div class="send-head"><h2>${i >= 0 ? 'Edit email template' : 'New email template'}</h2><button class="icon-btn" id="et-x">${I.x}</button></div>
    <div class="ec-fields"><label><span>Name</span><input id="et-name" value="${esc(t.name)}" placeholder="e.g. Records request"></label><label><span>Subject</span><input id="et-subject" value="${esc(t.subject)}"></label></div>
    <div class="ec-tools">
      <button data-c="bold"><b>B</b></button><button data-c="italic"><i>I</i></button><button data-c="underline"><u>U</u></button><span class="sep"></span>${COLORS.map(([v, n]) => `<button class="sw" data-color="${v}" title="${n}" style="--c:${v}"></button>`).join('')}
      <span class="sep"></span><button data-c="h">H</button><button data-c="insertOrderedList">1.</button><button data-c="insertUnorderedList">•</button><button data-c="link">Link</button><button data-c="removeFormat">Tx</button>
    </div>
    <div class="ec-body" id="et-body" contenteditable="true">${cleanHtml(t.html)}</div>
    <p class="muted small">Write <b>{first}</b> where the patient's first name goes.</p>
    <label class="welcome-row on"><input type="checkbox" id="et-packet" ${t.packet ? 'checked' : ''}><span>Attach the welcome packet</span></label>
    <div class="actions"><span style="flex:1"></span><button class="btn" id="et-cancel">Cancel</button><button class="btn primary" id="et-save">Save template</button></div></div>`);
  const body = $('et-body');
  document.querySelectorAll('.em-compose .ec-tools button').forEach((b) => (b.onmousedown = (e) => {
    e.preventDefault(); body.focus();
    if (b.dataset.color) return document.execCommand('foreColor', false, b.dataset.color);
    const k = b.dataset.c;
    if (k === 'h') return document.execCommand('formatBlock', false, 'h3');
    if (k === 'link') { const u = prompt('Link address (https://…, mailto: or tel:)', 'https://'); if (u && /^(https?:|mailto:|tel:)/i.test(u)) document.execCommand('createLink', false, u); return; }
    document.execCommand(k);
  }));
  $('et-x').onclick = $('et-cancel').onclick = closeModal;
  $('et-save').onclick = async () => {
    t.name = $('et-name').value.trim(); t.subject = $('et-subject').value.trim(); t.html = cleanHtml(body.innerHTML); t.packet = $('et-packet').checked;
    if (!t.name || !t.subject) return toast('Add a name and a subject.');
    if (i >= 0) emTemplates[i] = t; else emTemplates.push(t);
    await window.api.emailTemplatesSave(emTemplates); closeModal(); toast('Template saved'); loadEmailSettings();
  };
}
// Settings in four tabs, one at a time: Connections · Messages · Alerts · App.
function showSettingsTab(t) {
  t = ['connections', 'messages', 'alerts', 'app'].includes(t) ? t : 'connections'; remember('set-tab', t);
  document.querySelectorAll('#view-settings .card[data-tab]').forEach((c) => c.classList.toggle('hidden', c.dataset.tab !== t));
  document.querySelectorAll('#set-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
}
document.querySelectorAll('#set-tabs button').forEach((b) => (b.onclick = () => showSettingsTab(b.dataset.t)));
showSettingsTab(recall('set-tab', 'connections'));
