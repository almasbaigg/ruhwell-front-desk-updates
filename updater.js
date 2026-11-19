// Automatic updates from the public "ruhwell-front-desk-updates" repository (installers only, no code):
// latest.yml + RuhwellFrontDesk-Setup.exe sit on its main branch and are read as plain files.
// Checks at start and every 4 hours, downloads quietly, then the app shows "Update ready – Restart".
// If you don't restart, it installs the next time the app quits.
// Windows and Mac: download quietly, then "Restart to update". (Mac apps from older versions fall back to a download link.)
const { app } = require('electron');

let state = { status: 'idle', version: null, error: null };
let notify = () => {};
let doCheck = null;

const BASE = 'https://raw.githubusercontent.com/almasbaigg/ruhwell-front-desk-updates/main/';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// Mac: the app downloads the new version itself, unpacks it next to the old one and swaps it in on restart.
// Files the app downloads itself aren't flagged by macOS, so there's no "damaged" warning. If anything goes
// wrong (or the app isn't in a folder it can write to), it falls back to opening the download page.
const fs = require('fs'), path = require('path'), os = require('os');
let macReady = null;   // { app: path to the unpacked new app }
const appBundle = () => path.resolve(process.execPath, '..', '..', '..');
function initMac() {
  const set = (s) => { state = { ...state, ...s }; notify(state); };
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const check = async () => {
    if (state.status === 'downloading' || state.status === 'ready') return;
    set({ status: 'checking', error: null });
    try {
      const { net } = require('electron');
      const r = await net.fetch(BASE + 'latest-mac.yml?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const yml = await r.text();
      const v = (yml.match(/^version:\s*(\S+)/m) || [])[1];
      // The release lists a checksum for each file; the download must match it exactly.
      const sumFor = (file) => { const i = yml.indexOf(`url: ${file}`); if (i < 0) return null; const m = yml.slice(i).match(/sha512:\s*(\S+)/); return m ? m[1] : null; };
      if (!v || !newer(v, app.getVersion())) return set({ status: 'current' });
      const rel = `https://github.com/almasbaigg/ruhwell-front-desk-updates/releases/download/v${v}/RuhwellFrontDesk-${arch}`;
      const bundle = appBundle();
      let writable = false; try { fs.accessSync(path.dirname(bundle), fs.constants.W_OK); writable = /\.app$/.test(bundle); } catch {}
      if (!writable) return set({ status: 'available', version: v, url: rel + '.dmg' });
      set({ status: 'downloading', version: v });
      const want = sumFor(`RuhwellFrontDesk-${arch}.zip`);
      const zr = want ? await net.fetch(rel + '.zip') : null;
      if (!zr || !zr.ok) return set({ status: 'available', version: v, url: rel + '.dmg' });
      const bytes = Buffer.from(await zr.arrayBuffer());
      if (require('crypto').createHash('sha512').update(bytes).digest('base64') !== want) throw new Error("The update didn't match its checksum, so it wasn't installed.");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfd-update-')), zip = path.join(dir, 'update.zip');
      fs.writeFileSync(zip, bytes);
      require('child_process').execFileSync('/usr/bin/ditto', ['-x', '-k', zip, dir]);
      const found = fs.readdirSync(dir).find((f) => f === 'Ruhwell Front Desk.app');
      if (!found) throw new Error('The download was incomplete.');
      const plist = fs.readFileSync(path.join(dir, found, 'Contents', 'Info.plist'), 'utf8');
      if (!plist.includes(`<string>${v}</string>`)) throw new Error('The download was the wrong version.');
      // Stage it next to the installed app (same disk), so the swap itself is a quick rename.
      const staged = appBundle() + '.new';
      fs.rmSync(staged, { recursive: true, force: true });
      require('child_process').execFileSync('/bin/mv', [path.join(dir, found), staged]);
      macReady = { app: staged, version: v };
      set({ status: 'ready', version: v });
    } catch (e) { set({ status: 'error', error: String(e.message || e).slice(0, 200) }); }
  };
  doCheck = check;
  setTimeout(check, 30000);
  setInterval(check, 4 * 36e5);
}
// Swap the new app in after this one quits, then open it. The old app is kept as "….app.old" until the new
// version reports it started fine (it writes a small "update-ok" note after a minute of running). If that
// note doesn't appear within 3 minutes (the new version crashed or won't open), the old app is put back and
// opened again. Paths are passed as arguments, never pasted into the command. Sign-ins and data live elsewhere.
const okNote = () => path.join(app.getPath('userData'), 'update-ok.txt');
const SWAP = `while kill -0 "$1" 2>/dev/null; do sleep 0.3; done
rm -rf "$2.old"
mv "$2" "$2.old" || { open "$2"; exit 1; }
mv "$3" "$2" || { mv "$2.old" "$2"; open "$2"; exit 1; }
open "$2"
i=0; while [ $i -lt 180 ]; do grep -qx "$5" "$4" 2>/dev/null && { rm -rf "$2.old"; exit 0; }; sleep 1; i=$((i+1)); done
pkill -f "$2/Contents/MacOS/" 2>/dev/null; sleep 2
rm -rf "$2"; mv "$2.old" "$2"; open "$2"`;
function macSwapAndRestart() {
  try { fs.rmSync(okNote(), { force: true }); } catch {}
  require('child_process').spawn('/bin/sh', ['-c', SWAP, 'rfd-update', String(process.pid), appBundle(), macReady.app, okNote(), macReady.version], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}
// Running fine for a minute after starting: tell the updater (so it keeps this version) and tidy up.
function reportHealthy() {
  if (process.platform !== 'darwin' || !app.isPackaged) return;
  setTimeout(() => {
    try { fs.writeFileSync(okNote(), app.getVersion()); } catch {}
    setTimeout(() => { try { fs.rmSync(appBundle() + '.old', { recursive: true, force: true }); } catch {} }, 10000);
  }, 60000);
}

function init(onChange) {
  notify = onChange;
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') { reportHealthy(); return initMac(); }
  if (process.platform !== 'win32') return;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const set = (s) => { state = { ...state, ...s }; notify(state); };
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => set({ status: 'downloading', version: i.version }));
  autoUpdater.on('update-not-available', () => set({ status: 'current' }));
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => set({ status: 'error', error: String((e && e.message) || e).slice(0, 200) }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  doCheck = check;
  setTimeout(check, 30000);
  setInterval(check, 4 * 36e5);
}

// "Check now" from Settings. Only works in the installed Windows app.
function checkNow() {
  if (!doCheck) return { status: 'unavailable', error: 'Updates work in the installed app only.' };
  doCheck(); return state;
}

function restart() {
  if (state.status === 'available' && state.url) { require('electron').shell.openExternal(state.url); return true; }
  if (state.status !== 'ready') return false;
  if (process.platform === 'darwin') { if (macReady) macSwapAndRestart(); return true; }
  require('electron-updater').autoUpdater.quitAndInstall(true, true);
  return true;
}

module.exports = { init, restart, checkNow, status: () => state };
