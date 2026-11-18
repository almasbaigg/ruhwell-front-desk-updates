/* RxNT work: everything unfinished in RxNT, in one list ordered by urgency (red first):
   encounters to sign, lab results, patient portal messages, patient tasks, prescriptions (pending, refill
   requests, failed sends) and visits not billed yet (Maria's part). Sent and voided prescriptions sit in History.
   Read-only: every item opens RxNT, where the work is done. */
let rxData = { items: [] };
const RX_KIND = { pending: 'Pending prescription', refill: 'Refill request', failed: 'Failed to send', sent: 'Sent', voided: 'Voided' };

async function loadRx(force) {
  const [rx, portal] = await Promise.all([loading(() => (force ? window.api.rxRefresh() : window.api.rxList())), window.api.portalList()]);
  rxData = rx;
  renderWork(rx, portal);
}

function workRows(rx, portal) {
  const c = rx.counts || {}, rows = [];
  const count = (k, n, one, many, sub, lvl, where) => { if (n > 0) rows.push({ urg: lvl, icon: I.check, title: `${n} ${n > 1 ? many : one}`, sub, open: where }); };
  count('unsigned', c.unsigned, 'encounter to sign', 'encounters to sign', 'Notes waiting for your signature', 'red', 'todo');
  count('labs', c.labs, 'lab result to review', 'lab results to review', 'New results waiting', 'red', 'todo');
  for (const m of (portal.conversations || []).filter((x) => x.needsReply && !x.done)) {
    rows.push({ urg: hoursSince(m.at) >= 4 ? 'red' : 'amber', icon: I.msg, title: m.title, tag: 'RxNT portal', sub: `“${String(m.excerpt || '').slice(0, 120)}” · ${ago(m.at)}`, open: 'messages', done: () => window.api.portalDone(m.id) });
  }
  for (const i of rx.items || []) {
    rows.push({ urg: i.kind === 'failed' || hoursSince(i.at || Date.now()) >= 24 ? 'red' : 'amber', icon: I.pill, title: i.patient || 'Patient', tag: RX_KIND[i.kind],
      sub: [i.med, i.pharmacy, i.at && ago(i.at)].filter(Boolean).join(' · ') || i.detail || 'Waiting in RxNT', open: 'rx' });
  }
  count('tasks', c.tasks, 'patient task', 'patient tasks', 'Tasks and messages from patients', 'amber', 'todo');
  count('unbilled', c.unbilled, 'visit not billed yet', 'visits not billed yet', "Close the encounter so the biller can bill", 'amber', 'billing');
  const RANK = { red: 0, amber: 1, green: 2 };
  return rows.sort((a, b) => RANK[a.urg] - RANK[b.urg]);
}

function renderWork(rx, portal) {
  const c = rx.counts || {};
  if (!rx.available) {
    $('rx-sub').textContent = '';
    $('rx-needs').innerHTML = `<div class="empty-state">${I.pill}<h3>${rxProblem(rx)}</h3><p>${rx.error === 'signin' ? 'RxNT signed you out. Reconnect in Settings.' : rx.error ? 'RxNT didn\'t load in time. It tries again shortly, or press Check now.' : 'Unfinished RxNT work shows here.'}</p><button class="btn" id="rx-retry">Check now</button></div>`;
    $('rx-retry').onclick = () => loadRx(true); $('rx-clear').innerHTML = ''; $('rx-history').classList.add('hidden'); return;
  }
  const rows = workRows(rx, portal);
  $('rx-sub').textContent = `${rows.length ? rows.length + ' need you' : 'All caught up'} · updated ${minsAgo(rx.at)}`;
  $('rx-needs').innerHTML = rows.length ? rows.map((r, n) => `
    <div class="rx-row u-${r.urg}"><span class="ic">${r.icon}</span>
      <div class="body"><p class="t">${esc(r.title)}${r.tag ? `<span class="pill ${r.urg === 'red' ? 'red' : 'amber'}">${esc(r.tag)}</span>` : ''}</p><p class="d">${esc(r.sub)}</p></div>
      <div class="row-gap"><button class="btn soft" data-open="${r.open}">Open in RxNT</button>${r.done ? `<button class="icon-btn" title="Mark as done" data-done="${n}">${I.check}</button>` : ''}</div></div>`).join('')
    : `<div class="all-clear">${I.check}<b>Nothing waiting in RxNT</b><span>Encounters, labs, patient messages and prescriptions that need you show up here.</span></div>`;
  $('rx-needs').querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => window.api.openRxnt(b.dataset.open)));
  $('rx-needs').querySelectorAll('[data-done]').forEach((b) => (b.onclick = async () => { await rows[+b.dataset.done].done(); loadRx(); }));
  // What's clear, in one quiet line
  const clear = [['Encounters', c.unsigned], ['Labs', c.labs], ['Patient tasks', c.tasks], ['Prescriptions', (rx.items || []).length], ['Billing', c.unbilled]].filter(([, n]) => n === 0).map(([l]) => l);
  $('rx-clear').innerHTML = clear.length ? `${I.check}<span>All clear: ${clear.join(' · ')}</span>` : '';
  // History: sent and voided prescriptions, for reference
  const hist = rx.sent || [], sent = hist.filter((i) => i.kind === 'sent'), voided = hist.filter((i) => i.kind === 'voided');
  $('rx-history').classList.toggle('hidden', !(c.sent || c.voided));
  $('rx-hist-sum').textContent = `${c.sent || 0} sent · ${c.voided || 0} voided`;
  const block = (label, list, total) => total ? `<p class="hist-label">${label} <span class="muted">${total}</span></p>` + (list.length ? list.map((i) => `<div class="hist-row"><b>${esc(i.patient || 'Patient')}</b><span>${esc([i.pharmacy, i.detail].filter(Boolean).join(' · ').slice(0, 140))}</span><time>${esc(i.at ? fmtDateShort(i.at) : '')}</time></div>`).join('') : '') + (total > list.length ? `<p class="muted small hist-more">${list.length ? `Showing ${list.length} of ${total}. ` : ''}Open RxNT for the full list.</p>` : '') : '';
  $('rx-hist').innerHTML = block('Sent', sent, c.sent) + block('Voided', voided, c.voided);
}
$('rx-open').onclick = () => window.api.openRxnt();
