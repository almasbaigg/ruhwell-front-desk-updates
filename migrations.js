// Saved-data upgrades, run once each, in order. Each step is tagged with a version so an
// update never re-runs a step or scrambles data saved by an older version.
const store = require('./store');

const STEPS = [
  {
    v: 2, // 2.0: template audiences, new default templates, 15-minute minimum check interval
    run(s) {
      const mine = (s.templates || []).filter((t) => t.id !== 'voicemail').map((t) => ({ ...t, audience: t.audience || (t.seenOnly || t.id === 'review' ? 'after' : 'any') }));
      for (const d of store.DEFAULT_TEMPLATES) if (!mine.find((t) => t.id === d.id)) mine.push(d);
      const w = s.watch || {};
      return { ...s, templates: mine, watch: { ...w, minutes: (!w.minutes || w.minutes < 15) ? 15 : w.minutes } };
    },
  },
  {
    v: 3, // 2.2: per-event alerts. If a cell number was already set, keep texting schedule changes to it.
    run(s) {
      if (!(s.watch && s.watch.smsTo) || store.raw.readPlain('settings.json', {}).alertPrefs) return s;   // saved prefs only, not defaults
      const on = { desk: true, text: true };
      return { ...s, alertPrefs: { new: on, cancelled: on, noshow: on, rescheduled: on } };
    },
  },
  {
    v: 4, // 2.3: alert texts go to each user's own cell
    run(s) {
      if (!(s.watch && s.watch.smsTo) || s.alertCells) return s;
      return { ...s, alertCells: { [s.currentProfile || 'almas']: s.watch.smsTo } };
    },
  },
  {
    v: 5, // 1.0: no user picker. One shared desk keeps the logins and data of whoever was in use.
    run(s) {
      if (s.currentProfile) return s;
      const fs = require('fs');
      const has = (id) => (s.rxntConnected || {})[id] || fs.existsSync(store.raw.file(`ringrx-${id}.bin`));
      return { ...s, currentProfile: ['almas', 'maria'].find(has) || 'almas' };
    },
  },
  {
    v: 6, // 1.0.4: smart sync replaces fixed intervals; set office hours.
    run(s) {
      const { minutes, ...w } = s.watch || {};
      return { ...s, watch: w, sync: { busyStart: '08:00', busyEnd: '17:00' } };
    },
  },
  {
    v: 7, // 1.3.0: one "Schedule changes" alert setting instead of four.
    run(s) {
      const p = s.alertPrefs || {}, old = ['new', 'cancelled', 'noshow', 'rescheduled'].map((k) => p[k] || {});
      const schedule = p.schedule || { desk: old.some((x) => x.desk !== false), text: old.some((x) => x.text) };
      const { new: a, cancelled: b, noshow: c, rescheduled: d, ...rest } = p;
      return { ...s, alertPrefs: { ...rest, schedule } };
    },
  },
  {
    v: 8, // 1.6.0: "Review request" is now "Google Review Request" (id stays 'review' so history still counts).
    run(s) {
      const templates = (s.templates || []).map((t) => t.id === 'review' && /^review( request)?$/i.test(String(t.name || '').trim()) ? { ...t, name: 'Google Review Request' } : t);
      return { ...s, templates };
    },
  },
];

function run() {
  let s = store.settings.get();
  let ver = s.schemaVersion || (s.migratedV2 ? 2 : 1);
  for (const step of STEPS) {
    if (step.v <= ver) continue;
    try { s = step.run(s); ver = step.v; } catch (e) { console.error('migration', step.v, e); break; }
  }
  if (ver !== s.schemaVersion) store.settings.set({ ...s, schemaVersion: ver });
}

module.exports = { run };
