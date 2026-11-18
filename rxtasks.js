// RxNT prescriptions needing action: pended for the prescriber, pharmacy refill requests and failed sends.
// Counts come from RxNT's EHR dashboard; names come from its prescriber dashboard.
// Read with the same signed-in RxNT session the schedule uses. Nothing is changed in RxNT:
// each item has "Open in RxNT" so the prescriber reviews and signs it there.
let last = { available: false, items: [], sent: [], counts: {}, at: null, error: null };   // items need action; sent holds sent + voided for reference

async function refresh(readPending) {
  try {
    const r = await readPending();
    if (r && r.error === 'busy') return last;
    if (r && r.needsLogin) { last = { ...last, error: 'signin', at: new Date().toISOString() }; return last; }
    if (!r || !Array.isArray(r.items)) { last = { ...last, available: false, at: new Date().toISOString(), error: (r && r.error) || 'unavailable' }; return last; }
    const c = r.counts || {}, REF = ['sent', 'voided'];
    // Failed sends show up in RxNT's Recent list with a failure status.
    const failed = r.items.filter((i) => i.kind === 'sent' && /fail|error|denied|rejected/i.test(i.detail || '')).map((i) => ({ ...i, kind: 'failed' }));
    const sent = r.items.filter((i) => REF.includes(i.kind)), items = [...failed, ...r.items.filter((i) => !REF.includes(i.kind))];
    // Anything counted but not read by name still shows, as one line per kind.
    for (const [kind, label] of [['pending', 'pending prescription'], ['refill', 'refill request']]) {
      const missing = (c[kind] || 0) - items.filter((i) => i.kind === kind).length;
      if (missing > 0) items.push({ kind, patient: `${missing} ${label}${missing > 1 ? 's' : ''}`, detail: 'Open RxNT to see who' });
    }
    const unnamedFailed = (c.failed || 0) - failed.length;
    if (unnamedFailed > 0) items.unshift({ kind: 'failed', patient: `${unnamedFailed} prescription${unnamedFailed > 1 ? 's' : ''} failed to send`, detail: 'Check and resend in RxNT' });
    last = { available: true, at: new Date().toISOString(), error: null, items, sent, counts: c };
  } catch { last = { ...last, error: 'failed', at: new Date().toISOString() }; }
  return last;
}
// Count from RxNT's own tab labels, which stay right even if a row can't be read.
const total = () => { const c = last.counts || {}; return (c.pending || 0) + (c.refill || 0) + (c.failed || 0); };
const work = () => { const c = last.counts || {}; return (c.unsigned || 0) + (c.labs || 0); };   // urgent unfinished RxNT work
const status = () => ({ available: last.available, at: last.at, error: last.error, count: total(), work: work() });
const list = () => ({ ...last, total: total() });

module.exports = { refresh, status, list };
