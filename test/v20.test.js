// 2.0: outbox (send later, quiet hours, never twice), Gmail message building (always from hello@), RingRx read sync.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-20-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal() {} } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const assert = require('assert');
const store = require(APP + '/store');
const outbox = require(APP + '/outbox');
const gapi = require(APP + '/gmailapi');

(async () => {
  // Quiet hours: 8 AM–8 PM Mon–Sat by default.
  const q = outbox.quiet();
  const d = (y, m, day, h, mi = 0) => new Date(y, m - 1, day, h, mi);
  assert.ok(outbox.allowed(d(2026, 11, 23, 10), q), 'Monday 10 AM allowed');
  assert.ok(!outbox.allowed(d(2026, 11, 23, 21), q), 'Monday 9 PM not allowed');
  assert.ok(!outbox.allowed(d(2026, 11, 29, 10), q), 'Sunday not allowed');
  assert.deepStrictEqual(outbox.nextAllowed(d(2026, 11, 23, 21, 40), q), d(2026, 11, 24, 8), '9:40 PM Monday → 8 AM Tuesday');
  assert.deepStrictEqual(outbox.nextAllowed(d(2026, 11, 28, 22), q), d(2026, 11, 30, 8), 'Saturday night → Monday 8 AM (skips Sunday)');
  assert.deepStrictEqual(outbox.nextAllowed(d(2026, 11, 23, 6), q), d(2026, 11, 23, 8), '6 AM → 8 AM same day');

  // Sending: each item once; failures marked; offline retried later; mid-send at close → "check this one".
  let sent = [];
  let mode = 'ok';
  outbox.start({ senders: { text: async (p) => { sent.push(p.n); return mode === 'ok' ? { ok: true } : mode === 'off' ? { ok: false, code: 'OFFLINE', error: 'offline' } : { ok: false, error: 'nope' }; } } });
  const a = outbox.add({ kind: 'text', label: 'A', payload: { n: 1 }, respectQuiet: false });
  await new Promise((r) => setTimeout(r, 400));
  await outbox.tick(); await outbox.tick();
  assert.deepStrictEqual(sent, [1], 'sent exactly once');
  assert.strictEqual(outbox.list().find((x) => x.id === a.id).status, 'sent');
  const later = outbox.add({ kind: 'text', label: 'B', payload: { n: 2 }, sendAt: new Date(Date.now() + 3600e3).toISOString(), respectQuiet: false });
  await outbox.tick();
  assert.deepStrictEqual(sent, [1], 'future item waits');
  assert.ok(outbox.cancel(later.id) && outbox.list().find((x) => x.id === later.id).status === 'cancelled', 'cancel works');
  mode = 'off';
  const off = outbox.add({ kind: 'text', label: 'C', payload: { n: 3 }, respectQuiet: false });
  await outbox.tick();
  const offNow = outbox.list().find((x) => x.id === off.id);
  assert.ok(offNow.status === 'scheduled' && new Date(offNow.sendAt) > Date.now() + 5 * 60000, 'offline → tried again in 10 minutes');
  mode = 'fail';
  const bad = outbox.add({ kind: 'text', label: 'D', payload: { n: 4 }, respectQuiet: false });
  await outbox.tick();
  assert.strictEqual(outbox.list().find((x) => x.id === bad.id).status, 'failed', 'a real failure is shown, not retried');
  // Simulate the app closing mid-send.
  const raw = store.raw.readSecure('outbox.bin', { items: [] }); raw.items.push({ id: 'ob-x', kind: 'text', status: 'sending', createdAt: new Date().toISOString(), sendAt: new Date().toISOString(), payload: { n: 9 } }); store.raw.writeSecure('outbox.bin', raw);
  outbox.start({ senders: { text: async (p) => { sent.push(p.n); return { ok: true }; } } });
  await new Promise((r) => setTimeout(r, 400)); await outbox.tick();
  assert.ok(!sent.includes(9), 'an item caught mid-send is never re-sent automatically');
  assert.strictEqual(outbox.list().find((x) => x.id === 'ob-x').status, 'uncertain');
  // Quiet hours hold: scheduled-respecting item due now at night waits.
  store.settings.set({ ...store.settings.get(), quietHours: { start: 8, end: 20, days: [] } });
  const held = outbox.add({ kind: 'text', label: 'E', payload: { n: 5 } });
  await outbox.tick();
  assert.ok(!sent.includes(5), 'no allowed days → held, not sent');
  outbox.cancel(held.id);
  store.settings.set({ ...store.settings.get(), quietHours: undefined });

  // Gmail message: always from hello@, attachments base64, subject encoding, reply headers.
  const raw2 = gapi.mime({ to: 'pat@example.com', subject: 'Welcome to Ruhwell Med | Next Steps', html: '<p>Hello Ann,</p><ol><li>One</li></ol>', files: [{ name: 'Packet.pdf', mime: 'application/pdf', b64: Buffer.from('%PDF-1.4 test').toString('base64') }], inReplyTo: '<abc@x>', fromName: 'Ruhwell Med' });
  assert.ok(/^From: Ruhwell Med <hello@ruhwellmed\.com>/m.test(raw2), 'From hello@');
  assert.ok(/^Reply-To: hello@ruhwellmed\.com/m.test(raw2), 'replies go to hello@');
  assert.ok(/^In-Reply-To: <abc@x>/m.test(raw2) && /^References: <abc@x>/m.test(raw2), 'reply threading headers');
  assert.ok(/multipart\/mixed/.test(raw2) && /filename="Packet\.pdf"/.test(raw2), 'attachment present');
  assert.ok(/=\?UTF-8\?B\?/.test(gapi.mime({ to: 'a@b.co', subject: 'Café', html: '' })), 'non-ASCII subject encoded');
  assert.strictEqual(gapi.plain('<p>Hi <b>Ann</b></p><ol><li>One</li></ol><a href="tel:+1979">(979)</a>'), 'Hi Ann\n• One\n(979) (tel:+1979)');
  assert.ok(gapi.validEmail('a.b@ruhwellmed.com') && !gapi.validEmail('nope') && !gapi.validEmail('a@b'), 'email check');
  // Sending refuses before touching Gmail when the address is wrong.
  await assert.rejects(() => gapi.send({ to: 'not-an-email', subject: 's', html: '' }), /Check the email address/);
  // Key file: only a real Google desktop key is accepted.
  assert.ok(gapi.loadKeyFile('{"x":1}').error, 'bad key file refused');
  assert.ok(gapi.loadKeyFile(JSON.stringify({ installed: { client_id: '1-abc.apps.googleusercontent.com', client_secret: 's', project_id: 'ruhwell-front-desk' } })).ok, 'desktop key accepted');
  assert.ok(gapi.hasKey() && !gapi.connected(), 'key loaded, not yet signed in');

  // RingRx read sync: a voicemail read in RingRx counts as listened; a text read there isn't unread here.
  const comms = require(APP + '/comms');
  const now = Date.now(), iso = (m) => new Date(now - m * 60000).toISOString();
  store.ringrxHistory.set({ items: [{ id: 't1', kind: 'text', inbound: true, phone: '5125550101', at: iso(30), body: 'hi', unread: false }, { id: 't2', kind: 'text', inbound: true, phone: '5125550102', at: iso(20), body: 'yo', unread: true }], at: iso(0), v: 2 });
  const vms = [{ id: 'v1', phone: '5125550103', at: iso(10), transcription: '', secs: 9, unread: false }];
  const calls = [{ id: 'c1', inbound: true, phone: '5125550103', at: iso(11), secs: 30, answered: false, toMailbox: true, missed: true }];
  comms.attachVoicemails(calls, vms);
  store.calls.set({ items: calls, vms, at: iso(0), v: 2 });
  const vm = comms.callList(7).find((c) => c.vmId === 'v1');
  assert.ok(vm && vm.heardAt, 'voicemail already read in RingRx shows as listened');
  const th = comms.textThreads(7);
  assert.strictEqual(th.find((t) => t.phone === '5125550101').unread, 0, 'text read in RingRx is not unread in the app');
  assert.strictEqual(th.find((t) => t.phone === '5125550102').unread, 1, 'text still new in RingRx is unread');
  assert.deepStrictEqual(comms.unreadRingrxTexts('5125550102'), ['t2']);
  comms.setRingrxRead(['t2']);
  assert.deepStrictEqual(comms.unreadRingrxTexts('5125550102'), [], 'marked read locally after RingRx confirms');

  // Welcome email template matches the practice's Gmail welcome.
  const w = store.emailTemplates.get().find((t) => t.id === 'welcome-email');
  assert.ok(w && w.packet && /Next Steps Before Your Appointment/.test(w.subject) && /\{first\}/.test(w.html) && /205-5460/.test(w.html), 'welcome template');
  assert.ok(fs.existsSync(path.join(APP, 'assets', 'welcome-packet.pdf')), 'welcome packet bundled');

  console.log('2.0 OK');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
