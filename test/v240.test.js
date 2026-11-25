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
assert.ok(/autoInflight\[pid\]/.test(rx) && /codeWait\(pid\)/.test(rx));
// The proof read must finish before the window is closed (awaited inside try/finally), on both paths.
assert.strictEqual((rx.match(/return await provenIn\(pid, win, trace\)/g) || []).length, 2, 'provenIn awaited on both paths');
assert.ok(!/return provenIn\(pid, win\)/.test(rx));
// Schedule checks before replacing what's on screen.
assert.ok(/instead of \$\{date\}/.test(main) && /sudden drop held/.test(main));
// Signed out on purpose stays signed out.
assert.ok(/setUserOut\('rxnt', true\)/.test(main) && /setUserOut\('faxes', true\)/.test(main) && /!userOut\('rxnt'\)/.test(main));
// One status per account with an exact need.
assert.ok(/state: 'needs', action: need/.test(main) && /state: 'unconfirmed'/.test(main) && /state: 'offline'/.test(main));
// Patient list resumes and retries letters that didn't load.
assert.ok(/cursor/.test(main) && /missed/.test(main));
// Desktop pop-ups never name a patient (they can show on a locked screen).
const w = fs.readFileSync(APP + '/watcher.js', 'utf8');
assert.ok(/d\.map\(safeLine\)/.test(w) && /now\.map\(safeLine\)/.test(w) && !/map\(\(e\) => e\.text\)/.test(w), 'pop-ups use the no-names line');
assert.ok(!/notify\('Reminder', i\.text/.test(main) && !/\$\{nm\(a\)\}/.test(main), 'reminders and visit pop-ups have no names');
// A chart with no email field at all can't remove an email (only a chart that has the field, left blank).
assert.ok(/emailRead: \[pi, per\]\.some/.test(rx));
// Doximity: "You have no access" is not an empty inbox.
const fx = fs.readFileSync(APP + '/faxes.js', 'utf8');
const loadFn = (src, name) => { const i = src.indexOf(`function ${name}(`); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return eval('(' + src.slice(i, j + 1) + ')'); };
const step = loadFn(fx, 'autofillStep');
global.location = { pathname: '/inbox/faxes', host: 'doximity' }; global.document = { body: { innerText: 'You have no access to this page.' }, querySelector: () => null, querySelectorAll: () => [] };
assert.notStrictEqual(step('u', 'p', false).step, 'in', 'access denied is not signed in');
global.document.body.innerText = 'You have no faxes';
assert.strictEqual(step('u', 'p', false).step, 'in', 'a real empty inbox is signed in');
// Patient list: finished letters aren't read again, so a slow list still completes a pass.
assert.ok(/\.filter\(\(L\) => !doneLetters\.has\(L\)\)/.test(main));
// A timed-out read can't write over a newer one (portal), and code waits survive restarts.
assert.ok(/superseded by a newer read/.test(main) && /rxntCodeWait/.test(rx) && /codeWaitAt/.test(main));
// Diagnostics hide anything that could be a name.
const { scrub } = require(APP + '/diag');
assert.ok(!/Stone/.test(scrub("Couldn't open chart for Avery Stone (512) 555-0101")), 'names hidden in the log');
assert.ok(/RxNT timed out/.test(scrub('RxNT timed out after 4 min')), 'app words kept');
console.log('2.4.0 OK');
