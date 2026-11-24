// 2.3.1: a read only counts when it really worked (prescriptions after a sign-out, RingRx replies in the wrong shape,
// Gmail emails that didn't load), and sign-in steps are read correctly.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-231-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, session: { fromPartition: () => ({}) } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const assert = require('assert');
const store = require(APP + '/store');

(async () => {
  // Prescriptions: one good read, then RxNT signed out → old list kept with its real time, attempt reported as failed.
  const rxt = require(APP + '/rxtasks');
  let o = await rxt.refresh(async () => ({ items: [{ kind: 'pending', patient: 'Test Person', detail: '' }], counts: { pending: 1 } }));
  assert.deepStrictEqual(o, { ok: true });
  const goodAt = rxt.status().at;
  await new Promise((r) => setTimeout(r, 15));
  o = await rxt.refresh(async () => ({ needsLogin: true }));
  assert.ok(o.needsLogin && o.error, 'signed out is a failed attempt');
  assert.strictEqual(rxt.status().at, goodAt, 'old list keeps its real time');
  assert.strictEqual(rxt.status().available, true, 'old list still shown');
  o = await rxt.refresh(async () => ({ error: 'busy' }));
  assert.ok(o.skipped, 'busy proves nothing');
  o = await rxt.refresh(async () => { throw new Error('boom'); });
  assert.ok(o.error && rxt.status().at === goodAt, 'a crash is a failure and keeps the time');

  // RingRx: a reply that isn't a list is a failed read (null), never an empty history; [] is a real "nothing".
  const ringrx = require(APP + '/ringrx');
  store.ringrx.set('p1', { username: 'u', refreshToken: 'r' });
  let shape = 'object';
  global.fetch = async (url) => {
    const u = String(url);
    const body = u.includes('/auth/refresh') ? { access_token: 'a', refresh_token: 'r', expires_in: 3600 }
      : u.includes('/voicemails') || u.includes('/cdrs') ? (shape === 'object' ? { error: 'changed' } : [])
      : u.includes('/myphones') || u.includes('/me') ? { callerId: '5125550100' } : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  assert.strictEqual(await ringrx.messages('p1'), null, 'wrong shape texts → failed read');
  assert.strictEqual(await ringrx.calls('p1'), null, 'wrong shape calls → failed read');
  shape = 'list';
  assert.deepStrictEqual(await ringrx.messages('p1').catch(() => 'err'), [], 'empty list is a real empty');

  // Gmail send needs a check that worked just now.
  const src = fs.readFileSync(APP + '/gmailapi.js', 'utf8');
  assert.ok(/if \(st\.error\) throw new GmailError/.test(src), 'send refuses after a failed check');
  assert.ok(/missing/.test(src), 'list reports emails that did not load');

  // Sign-in step detection (runs in a page): a wrong code is a code step, not a bad password; Doximity empty inbox is signed in.
  const page = (text, pathname = '/', host = 'login.example', inputs = []) => {
    global.location = { pathname, host };
    global.document = { body: { innerText: text }, querySelector: () => null, querySelectorAll: (q) => inputs.filter((i) => q.includes(i.kind)) };
    global.HTMLInputElement = function () {};
  };
  const loadFn = (file, name) => { const s = fs.readFileSync(APP + '/' + file, 'utf8'); const i = s.indexOf(`function ${name}(`); let d = 0, j = s.indexOf('{', i); for (; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) break; } return eval('(' + s.slice(i, j + 1) + ')'); };
  const rxStep = loadFn('rxnt-reader.js', 'autofillStep'), dxStep = loadFn('faxes.js', 'autofillStep');
  page('Incorrect verification code. Enter the code we sent.');
  assert.strictEqual(rxStep('u', 'p', false).step, 'code', 'RxNT: wrong code is a code step');
  assert.strictEqual(dxStep('u', 'p', false).step, 'code', 'Doximity: wrong code is a code step');
  page('Incorrect password');
  assert.strictEqual(rxStep('u', 'p', false).step, 'bad');
  page('Your inbox is empty', '/inbox/faxes');
  assert.strictEqual(dxStep('u', 'p', false).step, 'in', 'Doximity: empty inbox counts as signed in');

  // The planner: only an explicit success counts.
  const main = fs.readFileSync(APP + '/main.js', 'utf8');
  assert.ok(/function outcomeOf/.test(main) && /r\.ok === true/.test(main), 'explicit success contract');
  assert.ok(!/await mail\.signOut\(\); \}/.test(main), 'Gmail sign-out no longer calls itself');
  assert.ok(/DEADLINE_MIN/.test(main), 'every part has a time limit');
  console.log('2.3.1 OK');
})().catch((e) => { console.error(e); process.exit(1); });
