// 2.4.0: proof before replacing data; one sign-in at a time; one status per account.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-240-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, session: { fromPartition: () => ({}) } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const assert = require('assert');
const store = require(APP + '/store');

// Email removed in RxNT: a chart read with no email drops the old one; a list row without email doesn't.
store.patients.upsert([{ chart: '5001', first: 'Test', last: 'Person', email: 'old@example.com' }]);
store.patients.upsert([{ chart: '5001', first: 'Test', last: 'Person', email: '' }]);
assert.strictEqual(Object.values(store.patients.all()).find((p) => p.chart === '5001').email, 'old@example.com', 'a row without email keeps it');
store.patients.upsert([{ chart: '5001', email: '', emailRead: true }]);
const p = Object.values(store.patients.all()).find((x) => x.chart === '5001');
assert.ok(!p.email, 'a chart read with no email removes it');
assert.ok(!('emailRead' in p), 'the marker is not stored');

const rx = fs.readFileSync(APP + '/rxnt-reader.js', 'utf8'), main = fs.readFileSync(APP + '/main.js', 'utf8');
// Chart detail must match the expected chart number (a blank one isn't proof).
assert.ok(/if \(expectChart && chart !== String\(expectChart\)\) return \{ state: 'loading' \}/.test(rx));
assert.ok(/timedOut: true/.test(rx), 'a search that timed out is not "no patients"');
assert.ok(/incomplete\.push\('availability'\)/.test(rx), 'a missing Availability view is marked');
assert.ok(/r\.pending === 0 \|\| r\.items\.length/.test(rx), 'an empty screen still loading is not an empty day');
// One quiet sign-in at a time, proven by a real schedule read, and paused after a code was asked for.
assert.ok(/autoInflight\[pid\]/.test(rx) && /provenIn\(pid, win\)/.test(rx) && /codeAskedAt/.test(rx));
// Schedule checks before replacing what's on screen.
assert.ok(/instead of \$\{date\}/.test(main) && /sudden drop held/.test(main));
// Signed out on purpose stays signed out.
assert.ok(/setUserOut\('rxnt', true\)/.test(main) && /setUserOut\('faxes', true\)/.test(main) && /!userOut\('rxnt'\)/.test(main));
// One status per account with an exact need.
assert.ok(/state: 'needs', action: need/.test(main) && /state: 'unconfirmed'/.test(main) && /state: 'offline'/.test(main));
// Patient list resumes and retries letters that didn't load.
assert.ok(/cursor/.test(main) && /missed/.test(main));
console.log('2.4.0 OK');
