// Prescriptions and billing items read from RxNT: counts, Schedule II flag, payment review flags.
const assert = require('assert');
const rx = require('../rxtasks');
(async () => {
  const day = (d) => new Date(`2026-11-${d}T12:00:00`).toISOString();
  await rx.refresh(async () => ({
    counts: { pending: 2, refill: 0, documents: 8, referrals: 1, awaiting: 2, unposted: 3, unsigned: 1, labs: 0, tasks: 0 },
    items: [{ kind: 'pending', patient: 'A B', med: 'Adderall XR 20 mg' }, { kind: 'pending', patient: 'C D', med: 'Sertraline 50 mg' }],
    payments: [{ patient: 'X, Y', amount: 150, at: day(16) }, { patient: 'X, Y', amount: 225, at: day(17) }, { patient: 'Z, W', amount: 50, at: day(10) }],
  }));
  const l = rx.list();
  assert(l.items.find((i) => i.patient === 'A B').c2 === true && l.items.find((i) => i.patient === 'C D').c2 === false, 'Schedule II flagged');
  assert(l.flags.length === 1 && l.flags[0].total === 375, 'same patient charged twice in 2 days is flagged');
  // unsigned 1 + documents 8 + referrals 1 + awaiting 2 + payments-to-post (once) 1 + flag 1
  assert(rx.status().work === 14 && rx.status().count === 2, 'work count ' + rx.status().work);
  console.log('prescriptions + billing OK');
})().catch((e) => { console.error(e); process.exit(1); });
