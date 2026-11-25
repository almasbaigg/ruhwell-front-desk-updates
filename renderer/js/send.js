/* Sending: message window, one-step send with timer, live progress. */
// Message any visit / patient / alert subject in a modal (optionally pre-filled with a template).
function messageModal(src, preset) {
  const p = { ...src, text: '', templateId: null };
  p.rec = src.rec || recordFor(src) || null;
  p.greet = greetName(p, p.rec || src);
  if (p.rec && p.rec.dnt) return toast(`${fullName(p)} is marked do not text.`);
  const show = () => {
    openModal(`${channelTabs('text', p)}<div class="compose-top"><div class="avatar">${esc(initials(p))}</div><div><h2>${esc(fullName(p))}</h2><p class="muted small">${esc(fmtPhone(p.phone) || 'No phone')}${p.start ? ' · ' + esc(fmtDateShort(p.start)) + ', ' + esc(fmtTime(p.start)) : ''}${p.cat ? ' · ' + esc(CAT[p.cat]) : ''}</p></div></div>
      <div class="meta">${phoneBadge(p, p.rec)}${minorBadge(p, p.rec, false)}</div>
      <div id="mm-comp">${composerHTML(p)}</div>
      ${welcomeRow(p)}
      <div class="actions"><span class="from-chip">${sendFrom ? `${I.phone}From ${esc(fmtPhone(sendFrom))}` : ''}</span><span style="flex:1"></span><button class="btn" id="mm-cancel">Cancel</button><button class="btn" id="mm-later">${I.clock}Send Later</button><button class="btn primary" id="mm-send">${I.send}Send</button></div>`);
    const rebind = () => { $('mm-comp').innerHTML = composerHTML(p); bindComposer($('mm-comp'), p, rebind); };
    bindComposer($('mm-comp'), p, rebind);
    $('mm-cancel').onclick = closeModal;
    bindChannelTabs(p);
    const mmSubId = `ob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;   // one per open window, kept for retries
    const build = () => {
      if (digits(p.phone).length !== 10) { toast('No valid phone number.'); return null; }
      if (!finalMessage(p)) { toast('Write a message first.'); return null; }
      const it = itemFor(p);
      if (it.blocked) { toast(it.blocked); return null; }
      if ($('mm-wemail') && $('mm-wemail').checked) it.welcomeEmail = { to: emailOf(p), who: { key: (p.rec || {}).key || '', first: (p.rec || p).first || p.first, last: (p.rec || p).last || p.last, phone: p.phone } };
      return it;
    };
    $('mm-send').onclick = () => { const it = build(); if (it) confirmAndSend([it], () => { if (view === 'visits') refreshAlready(); }); };
    $('mm-later').onclick = async () => {
      const it = build(); if (!it) return;
      const btn = $('mm-later'); if (btn.disabled) return; btn.disabled = true;   // one click = one scheduled text
      const d = await pickSendTime(); btn.disabled = false; if (!d) return;
      btn.disabled = true; const r = await scheduleTexts([it], d, true, mmSubId);
      closeModal(); toast(`Scheduled for ${fmtWhen(r.sendAt)}`); if (view === 'visits') refreshAlready();
    };
    setTimeout(() => $('mm-comp').querySelector('textarea')?.focus(), 50);
  };
  const t = preset && tplById(preset);
  if (t && templatesFor(ctxFor(p)).includes(t)) {
    (async () => { if (/\{slots\}/i.test(t.text)) p.slots = await loading(() => openSlots()); p.templateId = t.id; p.text = fill(t.text, p); show(); })();
  } else show();
}

// One Message window for a patient: Text and Email are two tabs of the same thing, everywhere in the app.
function channelTabs(on, p) {
  const e = emailOf(p), g = lastSync && lastSync.gmail && lastSync.gmail.connected && lastSync.gmail.hasKey;
  return `<div class="chan-tabs" role="tablist"><button role="tab" data-ch="text" class="${on === 'text' ? 'on' : ''}" ${digits(p.phone).length === 10 ? '' : 'disabled title="No phone number"'}>${I.msg}Text</button><button role="tab" data-ch="email" class="${on === 'email' ? 'on' : ''}" ${e && g ? '' : `disabled title="${e ? 'Connect Gmail in Settings' : 'No email for this patient'}"`}>${I.mail}Email</button></div>`;
}
function bindChannelTabs(p) {
  document.querySelectorAll('.chan-tabs button').forEach((b) => (b.onclick = () => {
    if (b.classList.contains('on') || b.disabled) return;
    if (b.dataset.ch === 'email') { const e = emailOf(p), r = p.rec || recordFor(p) || p; closeModal(); emailCompose({ to: e, who: { ...r, first: r.first || p.first, last: r.last || p.last, phone: p.phone, email: e } }); }
    else { closeModal(); messageModal({ ...p, text: '' }); }
  }));
}
// Welcome texts can also email the welcome packet (from hello@ruhwellmed.com) when RxNT has the patient's email.
const emailOf = (p) => { const r = p.rec || recordFor(p) || {}; return String(r.emailTyped || r.email || p.email || '').trim(); };
function welcomeRow(p) {
  if (!/welcome/i.test(p.templateId || '') && !/welcome/i.test(String(p.text || '').slice(0, 60))) return '';
  const e = emailOf(p), ok = lastSync && lastSync.gmail && lastSync.gmail.connected && lastSync.gmail.hasKey;
  if (!e) return `<p class="muted small welcome-row">${I.mail}No email for this patient in RxNT, so only the text will go.</p>`;
  if (!ok) return `<p class="muted small welcome-row">${I.mail}Connect Gmail in Settings to also email the welcome packet.</p>`;
  return `<label class="welcome-row on">${I.mail}<input type="checkbox" id="mm-wemail" checked><span>Also email the <b>welcome packet</b> to ${esc(e)}</span></label>`;
}
async function queueWelcomeEmail(we, when, respectQuiet, id) {
  const tpls = await window.api.emailTemplates(), t = tpls.find((x) => x.id === 'welcome-email') || tpls.find((x) => /welcome/i.test(x.name));
  if (!t || !we.to) return null;
  const sig = settings.emailSignature || '';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">${cleanHtml(fillEmail(t.html, we.who) + (sig ? `<div><br>${sig}</div>` : ''))}</div>`;
  const name = `${we.who.first || ''} ${we.who.last || ''}`.trim();
  return window.api.outboxAdd({ id: id || `we-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, kind: 'email', label: t.subject, to: name ? `${name} <${we.to}>` : we.to, sendAt: when ? new Date(when).toISOString() : undefined, respectQuiet,
    payload: { to: we.to, subject: t.subject, html, files: [], packet: !!t.packet, patientKey: we.who.key || '', name, phone: we.who.phone || '', templateId: t.id, templateName: t.name } });
}
// Texts later: one outbox entry for the whole batch.
async function scheduleTexts(items, when, respectQuiet = true, subId) {
  const clean = items.map(({ warn, blocked, welcomeEmail, ...x }) => x);
  const r = await window.api.outboxAdd({ id: subId || `ob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'text', label: [...new Set(items.map((i) => i.templateName))].join(', ') || 'Text', to: items.length === 1 ? items[0].name : `${items.length} patients`, payload: { items: clean }, sendAt: new Date(when).toISOString(), respectQuiet });
  for (const [k, i] of items.entries()) if (i.welcomeEmail) await queueWelcomeEmail(i.welcomeEmail, when, respectQuiet, `${r.id}:email:${k}`);
  return r;
}

/* ---------- Confirm → countdown ring → live progress → summary ---------- */
const RING_C = 2 * Math.PI * 40;
const ring = (offset, inner, cls = '', style = '') => `<div class="ring-wrap"><div class="ring ${cls}"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="40"/><circle class="fg" id="m-arc" cx="46" cy="46" r="40" stroke-dasharray="${RING_C}" stroke-dashoffset="${offset}" style="${style}"/></svg><b id="m-count">${inner}</b></div></div>`;
// Review, then an explicit Send. Nothing goes out on its own.
async function confirmAndSend(items, after) {
  const blocked = items.find((i) => i.blocked);
  if (blocked) return toast(items.length > 1 ? `${blocked.name}: ${blocked.blocked}` : blocked.blocked);
  const q = await window.api.outboxQuiet();
  const flagged = items.filter((i) => i.warn.length), single = items.length === 1, quietNow = !q.allowedNow;
  let stop = false;
  openModal(`<div class="send-head"><h2>${single ? esc(items[0].name) : `Send ${items.length} texts`}</h2><button class="icon-btn" id="m-x" aria-label="Cancel">${I.x}</button></div>
    <p class="muted small">${single ? `To ${esc(fmtPhone(items[0].phone))} · ${esc(items[0].templateName)}` : esc([...new Set(items.map((i) => i.templateName))].join(', '))}${sendFrom ? ` · from ${esc(fmtPhone(sendFrom))}` : ''}</p>
    ${single ? `<div class="msg-preview"><div class="mp-bubble" id="m-bubble">${esc(items[0].message)}</div><div class="mp-meta">${items[0].message.length} characters${items[0].message.length > 160 ? ` · sent as ${Math.ceil(items[0].message.length / 153)} parts` : ''}</div></div>` : `<div class="lines">${items.map((i) => `<div class="line"><div><strong>${esc(i.name)}</strong>${i.warn.length ? `<div class="warnline">${esc(i.warn.join(' · '))}</div>` : ''}</div><span class="r">${esc(fmtPhone(i.phone))}</span></div>`).join('')}</div>`}
    ${flagged.length ? `<div class="warnbox">${I.bell}<span>${single ? esc(items[0].warn.join(' · ')) : `Check ${flagged.length === 1 ? 'the flagged patient' : `the ${flagged.length} flagged patients`} first.`}</span></div>` : ''}
    ${single ? `<label class="follow-row">${I.bell}<span>Remind Me If No Reply</span><select id="m-follow"><option value="">Off</option><option value="4">In 4 Hours</option><option value="t">Tomorrow 9 AM</option><option value="48">In 2 Days</option></select></label>` : ''}
    ${quietNow ? `<div class="quiet-line">${I.moon}<span>It's ${esc(fmtTime(new Date()))}, outside sending hours. It can wait until ${esc(fmtWhen(q.next))}.</span></div>` : ''}
    <div class="send-foot"><button class="btn ghost" id="m-cancel">Cancel</button><span style="flex:1"></span>
      ${quietNow ? `<button class="btn" id="m-now">Send Now</button><button class="btn primary" id="m-wait">${I.clock}Send ${esc(fmtWhen(q.next))}</button>`
        : `<button class="btn" id="m-later">${I.clock}Send Later</button><button class="btn primary" id="m-now">${I.send}${flagged.length ? 'Send Anyway' : 'Send'}</button>`}</div>`);
  const cancel = () => { stop = true; closeModal(); toast('Cancelled. Nothing was sent.'); };
  if ($('m-follow')) $('m-follow').onchange = (e) => { items[0].follow = e.target.value; };
  $('m-x').onclick = $('m-cancel').onclick = cancel;
  $('m-now').onclick = () => { if (stop) return; stop = true; doSend.anyway = quietNow; doSend(items, after); };
  const subId = `ob-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;   // the same for every click on this window
  let scheduling = false;
  const later = async (when, rq) => { if (scheduling) return; scheduling = true; stop = true; const r = await scheduleTexts(items, when, rq, subId); closeModal(); toast(`Scheduled for ${fmtWhen(r.sendAt)}`); if (after) after([], 'scheduled'); };
  if ($('m-later')) $('m-later').onclick = async () => { const d = await pickSendTime(); if (d) later(d, true); };
  if ($('m-wait')) $('m-wait').onclick = () => later(q.next, true);
  setTimeout(() => $('m-now') && !quietNow && $('m-now').focus(), 50);
}
async function doSend(items, after) {
  if (doSend.busy) return; doSend.busy = true; setTimeout(() => { doSend.busy = false; }, 3000);   // one confirmed send = one operation
  const opId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  // One text from the preview window: stay on it, show "Sending…" on the button, then the message flies off.
  const inPlace = items.length === 1 && $('m-bubble');
  if (inPlace) { $('modal').classList.add('sending'); const b = $('m-now'); if (b) b.innerHTML = '<span class="spinner"></span>Sending…'; }
  else openModal(`<h2>Sending…</h2><div class="progress"><div id="m-bar"></div></div>
    <div class="send-list live">${items.map((i, k) => `<div class="send-item" id="si-${k}"><strong>${esc(i.name)}</strong><span class="muted small">${esc(fmtPhone(i.phone))}</span><span class="st">${k === 0 ? '<span class="spinner"></span>Sending' : 'Waiting'}</span></div>`).join('')}</div>`);
  const results = await window.api.sendBatch(items, opId, { respectQuiet: !doSend.anyway, opId });
  doSend.anyway = false;
  // "Remind me if no reply": a checklist task with a reminder, which checks itself off when they reply.
  for (const r of results) if (r.ok && r.follow) {
    const due = r.follow === 't' ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })() : new Date(Date.now() + Number(r.follow) * 36e5).toISOString();
    await window.api.checklistAdd(`Follow up: no reply from ${r.name}`, { raw: true, due, link: { phone: r.phone }, followUp: r.phone });
  }
  for (let k = 0; k < results.length; k++) if (results[k].ok && items[k] && items[k].welcomeEmail) {
    const r = await queueWelcomeEmail(items[k].welcomeEmail, null, false, `${opId}:email:${k}`);
    if (r && r.status !== 'sent' && r.status !== 'scheduled') toast(`Text sent, but the welcome email didn't go: ${r.error || 'error'}`);
  }
  const ok = results.filter((r) => r.ok).length, out = results.find((r) => r.code === 'SIGNED_OUT'), all = ok === items.length;
  if (out) paintConnections();
  if (all && items.length === 1) {
    if (inPlace && !matchMedia('(prefers-reduced-motion: reduce)').matches) { $('m-bubble').classList.add('fly'); await new Promise((r) => setTimeout(r, 420)); }
    $('modal').classList.remove('sending'); closeModal(); toast(`Sent to ${results[0].name}`); if (after) after(results); return;
  }
  $('modal').classList.remove('sending');
  openModal(`<div class="center-text">${ring(RING_C * (1 - ok / items.length), all ? I.check.replace('<svg', '<svg style="width:34px;height:34px;transform:none"') : ok, '', all ? '' : 'stroke:var(--amber)')}
    <h2>${all ? `${ok} sent` : `${ok} of ${items.length} sent`}</h2></div>
    <div class="send-list">${results.map((r) => `<div class="send-item"><strong>${esc(r.name)}</strong><span class="st ${r.ok ? 'ok' : 'bad'}">${r.ok ? I.check + 'Sent' : esc(r.error)}</span></div>`).join('')}</div>
    ${out ? '<p class="bad small">RingRx signed you out. Sign in again in Settings, then retry.</p>' : ''}
    <div class="actions"><button class="btn primary" id="m-done">Done</button></div>`);
  $('m-done').onclick = closeModal;
  if (after) after(results);
}
window.api.onSendProgress((d) => {
  if ($('m-bar')) $('m-bar').style.width = `${(d.done / d.total) * 100}%`;
  const done = $('si-' + (d.done - 1)); if (done) done.querySelector('.st').outerHTML = d.last.ok ? `<span class="st ok">${I.check}Sent</span>` : `<span class="st bad">${esc(d.last.error || 'Failed')}</span>`;
  const next = $('si-' + d.done); if (next) next.querySelector('.st').innerHTML = '<span class="spinner"></span>Sending';
});

