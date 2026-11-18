/* RxNT work: everything unfinished in RxNT, grouped the way RxNT groups it (Clinical, Prescriptions, Billing).
   Within each group the most urgent is first (red, then amber). Prescriptions are time-sensitive and show how
   long they've waited. Read-only: every item opens RxNT, where the work is done. */
let rxData = { items: [] };
const RX_KIND = { pending: 'Pending', refill: 'Refill request', failed: 'Failed to send', sent: 'Sent', voided: 'Voided' };
const RANK = { red: 0, amber: 1, green: 2 };

async function loadRx(force) {
  const [rx, portal] = await Promise.all([loading(() => (force ? window.api.rxRefresh() : window.api.rxList())), window.api.portalList()]);
  rxData = rx;
  renderWork(rx, portal);
}

// How urgent a prescription is: failed = red now; otherwise amber after 1 hour, red after 3 (or once office hours end).
function rxUrgency(i) {
  if (i.kind === 'failed') return 'red';
  if (!i.at) return 'amber';
  const h = hoursSince(i.at), end = (settings.sync || {}).busyEnd || '17:00', now = new Date();
  const pastClose = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` >= end;
  return h >= 3 || (pastClose && h >= 1) ? 'red' : h >= 1 ? 'amber' : 'green';
}
function visitToday(name) {
  const n = String(name || '').toLowerCase(); if (!n) return null;
  const v = (((dayStore[ymd()] || {}).items) || []).find((a) => `${a.first} ${a.last}`.toLowerCase() === n || `${a.last}, ${a.first}`.toLowerCase() === n);
  return v ? fmtTime(v.start) : null;
}

function groups(rx, portal) {
  const c = rx.counts || {};
  const count = (n, one, many, sub, urg, open) => (n > 0 ? [{ urg, icon: I.check, title: `${n} ${n > 1 ? many : one}`, sub, open }] : []);
  const clinical = [
    ...count(c.unsigned, 'encounter to sign', 'encounters to sign', 'Notes waiting for your signature', 'red', 'todo'),
    ...count(c.labs, 'lab result to review', 'lab results to review', 'New results waiting', 'red', 'todo'),
    ...count(c.documents, 'document to review', 'documents to review', 'Outside records, forms and faxes waiting in RxNT', 'amber', 'todo'),
    ...count(c.referrals, 'referral', 'referrals', 'Referrals waiting in RxNT', 'amber', 'todo'),
    ...(portal.conversations || []).filter((x) => x.needsReply && !x.done).map((m) => ({ urg: hoursSince(m.at) >= 4 ? 'red' : 'amber', icon: I.msg, title: m.title, tag: 'Portal message', wait: m.at,
      sub: `“${String(m.excerpt || '').slice(0, 110)}”`, open: 'messages', done: () => window.api.portalDone(m.id) })),
    ...count(c.tasks, 'patient task', 'patient tasks', 'Tasks and requests from patients', 'amber', 'todo'),
  ];
  const prescriptions = (rx.items || []).map((i) => {
    const v = visitToday(i.patient);
    return { urg: rxUrgency(i), icon: I.pill, title: i.patient || 'Patient', tag: RX_KIND[i.kind], wait: i.at, c2: i.c2,
      sub: [i.med, i.pharmacy, v && `Visit today ${v}`].filter(Boolean).join(' · ') || i.detail || 'Waiting in RxNT', open: 'rx' };
  });
  const flags = rx.flags || [];
  const billing = [
    ...count(c.awaiting, 'visit awaiting billing', 'visits awaiting billing', 'Finish the encounter so the biller can bill it', 'amber', 'todo'),
    ...(c.unposted > 0 ? [{ urg: (rx.payments || []).some((p) => p.at && hoursSince(p.at) >= 7 * 24) ? 'red' : 'amber', icon: I.check, title: `${c.unposted} payment${c.unposted > 1 ? 's' : ''} to post`,
      sub: `Card charged, not applied to a visit yet${(rx.payments || []).length ? ` · oldest ${waitLabel(rx.payments.reduce((a, p) => (p.at && p.at < a ? p.at : a), new Date().toISOString()))} ago` : ''}`, open: 'billing' }] : []),
    ...flags.map((f) => ({ urg: 'amber', icon: I.check, title: f.patient, tag: 'Review payment', sub: `Charged twice in 2 days: ${f.payments.map((p) => '$' + p.amount).join(' + ')} (${f.payments.map((p) => p.date).join(', ')})`, open: 'billing' })),
  ];
  const sort = (l) => l.sort((a, b) => RANK[a.urg] - RANK[b.urg] || (b.wait ? hoursSince(b.wait) : 0) - (a.wait ? hoursSince(a.wait) : 0));
  return [
    { key: 'clinical', label: 'Clinical', rows: sort(clinical), info: '' },
    { key: 'rx', label: 'Prescriptions', rows: sort(prescriptions), info: '' },
    { key: 'billing', label: 'Billing', rows: sort(billing), info: c.unbilled ? `Biller's queue: ${c.unbilled} unbilled` : '' },
  ];
}

function rowHTML(r, id) {
  return `<div class="rx-row u-${r.urg}"><span class="ic">${r.icon}</span>
    <div class="body"><p class="t">${esc(r.title)}${r.tag ? `<span class="pill ${r.urg === 'red' ? 'red' : r.urg === 'amber' ? 'amber' : ''}">${esc(r.tag)}</span>` : ''}${r.c2 ? '<span class="pill c2">Schedule II · needs Dr. Baig, see patient first</span>' : ''}</p><p class="d">${esc(r.sub)}</p></div>
    ${r.wait ? `<span class="wait u-${r.urg}">waiting ${esc(waitLabel(r.wait))}</span>` : '<span></span>'}
    <div class="row-gap"><button class="btn soft" data-open="${r.open}">Open in RxNT</button>${r.done ? `<button class="icon-btn" title="Mark as done" data-done="${id}">${I.check}</button>` : ''}</div></div>`;
}

function renderWork(rx, portal) {
  const c = rx.counts || {};
  if (!rx.available) {
    $('rx-sub').textContent = '';
    $('rx-groups').innerHTML = `<div class="empty-state">${I.pill}<h3>${rxProblem(rx)}</h3><p>${rx.error === 'signin' ? 'RxNT signed you out. Reconnect in Settings.' : rx.error ? 'RxNT didn\'t load in time. It tries again shortly, or press Check now.' : 'Unfinished RxNT work shows here.'}</p><button class="btn" id="rx-retry">Check now</button></div>`;
    $('rx-retry').onclick = () => loadRx(true); $('rx-history').classList.add('hidden'); return;
  }
  const gs = groups(rx, portal), all = gs.flatMap((g) => g.rows), done = [];
  $('rx-sub').textContent = `${all.length ? all.length + ' need you' : 'All caught up'} · updated ${minsAgo(rx.at)}`;
  $('rx-groups').innerHTML = gs.map((g) => {
    const red = g.rows.filter((r) => r.urg === 'red').length;
    const head = `<div class="group-title"><h2>${g.label}</h2>${g.rows.length ? `<span class="gcount ${red ? 'red' : 'amber'}">${g.rows.length}</span>` : `<span class="gclear">${I.check}All clear</span>`}${g.info ? `<em>${esc(g.info)}</em>` : ''}</div>`;
    return `<section class="rx-group">${head}${g.rows.length ? `<div class="list">${g.rows.map((r) => { if (r.done) done.push(r.done); return rowHTML(r, done.length - 1); }).join('')}</div>` : ''}</section>`;
  }).join('');
  $('rx-groups').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => window.api.openRxnt(b.dataset.open)));
  $('rx-groups').querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => { await done[+b.dataset.done](); loadRx(); }));
  // History: sent and voided prescriptions, for reference
  const hist = rx.sent || [], sent = hist.filter((i) => i.kind === 'sent'), voided = hist.filter((i) => i.kind === 'voided');
  $('rx-history').classList.toggle('hidden', !(c.sent || c.voided));
  $('rx-hist-sum').textContent = `${c.sent || 0} sent · ${c.voided || 0} voided`;
  const block = (label, list, total) => total ? `<p class="hist-label">${label} <span class="muted">${total}</span></p>` + list.map((i) => `<div class="hist-row"><b>${esc(i.patient || 'Patient')}</b><span>${esc([i.pharmacy, i.detail].filter(Boolean).join(' · ').slice(0, 140))}</span><time>${esc(i.at ? fmtDateShort(i.at) : '')}</time></div>`).join('') + (total > list.length ? `<p class="muted small hist-more">${list.length ? `Showing ${list.length} of ${total}. ` : ''}Open RxNT for the full list.</p>` : '') : '';
  $('rx-hist').innerHTML = block('Sent', sent, c.sent) + block('Voided', voided, c.voided);
}
$('rx-open').onclick = () => window.api.openRxnt();
