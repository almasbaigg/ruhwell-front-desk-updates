// Every file the app requires must be packaged (1.6.0 shipped without activity.js and faxes.js and crashed on start).
const fs = require('fs'), path = require('path'), assert = require('assert');
const APP = path.join(__dirname, '..');
const files = require(APP + '/package.json').build.files;
const packaged = (f) => files.some((g) => g === f || (g.endsWith('/**') && f.startsWith(g.slice(0, -2))));
const seen = new Set(), queue = ['main.js'];
while (queue.length) {
  const f = queue.shift(); if (seen.has(f)) continue; seen.add(f);
  assert.ok(packaged(f), `${f} is required by the app but not in package.json build.files`);
  const src = fs.readFileSync(path.join(APP, f), 'utf8');
  for (const m of src.matchAll(/require\(['"]\.\/([\w./-]+)['"]\)/g)) queue.push(m[1].endsWith('.js') ? m[1] : m[1] + '.js');
}
// Every script the window loads must be packaged too (renderer/** covers it, but keep the check honest).
const html = fs.readFileSync(path.join(APP, 'renderer/index.html'), 'utf8');
for (const m of html.matchAll(/<script src="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(APP, 'renderer', m[1])), `missing ${m[1]}`);
console.log('packaging OK:', [...seen].join(', '));
