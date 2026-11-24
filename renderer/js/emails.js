/* Emails: the practice Gmail (read, reply, write), the email composer (formatting, templates, attachments,
   preview, signature), "Send later" + quiet hours for texts and emails, and the Scheduled list.
   Patients always get email from hello@ruhwellmed.com. */
// When an email was opened here (Gmail doesn't keep that), so "Read 9:42 PM" works like texts and faxes.
const emReadAt = (() => { try { return JSON.parse(localStorage.getItem('rfd-em-read') || '{}'); } catch { return {}; } })();
const saveReadAt = () => { try { const k = Object.keys(emReadAt); if (k.length > 2000) k.slice(0, k.length - 2000).forEach((x) => delete emReadAt[x]); localStorage.setItem('rfd-em-read', JSON.stringify(emReadAt)); } catch {} };
// Gmail previews come with HTML codes (&#39; &amp;): show them as the characters they stand for.
const decodeEnt = (t) => { const d = document.createElement('textarea'); d.innerHTML = String(t || ''); return d.value; };
const initialsOf = (n) => String(n || '?').replace(/[^\p{L}\s@.]/gu, '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
// A patient for an address only when exactly one patient has it (families can share an address).
const onlyPatient = (addr) => { const a = String(addr || '').trim().toLowerCase(); const m = a ? patientEmails().filter((p) => p.email.toLowerCase() === a) : []; return m.length === 1 ? m[0] : null; };
const ours = (e) => /@ruhwellmed\.com$/i.test(String(e || ''));
let emFolder = fixFilter(recall('em-folder', 'needs'), ['needs', 'all', 'sent', 'spam']), emData = { items: [], next: '' }, emOpen = null, emSeq = 0, emOpenSeq = 0, emTemplates = null;

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
let schedKind = '';
// Recipient suggestions: our own list (not the browser's), name first, then email and next visit / DOB.
// Starts-with matches on first name, last name or email come first; top 6; arrow keys + Enter; our own addresses left out.
function recipientPicker(input, box, onPick) {
  let hits = [], at = -1;
  const visitOf = (p) => { const full = patients.find((x) => x.key === p.key) || {}; const n = full.nextVisit && new Date(full.nextVisit) > Date.now() - 864e5 ? full.nextVisit : null; return n ? `next visit ${new Date(n).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : full.dob ? `DOB ${dobText(full.dob)}` : ''; };
  const close = () => { box.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); at = -1; };
  const paint = () => {
    box.innerHTML = hits.map((p, i) => `<button type="button" role="option" class="${i === at ? 'on' : ''}" data-i="${i}"><span class="em-av">${esc(initialsOf(`${p.first || ''} ${p.last || ''}`))}</span><span class="sg-main"><b>${esc(`${p.first || ''} ${p.last || ''}`.trim() || p.email)}</b><span>${esc(p.email)}</span></span><em>${esc(visitOf(p))}</em></button>`).join('');
    box.classList.toggle('hidden', !hits.length); input.setAttribute('aria-expanded', String(!!hits.length));
    box.querySelectorAll('button').forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); pick(hits[+b.dataset.i]); }));
  };
  const pick = (p) => { if (!p) return; input.value = p.email; onPick(p); close(); input.dispatchEvent(new Event('change')); };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase(); at = -1;
    if (q.length < 1) { hits = []; return paint(); }
    const score = (p) => { const f = (p.first || '').toLowerCase(), l = (p.last || '').toLowerCase(), e = p.email.toLowerCase(), full = `${f} ${l}`;
      return f.startsWith(q) || l.startsWith(q) || full.startsWith(q) ? 0 : e.startsWith(q) ? 1 : full.includes(q) || e.includes(q) ? 2 : 9; };
    hits = patientEmails().filter((p) => !ours(p.email)).map((p) => [score(p), p]).filter(([sc]) => sc < (q.length < 2 ? 2 : 9)).sort((a, b) => a[0] - b[0] || String(a[1].last).localeCompare(String(b[1].last))).slice(0, 6).map(([, p]) => p);
    paint();
  });
  input.addEventListener('keydown', (e) => {
    if (box.classList.contains('hidden')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; paint(); }
    else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); pick(hits[at]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
}
async function scheduledModal(e) {
  if (e && e.currentTarget && e.currentTarget.dataset) schedKind = e.currentTarget.dataset.kind || '';
  const kind = schedKind;
  const list = (await window.api.outboxList()).filter((x) => !kind || (kind === 'email' ? x.kind === 'email' : x.kind !== 'email'));
  const ST = { scheduled: ['Scheduled', ''], sending: ['Sending', ''], sent: ['Sent', 'ok'], failed: ['Not sent', 'bad'], cancelled: ['Cancelled', 'muted'], uncertain: ['Check this one', 'bad'], checked: ['Checked', 'muted'] };
  openModal(`<div class="send-head"><h2>${kind === 'email' ? 'Scheduled emails' : kind ? 'Scheduled texts' : 'Scheduled'}</h2><button class="icon-btn" id="sc-x">${I.x}</button></div>
    ${list.length ? `<div class="sched-list">${list.map((x) => `<div class="sched-item s-${x.status}" data-id="${esc(x.id)}">
      <span class="sk">${x.kind === 'email' ? I.mail : I.msg}</span>
      <div class="sb"><b>${esc(x.to || x.label)}</b><span class="muted small">${esc(x.label)}${x.preview && x.preview !== x.label ? ' · ' + esc(String(x.preview).replace(/<[^>]+>/g, '').slice(0, 70)) : ''}</span>
        <span class="small ${ST[x.status][1]}">${esc(ST[x.status][0])} · ${esc(x.status === 'scheduled' ? fmtWhen(x.sendAt) : fmtWhen(x.doneAt || x.sendAt))}${x.error ? ' · ' + esc(x.error) : ''}</span></div>
      <div class="row-gap">${x.status === 'scheduled' ? '<button class="btn small sc-now">Send now</button><button class="btn small sc-time">Change time</button><button class="icon-btn sc-cancel" title="Cancel">' + I.x + '</button>' : x.status === 'uncertain' || x.status === 'failed' ? '<button class="btn small sc-ok">Got it</button>' : ''}</div>
    </div>`).join('')}</div>` : '<p class="muted" style="padding:16px 4px">Nothing scheduled. Use <b>Send later</b> on any text or email.</p>'}
    <div class="actions"><button class="btn primary" id="sc-done">Done</button></div>`);
  $('sc-x').onclick = $('sc-done').onclick = closeModal;
  // Refresh only if this Scheduled window is still the one open (never over a composer opened since).
  const mine = document.querySelector('.sched-list') || $('sc-done');
  const again = (ms) => setTimeout(() => { if (document.body.contains(mine)) scheduledModal(); }, ms);
  document.querySelectorAll('.sched-item').forEach((el) => {
    const id = el.dataset.id, q = (c) => el.querySelector(c);
    // Each action reports what actually happened (it may already be sending), then the list shows the real state.
    const gone = "Too late: it's already being sent. See its status below.";
    if (q('.sc-now')) q('.sc-now').onclick = async () => { const ok = await window.api.outboxSendNow(id); toast(ok ? 'Sending now' : gone); again(ok ? 1500 : 0); };
    if (q('.sc-time')) q('.sc-time').onclick = async () => { const d = await pickSendTime('Change time'); if (d) { const ok = await window.api.outboxReschedule(id, d.toISOString()); toast(ok ? `Moved to ${fmtWhen(d)}` : gone); } scheduledModal(); };
    if (q('.sc-cancel')) q('.sc-cancel').onclick = async () => { const ok = await window.api.outboxCancel(id); toast(ok ? 'Cancelled. It will not be sent.' : gone); again(0); };
    if (q('.sc-ok')) q('.sc-ok').onclick = async () => { await window.api.outboxDismiss(id); scheduledModal(); };
  });
}
// "Scheduled emails" in Emails, "Scheduled texts" in Texts; each opens only its own kind.
window.api.onOutbox(paintSchedCount);

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
  openModal(`<div class="em-compose">
    ${o.who && o.who.phone && !o.threadId ? channelTabs('email', { ...o.who, rec: o.who }) : ''}
    <div class="send-head"><h2>${o.threadId ? 'Reply' : o.who && o.who.first ? esc(`${o.who.first} ${o.who.last || ''}`.trim()) : 'New email'}</h2><button class="icon-btn" id="ec-x">${I.x}</button></div>
    <div class="ec-fields">
      <label><span>From</span><b class="ec-from">${esc(st.sendAs && st.sendAs.email || 'hello@ruhwellmed.com')}</b>${!st.error && st.at && !(st.sendAs && st.sendAs.ok) ? '<em class="bad small">not set up as a Send-as address in Gmail</em>' : ''}</label>
      <label><span>To</span><div class="ec-to-wrap"><input id="ec-to" value="${esc(c.to)}" placeholder="Patient name or email" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="ec-sugg"><div class="ec-sugg hidden" id="ec-sugg" role="listbox"></div></div><button class="linkbtn" id="ec-ccbtn">Cc</button></label>
      <label class="${c.cc ? '' : 'hidden'}" id="ec-ccrow"><span>Cc</span><input id="ec-cc" value="${esc(c.cc)}"></label>
      <label><span>Subject</span><input id="ec-subject" value="${esc(c.subject)}"></label>
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
    const who = c.who.first ? c.who : onlyPatient($('ec-to').value) || {};
    $('ec-subject').value = t.subject; body.innerHTML = cleanHtml(fillEmail(t.html, who) + (sig ? `<div data-sig="1"><br>${sig}</div>` : ''));
    c.packet = !!t.packet; c.templateId = t.id; c.templateName = t.name; paintFiles();
  };
  if (o.templateId) { const t = emTemplates.find((x) => x.id === o.templateId); if (t) useTemplate(t); }
  paintFiles();
  document.querySelectorAll('.em-compose .tpl-chip').forEach((b) => (b.onclick = () => useTemplate(emTemplates.find((t) => t.id === b.dataset.t))));
  $('ec-ccbtn').onclick = () => $('ec-ccrow').classList.remove('hidden');
  // The patient Maria picks stays picked; typing a different address clears it; a typed address only
  // counts as a patient when exactly one patient has it.
  recipientPicker($('ec-to'), $('ec-sugg'), (p) => { c.who = p; });
  const sameAddr = () => c.who.email && c.who.email.toLowerCase() === $('ec-to').value.trim().toLowerCase();
  $('ec-to').addEventListener('input', () => { if (!sameAddr()) c.who = {}; });
  $('ec-to').onchange = () => { if (!sameAddr()) c.who = onlyPatient($('ec-to').value) || {}; };
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
    const who = c.who.email && c.who.email.toLowerCase() === to.toLowerCase() ? c.who : onlyPatient(to) || {};
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
  $('em-sub').textContent = st.connected ? ((st.sendAs && st.sendAs.email) || 'hello@ruhwellmed.com') : 'Gmail';
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
  // Newest first, grouped by day like Faxes; initials, the person's name (a patient's name when we know the address).
  const sorted = rows.slice().sort((x, y) => new Date(y.at) - new Date(x.at));
  const dayOf = (iso) => { const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1); return d.toDateString() === t.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday' : Date.now() - d < 6 * 864e5 ? d.toLocaleDateString([], { weekday: 'long' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }); };
  const nameFor = (a) => { const p = onlyPatient(a.email); return p ? `${p.first || ''} ${p.last || ''}`.trim() : a.name || a.email; };
  let lastDay = '';
  $('em-list').innerHTML = sorted.length ? sorted.map((m) => {
    const who = emFolder === 'sent' ? nameFor(m.to) : nameFor(m.from), day = dayOf(m.at), head = day !== lastDay ? `<div class="em-day">${esc(day)}</div>` : ''; lastDay = day;
    return `${head}<button class="em-row ${m.unread ? 'unread' : ''} ${emOpen === m.id ? 'on' : ''}" data-id="${esc(m.id)}">
      <span class="em-av">${esc(initialsOf(who))}</span>
      <span class="em-main"><span class="tr-top"><b>${emFolder === 'sent' ? '<em class="to">To</em> ' : ''}${esc(who)}</b>${m.count > 1 ? `<em class="cnt">${m.count}</em>` : ''}<span class="t">${esc(shortWhen(m.at))}</span></span>
      <span class="em-subj">${esc(decodeEnt(m.subject))}</span><span class="tr-snip">${esc(decodeEnt(m.snippet))}</span></span></button>`;
  }).join('')
    : `<div class="all-clear small-clear">${I.check}<b>${{ needs: emData.next ? 'Nothing waiting in these emails' : 'Nothing waiting for you', sent: 'Nothing sent', spam: 'No spam' }[emFolder] || 'No emails'}</b></div>`;
  if (emData.next) $('em-list').insertAdjacentHTML('beforeend', '<button class="btn small em-more" id="em-loadmore">Load older emails</button>');
  $('em-list').querySelectorAll('.em-row').forEach((b) => (b.onclick = () => openEmail(b.dataset.id)));
  if ($('em-loadmore')) $('em-loadmore').onclick = () => loadEmails(true);
}
let emResize = null;
async function openEmail(id) {
  emOpen = id; renderEmailList();
  // Clear the previous thread straight away so its buttons can't be used while this one loads.
  $('em-pane').innerHTML = '<div class="fx-loading"><span class="spin"></span>Opening…</div>';
  const seq = ++emOpenSeq, live = () => seq === emOpenSeq && emOpen === id;
  const t = await window.api.emailThread(id);
  if (!live()) return;
  if (t.error) { $('em-pane').innerHTML = `<p class="muted" style="padding:20px">Couldn't open this email: ${esc(t.error)}</p>`; return; }
  const row = emData.items.find((x) => x.id === id), msgs = t.messages, lastIn = [...msgs].reverse().find((m) => !m.sent) || msgs[msgs.length - 1];
  if (row && row.unread) { row.unread = false; renderEmailList(); const ok = await window.api.emailRead(id, true); if (ok && ok.error) { row.unread = true; renderEmailList(); toast("Couldn't mark it read in Gmail."); } if (!live()) return; }
  // Read time belongs to the newest message (a new reply in an old thread gets its own time).
  const rk = msgs[msgs.length - 1].id || id;
  if (!emReadAt[rk]) { emReadAt[rk] = Date.now(); saveReadAt(); }
  // One clean reading surface: subject as the title, each message flowing at its natural height.
  const canDone = row && row.inbox !== false && emFolder !== 'sent' && emFolder !== 'spam';
  $('em-pane').innerHTML = `<div class="em-read-head">
      <h2>${esc(decodeEnt(msgs[0].subject) || '(no subject)')}</h2>
      <div class="row-gap">${emFolder === 'spam' ? '<button class="btn small" id="em-notspam">Not spam</button>' : `${canDone ? `<button class="icon-btn em-done" id="em-archive" title="Done (archives it in Gmail)">${I.check}</button>` : ''}<div class="more-wrap"><button class="icon-btn row-more" id="em-more" title="More">⋯</button><div class="more-menu hidden" id="em-menu"><button id="em-unread">Mark unread</button><button id="em-spam">Report spam</button></div></div>`}<button class="btn primary small" id="em-reply">${I.msg}Reply</button></div></div>
    <div class="em-thread">${msgs.map((m, i) => `<article class="em-msg ${i < msgs.length - 1 ? 'old' : ''}" data-i="${i}">
      <button type="button" class="em-mh" aria-expanded="${i < msgs.length - 1 ? 'false' : 'true'}"><span class="em-av">${esc(initialsOf(m.from.name || m.from.email))}</span><span class="em-from"><b>${esc(m.from.name || m.from.email)}</b><span class="muted small">${esc(m.from.email)}</span></span><span class="t muted small" title="${emReadAt[rk] && i === msgs.length - 1 ? 'Read ' + esc(fmtWhen(new Date(emReadAt[rk]))) : ''}">${esc(fmtWhen(m.at))}</span></button>
      <iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" class="em-frame" title="Email"></iframe>
      ${m.files.length ? `<div class="ec-files">${m.files.map((f, k) => `<button class="file-chip dl" data-k="${k}"><b>${esc(f.name)}</b><em>${esc(fmtSize(f.size))}</em></button>`).join('')}</div>` : ''}</article>`).join('')}</div>`;
  $('em-pane').querySelectorAll('.em-msg').forEach((el) => {
    const m = msgs[+el.dataset.i], fr = el.querySelector('iframe');
    const html = m.html ? cleanHtml(m.html) : `<pre style="white-space:pre-wrap;font:14px Arial">${esc(m.text)}</pre>`;
    fr.srcdoc = `<!doctype html><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;overflow:hidden}body{padding:4px 2px 8px;font:14.5px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d2b2a}img{max-width:100%;height:auto}table{max-width:100%}</style><body>${html}</body>`;
    // The message takes its natural height (no box with its own scrollbar); the pane scrolls as a whole.
    const fit = () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 4) + 'px'; } catch { fr.style.height = '480px'; } };
    fr.onload = () => { fit(); setTimeout(fit, 300); setTimeout(fit, 1200); };
    el._fit = fit;
    el.querySelectorAll('.file-chip.dl').forEach((b) => (b.onclick = async () => { const r = await window.api.emailSaveAttachment(m.id, m.files[+b.dataset.k]); if (r.ok) toast('Saved to ' + r.path.split(/[\\/]/).pop()); else if (r.error) toast(r.error); }));
    const mh = el.querySelector('.em-mh');
    if (el.classList.contains('old')) mh.onclick = () => { const open = el.classList.toggle('old') === false; mh.setAttribute('aria-expanded', String(open)); if (open) requestAnimationFrame(fit); };
    else mh.tabIndex = -1;
  });
  // Re-measure when the pane changes width (window resized), so long emails are never clipped.
  if (emResize) emResize.disconnect();
  emResize = new ResizeObserver(() => $('em-pane').querySelectorAll('.em-msg').forEach((el) => el._fit && el._fit()));
  emResize.observe($('em-pane'));
  if ($('em-more')) $('em-more').onclick = (e) => { e.stopPropagation(); $('em-menu').classList.toggle('hidden'); };
  if ($('em-spam')) $('em-spam').onclick = async () => { const r = await window.api.emailSpam(id, true); if (r && r.error) return toast(r.error); emData.items = emData.items.filter((x) => x.id !== id); emOpen = null; renderEmailList(); $('em-pane').innerHTML = ''; toast('Moved to Spam', async () => { await window.api.emailSpam(id, false); loadEmails(); }); };
  if ($('em-notspam')) $('em-notspam').onclick = async () => { const r = await window.api.emailSpam(id, false); if (r && r.error) return toast(r.error); emOpen = null; toast('Moved to Inbox'); loadEmails(); };
  if ($('em-unread')) $('em-unread').onclick = async () => { const r = await window.api.emailRead(id, false); if (r && r.error) return toast(r.error); delete emReadAt[rk]; saveReadAt(); if (row) row.unread = true; emOpen = null; renderEmailList(); $('em-pane').innerHTML = ''; toast('Marked unread'); };
  if ($('em-archive')) $('em-archive').onclick = async () => { const r = await window.api.emailArchive(id); if (r && r.error) return toast(r.error); emData.items = emData.items.filter((x) => x.id !== id); emOpen = null; renderEmailList(); $('em-pane').innerHTML = ''; toast('Done · archived in Gmail', async () => { await window.api.emailArchive(id, true); loadEmails(); }); };
  $('em-reply').onclick = () => {
    const to = lastIn.sent ? (lastIn.to || '') : lastIn.from.email, subj = /^re:/i.test(msgs[0].subject) ? msgs[0].subject : `Re: ${msgs[0].subject}`;
    const p = onlyPatient(to);
    emailCompose({ to, subject: subj, threadId: id, inReplyTo: lastIn.msgId, refs: lastIn.refs, who: p || {}, html: '<p><br></p>', after: () => openEmail(id) });
  };
}
document.querySelectorAll('#em-filter button').forEach((b) => { b.classList.toggle('on', b.dataset.f === emFolder); b.onclick = () => { emFolder = b.dataset.f; remember('em-folder', emFolder); emOpen = null; document.querySelectorAll('#em-filter button').forEach((x) => x.classList.toggle('on', x === b)); loadEmails(); }; });
let emSearchT = null;
$('em-search').oninput = () => { clearTimeout(emSearchT); emSearchT = setTimeout(() => loadEmails(), 450); };
$('em-new').onclick = () => emailCompose();
document.querySelectorAll('.sched-count').forEach((b) => (b.onclick = scheduledModal));
