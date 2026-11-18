const assert = require('assert'), fs = require('fs');
// renderer statusOf / category / stateOf
const core = fs.readFileSync(require('path').join(__dirname, '..') + '/renderer/js/core.js', 'utf8');
const grab = (name) => { const i = core.indexOf(`function ${name}(`); let d = 0, j = core.indexOf('{', i); for (let k = j; k < core.length; k++) { if (core[k] === '{') d++; else if (core[k] === '}' && --d === 0) return core.slice(i, k + 1); } };
eval(grab('statusOf') + grab('category') + grab('stateOf'));
const S = (t, c = '') => statusOf({ statusText: t, statusCode: c });
const map = { 'Completed': 'seen', 'Check-In Completed': 'seen', 'Called': 'booked', 'Intake Completed': 'booked', 'Rescheduled': 'moved', 'Pending': 'booked', 'Waitlist': 'booked', 'Booked': 'booked', 'Canceled': 'cancelled', 'Deleted': 'cancelled', 'No Show': 'noshow', 'Confirmed': 'confirmed', 'Missed': 'noshow', 'Late Cancellation': 'cancelled' };
for (const [t, want] of Object.entries(map)) assert.strictEqual(S(t), want, t);
assert.strictEqual(S('', 'CKC'), 'seen'); assert.strictEqual(S('', 'PND'), 'booked');
assert.strictEqual(category({ statusText: 'Intake Completed' }), 'pending');
assert.strictEqual(stateOf({ statusText: 'Pending', start: '2020-01-01T10:00', end: '2020-01-01T11:00' }), 'notin');
assert.strictEqual(stateOf({ statusText: 'Pending', start: '2099-01-01T10:00', end: '2099-01-01T11:00' }), 'booked');
// watcher mapping
const w = fs.readFileSync(require('path').join(__dirname, '..') + '/watcher.js', 'utf8');
eval((w.match(/const isCancel[^\n]+\n/)[0] + w.match(/const isNoShow[^\n]+\n/)[0] + w.match(/const isSeen[^\n]+\n/)[0]).replace(/const /g, "globalThis."));
assert(isCancel({ statusText: 'Late Cancellation' }) && isCancel({ statusText: 'Deleted' }) && !isCancel({ statusText: 'No Show' }));
assert(isNoShow({ statusText: 'Missed' }) && isNoShow({ statusText: 'No Show' }));
assert(isSeen({ statusText: 'Check-In Completed' }) && !isSeen({ statusText: 'Intake Completed' }));
console.log('status mapping OK');
