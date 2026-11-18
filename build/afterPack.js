// Sets the Windows .exe icon and version info without needing Wine (pure JS).
const path = require('path');
const fs = require('fs');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const ResEdit = await import('resedit').then((m) => m.default || m);
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const data = fs.readFileSync(exe);
  const res = ResEdit.NtExecutableResource.from(ResEdit.NtExecutable.from(data, { ignoreCert: true }));
  const exeObj = ResEdit.NtExecutable.from(data, { ignoreCert: true });
  const r = ResEdit.NtExecutableResource.from(exeObj);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(r.entries);
  const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(r.entries, id, lang, ico.icons.map((i) => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(r.entries)[0];
  if (vi) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'Ruhwell Front Desk', FileDescription: 'Ruhwell Front Desk', CompanyName: 'Ruhwell Medical PLLC',
      OriginalFilename: 'Ruhwell Front Desk.exe', InternalName: 'Ruhwell Front Desk', LegalCopyright: '© Ruhwell Medical PLLC',
    });
    const v = ctx.packager.appInfo.version.split('.').map(Number);
    vi.setFileVersion(v[0], v[1], v[2], 0); vi.setProductVersion(v[0], v[1], v[2], 0);
    vi.outputToResourceEntries(r.entries);
  }
  r.outputResource(exeObj);
  fs.writeFileSync(exe, Buffer.from(exeObj.generate()));
};
