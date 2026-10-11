// Läuft nach dem Verpacken: signiert die Mac-App "ad-hoc" (kostenlos, ohne Apple-Konto).
// Ohne irgendeine Signatur starten Apps auf Apple-Silicon-Macs gar nicht.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.appOutDir.endsWith('-temp')) return; // Zwischenstufen der Universal-App überspringen
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  console.log(`  • ad-hoc signiert: ${app}`);
};
