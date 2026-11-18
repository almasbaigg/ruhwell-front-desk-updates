// Automatic updates from the public "ruhwell-front-desk-updates" repository (installers only, no code):
// latest.yml + RuhwellFrontDesk-Setup.exe sit on its main branch and are read as plain files.
// Checks at start and every 4 hours, downloads quietly, then the app shows "Update ready – Restart".
// If you don't restart, it installs the next time the app quits.
// Windows: downloads and installs. Mac: shows "Update available" and opens the new download (no paid signing).
const { app } = require('electron');

let state = { status: 'idle', version: null, error: null };
let notify = () => {};
let doCheck = null;

const BASE = 'https://raw.githubusercontent.com/almasbaigg/ruhwell-front-desk-updates/main/';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };

// Mac: unsigned apps can't replace themselves, so the app tells you a new version is out and opens the download.
function initMac() {
  const set = (s) => { state = { ...state, ...s }; notify(state); };
  const check = async () => {
    set({ status: 'checking', error: null });
    try {
      const r = await require('electron').net.fetch(BASE + 'latest-mac.yml?t=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const v = ((await r.text()).match(/^version:\s*(\S+)/m) || [])[1];
      if (v && newer(v, app.getVersion())) set({ status: 'available', version: v, url: `https://github.com/almasbaigg/ruhwell-front-desk-updates/releases/download/v${v}/RuhwellFrontDesk-${process.arch === 'arm64' ? 'arm64' : 'x64'}.dmg` });
      else set({ status: 'current' });
    } catch (e) { set({ status: 'error', error: String(e.message || e).slice(0, 200) }); }
  };
  doCheck = check;
  setTimeout(check, 30000);
  setInterval(check, 4 * 36e5);
}

function init(onChange) {
  notify = onChange;
  if (!app.isPackaged) return;
  if (process.platform === 'darwin') return initMac();
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
  require('electron-updater').autoUpdater.quitAndInstall(true, true);
  return true;
}

module.exports = { init, restart, checkNow, status: () => state };
