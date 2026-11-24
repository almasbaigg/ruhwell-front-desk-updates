/* Emails: the practice Gmail (read, reply, write), the email composer (formatting, templates, attachments,
   preview, signature), "Send later" + quiet hours for texts and emails, and the Scheduled list.
   Patients always get email from hello@ruhwellmed.com. */
// When an email was opened here (Gmail doesn't keep that), so "Read 9:42 PM" works like texts and faxes.
const emReadAt = (() => { try { return JSON.parse(localStorage.getItem('rfd-em-read') || '{}'); } catch { return {}; } })();
const saveReadAt = () => { try { const k = Object.keys(emReadAt); if (k.length > 2000) k.slice(0, k.length - 2000).forEach((x) => delete emReadAt[x]); localStorage.setItem('rfd-em-read', JSON.stringify(emReadAt)); } catch {} };
const ours = (e) => /@ruhwellmed\.com$/i.test(String(e || ''));
let emFolder = fixFilter(recall('em-folder', 'needs'), ['needs', 'unread', 'all', 'sent', 'spam']), emData = { items: [], next: '' }, emOpen = null, emSeq = 0, emTemplates = null;

/* ---------- Small helpers ---------- */
const fmtWhen = (d) => { const x = new Date(d), t = new Date(), tm = new Date(); tm.setDate(t.getDate() + 1);
  const day = x.toDateString() === t.toDateString() ? 'today' : x.toDateString() === tm.toDateString() ? 'tomorrow' : x.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} at ${fmtTime(x)}`; };
const fmtSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
// Only simple formatting survives: no scripts, no styles from other sites, no event handlers.
function cleanHtml(html) {
  const t = document.createElement('template'); t.innerHTML = String(html || '');
  t.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach((n) => n.remove());
  t.content.querySelectorAll('*').forEach((el) => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      if (n.startsWith('on') || !['href', 'style', 'color', 'target', 'data-sig'].includes(n)) el.removeAttribute(a.name);
      else if (n === 'href' && !/^(https?:|mailto:|tel:)/i.test(a.value.trim())) el.removeAttribute(a.name);
      else if (n === 'style') el.setAttribute('style', a.value.split(';').filter((r) => /^\s*(color|font-weight|font-style|text-decoration|background-color)\s*:/i.test(r) && !/url\(|expression/i.test(r)).join(';'));
    }
    if (el.tagName === 'A') el.setAttribute('target', '_blank');
  });
  return t.innerHTML;
}
const fillEmail = (html, who) => String(html || '').replace(/\{first\}/g, esc(who.first || '')).replace(/\{name\}/g, esc(`${who.first || ''} ${who.last || ''}`.trim())).replace(/Hello\s*,/, 'Hello,');
const patientEmails = () => patients.filter((p) => p.email || p.emailTyped).map((p) => ({ key: p.key, first: p.first, last: p.last, phone: p.phone, email: (p.emailTyped || p.email || '').trim() }));

/* ---------- When to send: quick picks, custom time, quiet hours ---------- */
// A small dialog on top of whatever is open (the composer keeps its text and buttons underneath).
function subDialog(html) { const w = document.createElement('div'); w.className = 'sub-overlay'; w.innerHTML = `<div class="modal sub-modal">${html}</div>`; document.body.append(w); return w; }
async function pickSendTime(title = 'Send later') {
  const q = await window.api.outboxQuiet();
  const at = (days, h) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const mon = (() => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); d.setHours(9, 0, 0, 0); return d; })();
  const picks = [['In 1 hour', new Date(Date.now() + 36e5)], ['Tomorrow 9 AM', at(1, 9)], ['Tomorrow 1 PM', at(1, 13)], ['Monday 9 AM', mon]];
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const hrs = (h) => fmtTime(new Date(2000, 0, 1, Math.floor(h), (h % 1) * 60));
  // What each quick pick really means once sending hours are applied ("In 1 hour" at 9:45 PM → tomorrow 8 AM).
  const eff = await Promise.all(picks.map(([, d2]) => window.api.outboxNextAllowed(d2.toISOString()).then((x) => new Date(x))));
  picks.forEach((pk, i) => { pk[2] = eff[i]; });
  return new Promise((resolve) => {
    let w = null; const done = (v) => { w.remove(); resolve(v); };
    w = subDialog(`<div class="send-head"><h2>${esc(title)}</h2><button class="icon-btn" id="pk-x">${I.x}</button></div>
      <div class="pick-grid">${picks.map(([l, d], i) => `<button class="pick" data-i="${i}"><b>${esc(l)}</b><span>${esc(fmtWhen(picks[i][2]))}${picks[i][2] - d > 60000 ? ' · sending hours' : ''}</span></button>`).join('')}</div>
      <label class="pick-custom">${I.cal}<span>Pick a date and time</span><input type="datetime-local" id="pk-dt" min="${local(new Date())}" value="${local(at(1, 9))}"></label>
      <p class="muted small" id="pk-note">Sending hours: ${esc(hrs(q.start))}–${esc(hrs(q.end))}, ${esc(q.days.length === 6 && !q.days.includes(0) ? 'Mon–Sat' : q.days.length === 5 && !q.days.includes(0) && !q.days.includes(6) ? 'Mon–Fri' : 'set in Settings')}. Anything outside them waits for the next allowed time.</p>
      <div class="actions"><button class="btn" id="pk-cancel">Back</button><button class="btn primary" id="pk-ok">${I.clock}Schedule</button></div>`);
    let chosen = null;
    const note = async (d) => { const n = new Date(await window.api.outboxNextAllowed(d.toISOString())); $('pk-ok').innerHTML = `${I.clock}Schedule for ${esc(fmtWhen(n))}`; chosen = n; };
    document.querySelectorAll('.pick').forEach((b) => (b.onclick = () => { document.querySelectorAll('.pick').forEach((x) => x.classList.toggle('on', x === b)); note(picks[b.dataset.i][1]); }));
    $('pk-dt').onchange = () => { document.querySelectorAll('.pick').forEach((x) => x.classList.remove('on')); const d = new Date($('pk-dt').value); if (!isNaN(d)) note(d); };
    note(picks[1][1]); document.querySelector('.pick[data-i="1"]').classList.add('on');
    $('pk-x').onclick = $('pk-cancel').onclick = () => done(null);
    $('pk-ok').onclick = () => done(chosen);
  });
}
// Outside sending hours: ask, with "wait until morning" first.
async function quietCheck() {
  const q = await window.api.outboxQuiet();
  if (q.allowedNow) return { when: null, respectQuiet: true };
  return new Promise((resolve) => {
    let w = null; const done = (v) => { w.remove(); resolve(v); };
    w = subDialog(`<div class="center-text"><div class="quiet-ic">${I.moon}</div><h2>It's outside sending hours</h2>
      <p class="muted">It's ${esc(fmtTime(new Date()))}. Patients won't be messaged at odd hours unless you choose to.</p></div>
      <div class="actions col"><button class="btn primary" id="qt-wait">${I.clock}Send ${esc(fmtWhen(q.next))}</button><button class="btn" id="qt-now">Send now anyway</button><button class="btn ghost" id="qt-back">Back</button></div>`);
    $('qt-wait').onclick = () => done({ when: new Date(q.next), respectQuiet: true });
    $('qt-now').onclick = () => done({ when: null, respectQuiet: false });
    $('qt-back').onclick = () => done(null);
  });
}

/* ---------- Scheduled list (texts and emails) ---------- */
async function scheduledModal() {
  const list = await window.api.outboxList();
  const ST = { scheduled: ['Scheduled', ''], sending: ['Sending', ''], sent: ['Sent', 'ok'], failed: ['Not sent', 'bad'], cancelled: ['Cancelled', 'muted'], uncertain: ['Check this one', 'bad'], checked: ['Checked', 'muted'] };
  openModal(`<div class="send-head"><h2>Scheduled</h2><button class="icon-btn" id="sc-x">${I.x}</button></div>
    ${list.length ? `<div class="sched-list">${list.map((x) => `<div class="sched-item s-${x.status}" data-id="${esc(x.id)}">
      <span class="sk">${x.kind === 'email' ? I.mail : I.msg}</span>
      <div class="sb"><b>${esc(x.to || x.label)}</b><span class="muted small">${esc(x.label)}${x.preview && x.preview !== x.label ? ' · ' + esc(String(x.preview).replace(/<[^>]+>/g, '').slice(0, 70)) : ''}</span>
        <span class="small ${ST[x.status][1]}">${esc(ST[x.status][0])} · ${esc(x.status === 'scheduled' ? fmtWhen(x.sendAt) : fmtWhen(x.doneAt || x.sendAt))}${x.error ? ' · ' + esc(x.error) : ''}</span></div>
      <div class="row-gap">${x.status === 'scheduled' ? '<button class="btn small sc-now">Send now</button><button class="btn small sc-time">Change time</button><button class="icon-btn sc-cancel" title="Cancel">' + I.x + '</button>' : x.status === 'uncertain' || x.status === 'failed' ? '<button class="btn small sc-ok">Got it</button>' : ''}</div>
    </div>`).join('')}</div>` : '<p class="muted" style="padding:16px 4px">Nothing scheduled. Use <b>Send later</b> on any text or email.</p>'}
    <div class="actions"><button class="btn primary" id="sc-done">Done</button></div>`);
  $('sc-x').onclick = $('sc-done').onclick = closeModal;
  document.querySelectorAll('.sched-item').forEach((el) => {
    const id = el.dataset.id, q = (c) => el.querySelector(c);
    if (q('.sc-now')) q('.sc-now').onclick = async () => { await window.api.outboxSendNow(id); toast('Sending now'); setTimeout(scheduledModal, 1500); };
    if (q('.sc-time')) q('.sc-time').onclick = async () => { const d = await pickSendTime('Change time'); if (d) { await window.api.outboxReschedule(id, d.toISOString()); toast(`Moved to ${fmtWhen(d)}`); } scheduledModal(); };
    if (q('.sc-cancel')) q('.sc-cancel').onclick = async () => { await window.api.outboxCancel(id); toast('Cancelled. It will not be sent.'); scheduledModal(); };
    if (q('.sc-ok')) q('.sc-ok').onclick = async () => { await window.api.outboxDismiss(id); scheduledModal(); };
  });
}
window.api.onOutbox((d) => { document.querySelectorAll('.sched-count').forEach((b) => { b.textContent = d.pending ? `Scheduled (${d.pending})` : 'Scheduled'; }); });

/* ---------- Composer ---------- */
const COLORS = [['#005758', 'Teal'], ['#45818e', 'Soft teal'], ['#93c47d', 'Green'], ['#a3b18a', 'Sage'], ['#e4926e', 'Terracotta'], ['#1f2a2a', 'Black']];
async function emailCompose(o = {}) {
  const st = await window.api.emailStatus();
  if (!st.connected) { toast('Connect Gmail first (Settings → Email).'); go('settings'); return; }
  emTemplates = emTemplates || await window.api.emailTemplates();
  const packet = await window.api.emailPacketInfo();
  const sig = settings.emailSignature || '';
  const c = { to: o.to || '', cc: o.cc || '', subject: o.subject || '', files: [], packet: false, threadId: o.threadId || '', inReplyTo: o.inReplyTo || '', refs: o.refs || '', who: o.who || {}, templateId: null, templateName: o.threadId ? 'Reply' : 'Email' };
  const body0 = (o.html || '<p><br></p>') + (sig ? `<div data-sig="1"><br>${sig}</div>` : '');
  const opts = patientEmails().map((p) => `<option value="${esc(p.email)}">${esc(`${p.first || ''} ${p.last || ''}`.trim())}</option>`).join('');
  openModal(`<div class="em-compose">
    ${o.who && o.who.phone && !o.threadId ? channelTabs('email', { ...o.who, rec: o.who }) : ''}
    <div class="send-head"><h2>${o.threadId ? 'Reply' : o.who && o.who.first ? esc(`${o.who.first} ${o.who.last || ''}`.trim()) : 'New email'}</h2><button class="icon-btn" id="ec-x">${I.x}</button></div>
    <div class="ec-fields">
      <label><span>From</span><b class="ec-from">${esc(st.sendAs && st.sendAs.email || 'hello@ruhwellmed.com')}</b>${!st.error && st.at && !(st.sendAs && st.sendAs.ok) ? '<em class="bad small">not set up as a Send-as address in Gmail</em>' : ''}</label>
      <label><span>To</span><input id="ec-to" list="ec-people" value="${esc(c.to)}" placeholder="Patient name or email"><button class="linkbtn" id="ec-ccbtn">Cc</button></label>
      <label class="${c.cc ? '' : 'hidden'}" id="ec-ccrow"><span>Cc</span><input id="ec-cc" value="${esc(c.cc)}"></label>
      <label><span>Subject</span><input id="ec-subject" value="${esc(c.subject)}"></label>
      <datalist id="ec-people">${opts}</datalist>
    </div>
    ${emTemplates.length && !o.threadId ? `<div class="tpl-bar"><span>Templates</span>${emTemplates.map((t) => `<button type="button" class="tpl-chip" data-t="${esc(t.id)}">${I.plus}${esc(t.name)}</button>`).join('')}</div>` : ''}
    <div class="ec-tools">
      <button data-c="bold" title="Bold"><b>B</b></button><button data-c="italic" title="Italic"><i>I</i></button><button data-c="underline" title="Underline"><u>U</u></button>
      <span class="sep"></span>${COLORS.map(([v, n]) => `<button class="sw" data-color="${v}" title="${n}" style="--c:${v}"></button>`).join('')}
      <span class="sep"></span><button data-c="h" title="Heading">H</button><button data-c="insertOrderedList" title="Numbered list">1.</button><button data-c="insertUnorderedList" title="Bullet list">•</button><button data-c="link" title="Link">Link</button><button data-c="removeFormat" title="Clear formatting">Tx</button>
    </div>
    <div class="ec-body" id="ec-body" contenteditable="true">${cleanHtml(body0)}</div>
    <div class="ec-files" id="ec-files"></div>
    <div class="actions"><button class="btn" id="ec-attach">${I.plus}Attach</button><button class="btn" id="ec-preview">Preview</button><span style="flex:1"></span><button class="btn" id="ec-later">${I.clock}Send later</button><button class="btn primary" id="ec-send">${I.send}Send</button></div>
  </div>`);
  const body = $('ec-body');
  if (o.who && o.who.phone) bindChannelTabs({ ...o.who, rec: o.who });
  const paintFiles = () => {
    $('ec-files').innerHTML = (c.packet ? [{ name: packet.name, size: packet.size, packet: true }] : []).concat(c.files).map((f, i) => `<span class="file-chip">${I.mail.replace('<svg', '<svg class="fi"')}<b>${esc(f.name)}</b><em>${esc(fmtSize(f.size || 0))}</em><button data-i="${f.packet ? 'p' : i - (c.packet ? 1 : 0)}" title="Remove">${I.x}</button></span>`).join('');
    $('ec-files').querySelectorAll('button').forEach((b) => (b.onclick = () => { if (b.dataset.i === 'p') c.packet = false; else c.files.splice(+b.dataset.i, 1); paintFiles(); }));
  };
  const useTemplate = (t) => {
    const who = c.who.first ? c.who : patientEmails().find((p) => p.email.toLowerCase() === $('ec-to').value.trim().toLowerCase()) || {};
    $('ec-subject').value = t.subject; body.innerHTML = cleanHtml(fillEmail(t.html, who) + (sig ? `<div data-sig="1"><br>${sig}</div>` : ''));
    c.packet = !!t.packet; c.templateId = t.id; c.templateName = t.name; paintFiles();
  };
  if (o.templateId) { const t = emTemplates.find((x) => x.id === o.templateId); if (t) useTemplate(t); }
  paintFiles();
  document.querySelectorAll('.em-compose .tpl-chip').forEach((b) => (b.onclick = () => useTemplate(emTemplates.find((t) => t.id === b.dataset.t))));
  $('ec-ccbtn').onclick = () => $('ec-ccrow').classList.remove('hidden');
  $('ec-to').onchange = () => { const p = patientEmails().find((x) => x.email.toLowerCase() === $('ec-to').value.trim().toLowerCase()); if (p) c.who = p; };
  document.querySelectorAll('.ec-tools button').forEach((b) => (b.onmousedown = (e) => {
    e.preventDefault(); body.focus();
    if (b.dataset.color) return document.execCommand('foreColor', false, b.dataset.color);
    const k = b.dataset.c;
    if (k === 'h') return document.execCommand('formatBlock', false, 'h3');
    if (k === 'link') { const sel = window.getSelection(); if (!sel || sel.isCollapsed) return toast('Select the words to link first.'); const u = prompt('Link address (https://…, mailto: or tel:)', 'https://'); if (u && /^(https?:|mailto:|tel:)/i.test(u)) document.execCommand('createLink', false, u); return; }
    document.execCommand(k);
  }));
  body.addEventListener('paste', (e) => { const h = e.clipboardData.getData('text/html'); if (h) { e.preventDefault(); document.execCommand('insertHTML', false, cleanHtml(h)); } });
  $('ec-attach').onclick = async () => { const f = await window.api.emailPickFiles(); c.files.push(...f); paintFiles(); };
  const collect = () => {
    const to = $('ec-to').value.trim(), cc = ($('ec-cc') || {}).value || '', subject = $('ec-subject').value.trim();
    const html = cleanHtml(body.innerHTML.replace(/<div data-sig="1">/, '<div>'));
    if (!to || !to.split(/[,;]/).every((x) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x.trim()))) { toast('Check the email address.'); return null; }
    if (!subject) { toast('Add a subject.'); return null; }
    if (/\{first\}|Hello\s+_,/i.test(html)) { toast('The greeting still has a blank name.'); return null; }
    const who = c.who.email && c.who.email.toLowerCase() === to.toLowerCase() ? c.who : patientEmails().find((p) => p.email.toLowerCase() === to.toLowerCase()) || {};
    return { to, cc: cc.trim(), subject, html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${html}</div>`, files: c.files, packet: c.packet, threadId: c.threadId, inReplyTo: c.inReplyTo, refs: c.refs,
      patientKey: who.key || '', name: who.first ? `${who.first || ''} ${who.last || ''}`.trim() : '', phone: who.phone || '', templateId: c.templateId, templateName: c.templateName };
  };
  $('ec-preview').onclick = () => {
    const p = collect(); if (!p) return;
    const w = document.createElement('div'); w.className = 'ec-prev-wrap';
    w.innerHTML = `<div class="ec-prev"><div class="ec-prev-head"><b>${esc(p.subject)}</b><span class="muted small">From ${esc(st.sendAs && st.sendAs.email || 'hello@ruhwellmed.com')} · To ${esc(p.to)}${p.packet || p.files.length ? ` · ${(p.packet ? 1 : 0) + p.files.length} attachment${(p.packet ? 1 : 0) + p.files.length > 1 ? 's' : ''}` : ''}</span></div><iframe sandbox="" id="ec-prev-frame"></iframe><div class="actions"><button class="btn primary">Back to editing</button></div></div>`;
    document.body.append(w); w.querySelector('iframe').srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:18px;background:#fff">${p.html}</body>`;
    w.querySelector('button').onclick = () => w.remove();
  };
  // One window = one email: a double click or a repeated request can never queue it twice.
  let subId = `em-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, busy = false;
  const go2 = async (when, respectQuiet) => {
    const p = collect(); if (!p || busy) return; busy = true;
    $('ec-send').disabled = $('ec-later').disabled = true; $('ec-send').innerHTML = when ? 'Scheduling…' : '<span class="spinner"></span>Sending…';
    const r = await window.api.outboxAdd({ id: subId, kind: 'email', label: p.subject, to: p.name ? `${p.name} <${p.to}>` : p.to, payload: p, sendAt: when ? when.toISOString() : undefined, respectQuiet });
    $('ec-send').disabled = $('ec-later').disabled = false; $('ec-send').innerHTML = `${I.send}Send`;
    if (r.status === 'sent') { closeModal(); toast(`Sent to ${p.name || p.to}`); if (o.after) o.after(); if (view === 'emails') loadEmails(); return; }
    if (r.status === 'scheduled') { closeModal(); toast(`Scheduled for ${fmtWhen(r.sendAt)}`); if (o.after) o.after(); return; }
    busy = false;
    if (r.status === 'uncertain') { closeModal(); toast(r.error || 'Not sure it went out. Check Sent in Emails.'); return; }
    subId = `em-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;   // it did not go: trying again is a new attempt
    toast(r.error || 'Not sent.');
  };
  $('ec-send').onclick = async () => { if (!collect()) return; const q = await quietCheck(); if (!q) return; go2(q.when, q.respectQuiet); };
  $('ec-later').onclick = async () => { if (!collect()) return; const d = await pickSendTime(); if (d) go2(d, true); };
  $('ec-x').onclick = () => { if (body.innerText.trim().length > 20 && !confirm('Close without sending? The draft will be lost.')) return; closeModal(); };
  setTimeout(() => (c.to ? body : $('ec-to')).focus(), 50);
}
// Welcome email for a patient (from Today / the visit card / the text window).
function welcomeEmail(p) {
  const rec = recordFor(p) || p, email = (rec.emailTyped || rec.email || '').trim();
  emailCompose({ to: email, who: { ...rec, first: rec.first || p.first, last: rec.last || p.last, email }, templateId: 'welcome-email' });
}

/* ---------- Emails view ---------- */
async function loadEmails(more) {
  const st = await window.api.emailStatus();
  $('em-sub').textContent = st.connected ? `${st.account || 'Gmail'} · sending as ${(st.sendAs && st.sendAs.email) || 'hello@ruhwellmed.com'}` : 'Gmail';
  if (!st.connected) { $('em-list').innerHTML = ''; $('em-pane').innerHTML = emConnectHTML(st); bindConnect(); return; }
  const q = $('em-search').value.trim(), seq = ++emSeq;
  const folder = { needs: 'inbox', all: 'inbox', unread: 'unread', sent: 'sent', spam: 'spam' }[emFolder] || 'inbox';
  const r = await loading(() => window.api.emailList({ folder, q, pageToken: more ? emData.next : '' }));
  if (seq !== emSeq) return;
  if (r.error) { $('em-list').innerHTML = `<p class="muted small" style="padding:12px">Couldn't load email: ${esc(r.error)}</p>`; return; }
  emData = { items: more ? emData.items.concat(r.items) : r.items, next: r.next };
  renderEmailList();
  if (!emOpen) $('em-pane').innerHTML = `<div class="empty-state">${I.mail}<h3>Pick an email</h3><p>Or write a new one.</p></div>`;
}
function emConnectHTML(st) {
  return `<div class="em-setup"><div class="ic">${I.mail}</div><h2>Connect the practice Gmail</h2><p class="muted">Two steps, once on this computer. Patient emails go out from <b>hello@ruhwellmed.com</b>.</p>
    <ol class="steps"><li class="${st.hasKey ? 'done' : ''}"><b>Load the Google key file</b><span>The .json file downloaded from Google Cloud (kept encrypted on this computer).</span><button class="btn ${st.hasKey ? '' : 'primary'}" id="em-key">${st.hasKey ? 'Loaded · replace' : 'Choose file'}</button></li>
    <li><b>Sign in with Google</b><span>Opens Google in your browser. Sign in as admin@ruhwellmed.com and allow access.</span><button class="btn ${st.hasKey ? 'primary' : ''}" id="em-connect" ${st.hasKey ? '' : 'disabled'}>Sign in with Google</button></li></ol></div>`;
}
function bindConnect() {
  const k = $('em-key'), c = $('em-connect');
  if (k) k.onclick = async () => { const r = await window.api.emailLoadKey(); if (r.error) toast(r.error); else if (r.ok) toast('Key file loaded'); view === 'emails' ? loadEmails() : loadSettings(); };
  if (c) c.onclick = async () => { c.disabled = true; c.textContent = 'Waiting for Google…'; const r = await window.api.emailConnect(); c.disabled = false; c.textContent = 'Sign in with Google'; if (r.ok) { toast(`Gmail connected${r.account ? ' · ' + r.account : ''}`); paintConnections(); } else toast(r.error === 'timeout' ? 'Google sign-in timed out.' : `Sign-in didn't finish${r.error ? ' (' + r.error + ')' : ''}.`); view === 'emails' ? loadEmails() : loadSettings(); };
}
function renderEmailList() {
  // Needs you: Inbox threads where the last word is from someone else (archive = Done, like Gmail).
  const rows = emFolder === 'needs' ? emData.items.filter((m) => !ours(m.from.email)) : emData.items;
  filterCounts('em-filter', { needs: emFolder === 'needs' || emFolder === 'all' ? emData.items.filter((m) => !ours(m.from.email)).length : 0, unread: (lastSync && lastSync.gmail && lastSync.gmail.unread) || 0 });
  $('em-list').innerHTML = rows.length ? rows.map((m) => `<button class="em-row ${m.unread ? 'unread' : ''} ${emOpen === m.id ? 'on' : ''}" data-id="${esc(m.id)}">
      <div class="tr-top"><b>${esc(emFolder === 'sent' ? 'To: ' + (m.to.name || m.to.email) : m.from.name || m.from.email)}</b>${m.count > 1 ? `<em class="cnt">${m.count}</em>` : ''}<span class="t">${esc(shortWhen(m.at))}</span></div>
      <div class="em-subj">${m.unread ? '<i class="dot-new"></i>' : ''}${esc(m.subject)}</div><div class="tr-snip">${esc(m.snippet)}</div></button>`).join('') + (emData.next ? '<button class="btn small em-more" id="em-more">Load more</button>' : '')
    : `<div class="all-clear small-clear">${I.check}<b>${{ needs: 'Nothing waiting for you', unread: 'Nothing unread', sent: 'Nothing sent', spam: 'No spam' }[emFolder] || 'No emails'}</b></div>`;
  $('em-list').querySelectorAll('.em-row').forEach((b) => (b.onclick = () => openEmail(b.dataset.id)));
  if ($('em-more')) $('em-more').onclick = () => loadEmails(true);
}
async function openEmail(id) {
  emOpen = id; renderEmailList();
  const seq = ++emSeq, t = await window.api.emailThread(id);
  if (seq !== emSeq || emOpen !== id) return;
  if (t.error) { $('em-pane').innerHTML = `<p class="muted" style="padding:20px">Couldn't open this email: ${esc(t.error)}</p>`; return; }
  const row = emData.items.find((x) => x.id === id), msgs = t.messages, lastIn = [...msgs].reverse().find((m) => !m.sent) || msgs[msgs.length - 1];
  if (row && row.unread) { row.unread = false; renderEmailList(); const ok = await window.api.emailRead(id, true); if (ok && ok.error) { row.unread = true; renderEmailList(); toast("Couldn't mark it read in Gmail."); } }
  if (!emReadAt[id]) { emReadAt[id] = Date.now(); saveReadAt(); }
  $('em-pane').innerHTML = `<div class="convo-head"><span class="avatar">${esc(((lastIn.from.name || lastIn.from.email)[0] || '?').toUpperCase())}</span>
      <div><h2>${esc(msgs[0].subject || '(no subject)')}</h2><p class="muted small">${msgs.length} message${msgs.length > 1 ? 's' : ''}</p></div>
      <div class="row-gap">${emFolder === 'spam' ? '<button class="btn small" id="em-notspam">Not spam</button>' : `<button class="btn small" id="em-unread">Mark unread</button><div class="more-wrap"><button class="btn small" id="em-more">More ▾</button><div class="more-menu hidden" id="em-menu"><button id="em-spam">Report spam</button></div></div>${row && row.inbox !== false && emFolder !== 'sent' ? `<button class="btn small" id="em-archive">${I.check}Done</button>` : ''}`}<button class="btn primary small" id="em-reply">${I.msg}Reply</button></div></div>
    <div class="receipt-line">${stamp('Read', emReadAt[id])}${ours(lastIn.from.email) ? ' · <span class="muted">Last message is yours</span>' : ''}<span class="muted"> · Done archives it in Gmail</span></div>
    <div class="em-thread">${msgs.map((m, i) => `<div class="em-msg ${i < msgs.length - 1 ? 'old' : ''}" data-i="${i}">
      <div class="em-mh"><b>${esc(m.from.name || m.from.email)}</b><span class="muted small">${esc(m.from.email)}</span><span class="t muted small">${esc(fmtWhen(m.at))}</span></div>
      <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" class="em-frame"></iframe>
      ${m.files.length ? `<div class="ec-files">${m.files.map((f, k) => `<button class="file-chip dl" data-k="${k}"><b>${esc(f.name)}</b><em>${esc(fmtSize(f.size))}</em></button>`).join('')}</div>` : ''}</div>`).join('')}</div>`;
  $('em-pane').querySelectorAll('.em-msg').forEach((el) => {
    const m = msgs[+el.dataset.i], fr = el.querySelector('iframe');
    const html = m.html ? cleanHtml(m.html) : `<pre style="white-space:pre-wrap;font:14px Arial">${esc(m.text)}</pre>`;
    fr.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><body style="margin:6px 2px;font:14px Arial,sans-serif;color:#222">${html}</body>`;
    fr.onload = () => { try { fr.style.height = Math.min(4000, fr.contentDocument.body.scrollHeight + 24) + 'px'; } catch { fr.style.height = '420px'; } };
    el.querySelectorAll('.file-chip.dl').forEach((b) => (b.onclick = async () => { const r = await window.api.emailSaveAttachment(m.id, m.files[+b.dataset.k]); if (r.ok) toast('Saved to ' + r.path.split(/[\\/]/).pop()); else if (r.error) toast(r.error); }));
    if (el.classList.contains('old')) el.querySelector('.em-mh').onclick = () => el.classList.toggle('old');
  });
  if ($('em-more')) $('em-more').onclick = (e) => { e.stopPropagation(); $('em-menu').classList.toggle('hidden'); };
  if ($('em-spam')) $('em-spam').onclick = async () => { const r = await window.api.emailSpam(id, true); if (r && r.error) return toast(r.error); emData.items = emData.items.filter((x) => x.id !== id); emOpen = null; renderEmailList(); $('em-pane').innerHTML = ''; toast('Moved to Spam', async () => { await window.api.emailSpam(id, false); loadEmails(); }); };
  if ($('em-notspam')) $('em-notspam').onclick = async () => { const r = await window.api.emailSpam(id, false); if (r && r.error) return toast(r.error); emOpen = null; toast('Moved to Inbox'); loadEmails(); };
  if ($('em-unread')) $('em-unread').onclick = async () => { const r = await window.api.emailRead(id, false); if (r && r.error) return toast(r.error); delete emReadAt[id]; saveReadAt(); if (row) row.unread = true; emOpen = null; renderEmailList(); $('em-pane').innerHTML = ''; toast('Marked unread'); };
  if ($('em-archive')) $('em-archive').onclick = async () => { const r = await window.api.emailArchive(id); if (r && r.error) return toast(r.error); emData.items = emData.items.filter((x) => x.id !== id); emOpen = null; renderEmailList(); $('em-pane').innerHTML = ''; toast('Done · archived in Gmail', async () => { await window.api.emailArchive(id, true); loadEmails(); }); };
  $('em-reply').onclick = () => {
    const to = lastIn.sent ? (lastIn.to || '') : lastIn.from.email, subj = /^re:/i.test(msgs[0].subject) ? msgs[0].subject : `Re: ${msgs[0].subject}`;
    const p = patientEmails().find((x) => x.email.toLowerCase() === String(to).toLowerCase());
    emailCompose({ to, subject: subj, threadId: id, inReplyTo: lastIn.msgId, refs: lastIn.refs, who: p || {}, html: '<p><br></p>', after: () => openEmail(id) });
  };
}
document.querySelectorAll('#em-filter button').forEach((b) => { b.classList.toggle('on', b.dataset.f === emFolder); b.onclick = () => { emFolder = b.dataset.f; remember('em-folder', emFolder); emOpen = null; document.querySelectorAll('#em-filter button').forEach((x) => x.classList.toggle('on', x === b)); loadEmails(); }; });
let emSearchT = null;
$('em-search').oninput = () => { clearTimeout(emSearchT); emSearchT = setTimeout(() => loadEmails(), 450); };
$('em-new').onclick = () => emailCompose();
document.querySelectorAll('.sched-count').forEach((b) => (b.onclick = scheduledModal));
