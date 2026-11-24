/* Sending: message window, one-step send with timer, live progress. */
// Message any visit / patient / alert subject in a modal (optionally pre-filled with a template).
function messageModal(src, preset) {
  const p = { ...src, text: '', templateId: null };
  p.rec = src.rec || recordFor(src) || null;
  p.greet = greetName(p, p.rec || src);
  if (p.rec && p.rec.dnt) return toast(`${fullName(p)} is marked do not text.`);
  const show = () => {
    openModal(`<div class="compose-top"><div class="avatar">${esc(initials(p))}</div><div><h2>${esc(fullName(p))}</h2><p class="muted small">${esc(fmtPhone(p.phone) || 'No phone')}${p.start ? ' · ' + esc(fmtDateShort(p.start)) + ', ' + esc(fmtTime(p.start)) : ''}${p.cat ? ' · ' + esc(CAT[p.cat]) : ''}</p></div></div>
      <div class="meta">${phoneBadge(p, p.rec)}${minorBadge(p, p.rec, false)}</div>
      <div id="mm-comp">${composerHTML(p)}</div>
      <div class="actions"><span class="from-chip">${sendFrom ? `${I.phone}From ${esc(fmtPhone(sendFrom))}` : ''}</span><span style="flex:1"></span><button class="btn" id="mm-cancel">Cancel</button><button class="btn primary" id="mm-send">${I.send}Send</button></div>`);
    const rebind = () => { $('mm-comp').innerHTML = composerHTML(p); bindComposer($('mm-comp'), p, rebind); };
    bindComposer($('mm-comp'), p, rebind);
    $('mm-cancel').onclick = closeModal;
    $('mm-send').onclick = () => {
      if (digits(p.phone).length !== 10) return toast('No valid phone number.');
      if (!finalMessage(p)) return toast('Write a message first.');
      confirmAndSend([itemFor(p)], () => { if (view === 'visits') refreshAlready(); });
    };
    setTimeout(() => $('mm-comp').querySelector('textarea')?.focus(), 50);
  };
  const t = preset && tplById(preset);
  if (t && templatesFor(ctxFor(p)).includes(t)) {
    (async () => { if (/\{slots\}/i.test(t.text)) p.slots = await loading(() => openSlots()); p.templateId = t.id; p.text = fill(t.text, p); show(); })();
  } else show();
}

/* ---------- Confirm → countdown ring → live progress → summary ---------- */
const RING_C = 2 * Math.PI * 40;
const ring = (offset, inner, cls = '', style = '') => `<div class="ring-wrap"><div class="ring ${cls}"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="40"/><circle class="fg" id="m-arc" cx="46" cy="46" r="40" stroke-dasharray="${RING_C}" stroke-dashoffset="${offset}" style="${style}"/></svg><b id="m-count">${inner}</b></div></div>`;
function confirmAndSend(items, after) {
  const blocked = items.find((i) => i.blocked);
  if (blocked) return toast(items.length > 1 ? `${blocked.name}: ${blocked.blocked}` : blocked.blocked);
  const TOTAL = 5, flagged = items.filter((i) => i.warn.length), single = items.length === 1;
  let n = TOTAL, stop = false, t = null;
  openModal(`<div class="send-head"><h2>${single ? esc(items[0].name) : `Send ${items.length} messages`}</h2><button class="icon-btn" id="m-x" aria-label="Cancel">${I.x}</button></div>
    <p class="muted small">${single ? `${esc(fmtPhone(items[0].phone))} · ${esc(items[0].templateName)}` : esc([...new Set(items.map((i) => i.templateName))].join(', '))}${sendFrom ? ` · from ${esc(fmtPhone(sendFrom))}` : ''}</p>
    ${single ? `<div class="bubble">${esc(items[0].message)}</div>` : `<div class="lines">${items.map((i) => `<div class="line"><div><strong>${esc(i.name)}</strong>${i.warn.length ? `<div class="warnline">${esc(i.warn.join(' · '))}</div>` : ''}</div><span class="r">${esc(fmtPhone(i.phone))}</span></div>`).join('')}</div>`}
    ${flagged.length ? `<div class="warnbox">${I.bell}<span>${single ? esc(items[0].warn.join(' · ')) : `Check ${flagged.length === 1 ? 'the flagged patient' : `the ${flagged.length} flagged patients`} before sending.`}</span></div>` : ''}
    ${single ? `<label class="follow-row">${I.bell}<span>Remind me if no reply</span><select id="m-follow"><option value="">Off</option><option value="4">In 4 hours</option><option value="t">Tomorrow 9 AM</option><option value="48">In 2 days</option></select></label>` : ''}
    <div class="send-foot">${flagged.length ? '<span class="muted small">Waiting for you</span>' : `<div class="ring sm counting"><svg viewBox="0 0 92 92"><circle class="bg" cx="46" cy="46" r="40"/><circle class="fg" id="m-arc" cx="46" cy="46" r="40" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/></svg><b id="m-count">${TOTAL}</b></div><span class="muted small">Sending in <b id="m-sec">${TOTAL}</b> s · nothing sent yet</span>`}
      <span style="flex:1"></span><button class="btn primary" id="m-now">${I.send}${flagged.length ? 'Send anyway' : 'Send now'}</button></div>`);
  const cancel = () => { stop = true; clearInterval(t); closeModal(); toast('Cancelled. Nothing was sent.'); };
  // Choosing a follow-up pauses the countdown so it can't send mid-choice; Send now carries on.
  if ($('m-follow')) $('m-follow').onchange = (e) => {
    items[0].follow = e.target.value; clearInterval(t);
    const foot = $('m-sec') && $('m-sec').parentElement; if (foot) foot.innerHTML = 'Paused · press <b>Send now</b> when ready';
    const r = document.querySelector('.send-foot .ring'); if (r) r.classList.remove('counting');
  };
  $('m-x').onclick = cancel;
  $('m-now').onclick = () => { if (stop) return; stop = true; clearInterval(t); doSend(items, after); };
  if (flagged.length) return;
  requestAnimationFrame(() => requestAnimationFrame(() => { const a = $('m-arc'); if (a) a.style.strokeDashoffset = String(RING_C / TOTAL); }));
  t = setInterval(() => {
    if (stop) return;
    n--;
    if (n > 0) { const a = $('m-arc'); if (a) a.style.strokeDashoffset = String(RING_C * ((TOTAL - n + 1) / TOTAL)); if ($('m-count')) $('m-count').textContent = n; if ($('m-sec')) $('m-sec').textContent = n; return; }
    clearInterval(t); stop = true; doSend(items, after);
  }, 1000);
}
async function doSend(items, after) {
  if (doSend.busy) return; doSend.busy = true; setTimeout(() => { doSend.busy = false; }, 3000);   // one confirmed send = one operation
  const opId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  openModal(`<h2>Sending…</h2><div class="progress"><div id="m-bar"></div></div>
    <div class="send-list live">${items.map((i, k) => `<div class="send-item" id="si-${k}"><strong>${esc(i.name)}</strong><span class="muted small">${esc(fmtPhone(i.phone))}</span><span class="st">${k === 0 ? '<span class="spinner"></span>Sending' : 'Waiting'}</span></div>`).join('')}</div>`);
  const results = await window.api.sendBatch(items, opId);
  // "Remind me if no reply": a checklist task with a reminder, which checks itself off when they reply.
  for (const r of results) if (r.ok && r.follow) {
    const due = r.follow === 't' ? (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); })() : new Date(Date.now() + Number(r.follow) * 36e5).toISOString();
    await window.api.checklistAdd(`Follow up: no reply from ${r.name}`, { raw: true, due, link: { phone: r.phone }, followUp: r.phone });
  }
  const ok = results.filter((r) => r.ok).length, out = results.find((r) => r.code === 'SIGNED_OUT'), all = ok === items.length;
  if (out) paintConnections();
  if (all && items.length === 1) { closeModal(); toast(`Sent to ${results[0].name}`); if (after) after(results); return; }
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

