// 3.0: snooze follow-through, patient sort and name case, nameless pop-ups, layout and greeting.
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os'), vm = require('vm');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-300-'));
const fake = { app: { getPath: () => dir, isPackaged: false }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, session: { fromPartition: () => ({}) } };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? fake : orig.call(this, r, ...a); };
const APP = path.join(__dirname, '..');
const assert = require('assert');
const comms = require(APP + '/comms');

// Snoozes come back: an expired snooze moves to "woke" once, and isn't hidden any more.
comms.snooze('k1', Date.now() + 50); comms.snooze('k2', Date.now() + 3600e3);
assert.ok(comms.snoozes().k1 && comms.snoozes().k2);
const wait = Date.now() + 80; while (Date.now() < wait) {}
assert.strictEqual(comms.snoozeTick(), 1, 'one item woke');
assert.ok(comms.woke().k1 && !comms.woke().k2);
assert.ok(!comms.snoozes().k1 && comms.snoozes().k2);
assert.strictEqual(comms.snoozeTick(), 0, 'not woken twice');

const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const main = read('main.js'), core = read('renderer/js/core.js'), pats = read('renderer/js/patients.js'), css = read('renderer/styles.css'), html = read('renderer/index.html');
// The "Back from Later" pop-up never names anyone.
const pop = main.match(/notify\(n === 1 \? 'Back from Later'[^\n]*/)[0];
assert.ok(!/fullName|first|last|name/i.test(pop.replace(/Back from Later/g, '')), 'snooze pop-up has no names');

// ALL-CAPS names show in normal case; mixed case is left alone.
const ctx = {}; vm.createContext(ctx);
vm.runInContext(core.match(/function niceCase[\s\S]*?\n}\n/)[0], ctx);
assert.strictEqual(ctx.niceCase('MCDONALD'), 'McDonald');
assert.strictEqual(ctx.niceCase("O'BRIEN"), "O'Brien");
assert.strictEqual(ctx.niceCase('SMITH-JONES'), 'Smith-Jones');
assert.strictEqual(ctx.niceCase('deLuca'), 'deLuca');
assert.strictEqual(ctx.niceCase('A'), 'A');

// Patients sort by First Name by default, with Last Name and DOB, remembered.
assert.ok(/localStorage\.getItem\('pSort'\) \|\| 'first'/.test(pats));
assert.ok(/\['first', 'First Name'\], \['last', 'Last Name'\], \['dob', 'DOB'\]/.test(pats));

// No window scrollbar: content is clipped and panels scroll on their own.
assert.ok(/\.content \{[^}]*overflow: hidden/.test(css));
// Tomorrow shortcut gone from the date picker; greeting and HUD respect Reduce Motion.
assert.ok(!/pm-tomorrow/.test(read('renderer/js/shell.js')));
assert.ok(/#greet\.still/.test(css) && /\.hud\.still/.test(css));
// Alerts keep their settings keys after the redesign.
for (const k of ['schedule', 'reply', 'fax', 'newpatient', 'rx', 'nudge', 'task', 'soon']) assert.ok(html.includes(`data-k="${k}" data-c="desk"`), k);
console.log('3.0 OK');
