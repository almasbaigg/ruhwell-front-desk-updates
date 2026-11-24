// RxNT prescriptions needing action: pended for the prescriber, pharmacy refill requests and failed sends.
// Counts come from RxNT's EHR dashboard; names come from its prescriber dashboard.
// Read with the same signed-in RxNT session the schedule uses. Nothing is changed in RxNT:
// each item has "Open in RxNT" so the prescriber reviews and signs it there.
let last = { available: false, items: [], sent: [], counts: {}, payments: [], flags: [], at: null, error: null };   // items need action; sent holds sent + voided for reference

async function refresh(readPending) {
  try {
    const r = await readPending();
    // Returns what THIS attempt proved. A failed attempt keeps the old list and its real time ("at"), so old
    // prescriptions are never shown as just checked.
    if (r && r.error === 'busy') return { skipped: 'busy' };
    if (r && r.needsLogin) { last = { ...last, error: 'signin', failedAt: new Date().toISOString() }; return { error: 'sign-in needed', needsLogin: true }; }
    if (!r || !Array.isArray(r.items)) { last = { ...last, available: last.at ? last.available : false, error: (r && r.error) || 'unavailable', failedAt: new Date().toISOString() }; return { error: (r && r.error) || 'prescriptions page did not load' }; }
    const c = r.counts || {}, REF = ['sent', 'voided'];
    // Failed sends show up in RxNT's Recent list with a failure status.
    const failed = r.items.filter((i) => i.kind === 'sent' && /fail|error|denied|rejected/i.test(i.detail || '')).map((i) => ({ ...i, kind: 'failed' }));
    const sent = r.items.filter((i) => REF.includes(i.kind)), items = [...failed, ...r.items.filter((i) => !REF.includes(i.kind))];
    // Anything counted but not read by name still shows, as one line per kind.
    for (const [kind, label] of [['pending', 'pending prescription'], ['refill', 'refill request']]) {
      const missing = (c[kind] || 0) - items.filter((i) => i.kind === kind).length;
      if (missing > 0) items.push({ kind, patient: `${missing} ${label}${missing > 1 ? 's' : ''}`, detail: "Details didn't load · open RxNT to see who", partial: true });
    }
    const unnamedFailed = (c.failed || 0) - failed.length;
    if (unnamedFailed > 0) items.unshift({ kind: 'failed', patient: `${unnamedFailed} prescription${unnamedFailed > 1 ? 's' : ''} failed to send`, detail: 'Check and resend in RxNT' });
    const payments = r.payments || (c.unposted ? last.payments : []) || [];
    last = { available: true, at: new Date().toISOString(), error: null, items, sent, counts: c, payments, flags: flagPayments(payments),
      account: r.account || last.account || null,                       // signed-in RxNT account, as RxNT's menu shows it
      today: r.today ? { ...r.today, at: new Date().toISOString() } : last.today || null,   // EHR "Today's Appointments"
      unsigned: c.unsigned ? (r.unsigned || (last.unsigned || []).slice(0, c.unsigned)) : [] };
    return { ok: true };
  } catch (e) { last = { ...last, error: 'failed', failedAt: new Date().toISOString() }; return { error: 'failed' }; }
  return last;
}
// Payments worth a second look: the same patient charged more than once within 2 days
// (could be a copay plus a balance, or a double charge). Shown for review only.
function flagPayments(list) {
  const by = {};
  for (const p of list) (by[p.patient] = by[p.patient] || []).push(p);
  const out = [];
  for (const [patient, ps] of Object.entries(by)) {
    const s = ps.filter((p) => p.at).sort((a, b) => new Date(a.at) - new Date(b.at));
    for (let i = 1; i < s.length; i++) {
      if (new Date(s[i].at) - new Date(s[i - 1].at) <= 2 * 864e5) { out.push({ patient, payments: [s[i - 1], s[i]], total: s[i - 1].amount + s[i].amount, at: s[i].at }); break; }
    }
  }
  return out;
}
// Count from RxNT's own tab labels, which stay right even if a row can't be read.
const total = () => { const c = last.counts || {}; return (c.pending || 0) + (c.refill || 0) + (c.failed || 0); };
const work = () => { const c = last.counts || {}; return (c.unsigned || 0) + (c.labs || 0) + (c.documents || 0) + (c.referrals || 0) + (c.tasks || 0) + (c.awaiting || 0) + (c.unposted ? 1 : 0) + (last.flags || []).length; };   // unfinished RxNT work (payments to post count once)
const status = () => ({ available: last.available, at: last.at, error: last.error, count: total(), work: work() });
const list = () => ({ ...last, total: total(), items: (last.items || []).map((i) => ({ ...i, c2: needsPhysician(i) })) });

// Schedule II (stimulants and opioids) must be sent by Dr. Baig after he has seen the patient.
const C2 = /amphetamine|adderall|mydayis|evekeo|dyanavel|adzenys|zenzedi|dexedrine|procentra|xelstrym|vyvanse|lisdexamfetamine|methylphenidate|ritalin|concerta|metadate|methylin|quillivant|quillichew|cotempla|jornay|relexxii|aptensio|daytrana|focalin|dexmethylphenidate|azstarys|oxycodone|hydrocodone|morphine|fentanyl|hydromorphone|methadone|tapentadol|oxymorphone/i;
const needsPhysician = (i) => C2.test(`${i.med || ''} ${i.detail || ''}`);

const extras = () => ({ account: last.account || null, today: last.today || null, unsigned: last.unsigned || [] });
module.exports = { refresh, status, list, needsPhysician, extras };
