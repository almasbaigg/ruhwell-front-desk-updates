// In-app browser: "Open in RxNT" and "Open in Doximity" open here, in a Ruhwell Front Desk window that uses
// the app's own saved sign-in (the same session the app reads with), so it's already signed in.
// A slim bar on top: back, forward, reload, the site name, and "Open in my browser".
const { BrowserWindow, WebContentsView, shell } = require('electron');
const path = require('path');

const SITES = {
  rxnt: { name: 'RxNT', ok: /^https:\/\/([\w-]+\.)*rxnt\.com(\/|$)/i },
  doximity: { name: 'Doximity', ok: /^https:\/\/([\w-]+\.)*doximity\.com(\/|$)/i },
};
const BAR = 44;
const wins = {};   // one window per site, reused

function barHTML(site) {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>body{margin:0;height:${BAR}px;display:flex;align-items:center;gap:6px;padding:0 10px;background:#f6f1eb;font:600 13px system-ui,sans-serif;color:#005758;-webkit-app-region:drag;border-bottom:1px solid #e6ded3}
button{-webkit-app-region:no-drag;border:0;background:transparent;color:#005758;font:600 13px system-ui;padding:6px 10px;border-radius:8px;cursor:pointer}button:hover{background:#e7efec}
.t{flex:1;text-align:center;opacity:.8}</style>
<button onclick="location.hash='back'" title="Back">&#8592;</button><button onclick="location.hash='fwd'" title="Forward">&#8594;</button><button onclick="location.hash='reload'" title="Reload">&#8635;</button>
<span class="t">${site.name} · signed in through Ruhwell Front Desk</span><button onclick="location.hash='ext'">Open in my browser</button>`;
}

function open(siteKey, partition, url, parent) {
  const site = SITES[siteKey]; if (!site || !site.ok.test(String(url))) return false;
  let w = wins[siteKey];
  if (w && !w.win.isDestroyed()) { w.view.webContents.loadURL(url).catch(() => {}); w.win.show(); w.win.focus(); return true; }
  const win = new BrowserWindow({ width: 1280, height: 860, title: `${site.name} · Ruhwell Front Desk`, autoHideMenuBar: true, backgroundColor: '#f6f1eb', icon: path.join(__dirname, 'assets', 'icon.png'), webPreferences: { contextIsolation: true, sandbox: true } });
  const view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, sandbox: true } });
  win.contentView.addChildView(view);
  const fit = () => { const [cw, ch] = win.getContentSize(); view.setBounds({ x: 0, y: BAR, width: cw, height: Math.max(0, ch - BAR) }); };
  win.on('resize', fit); fit();
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(barHTML(site)));
  // The bar talks through its URL hash: back / fwd / reload / ext.
  win.webContents.on('did-navigate-in-page', (_e, u) => {
    const cmd = String(u).split('#')[1] || ''; const wc = view.webContents;
    if (cmd === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (cmd === 'fwd' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    if (cmd === 'reload') wc.reload();
    if (cmd === 'ext') shell.openExternal(wc.getURL());
    win.webContents.executeJavaScript("history.replaceState(null,'',location.pathname+location.search)").catch(() => {});
  });
  // Stay on the site; anything else (and new windows) goes to the normal browser.
  view.webContents.setWindowOpenHandler(({ url: u }) => { if (site.ok.test(u)) view.webContents.loadURL(u).catch(() => {}); else if (/^https:\/\//.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  view.webContents.on('will-navigate', (e, u) => { if (!site.ok.test(u) && !/^https:\/\/([\w-]+\.)*(auth0|okta|microsoftonline|google)\.com\//i.test(u)) { e.preventDefault(); if (/^https:\/\//.test(u)) shell.openExternal(u); } });
  view.webContents.loadURL(url).catch(() => {});
  win.on('closed', () => { delete wins[siteKey]; });
  wins[siteKey] = { win, view };
  return true;
}

module.exports = { open, SITES };
