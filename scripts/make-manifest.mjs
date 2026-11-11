/**
 * Creates update.json for a GitHub release.
 *
 *   node scripts/make-manifest.mjs <app.html> <app.apk> <update.json>
 *
 * The app reads this file from the assets of the "latest" release and
 * decides between a silent web update (webBuild) and an APK install
 * (nativeVersionCode).
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const [, , htmlPath, apkPath, outPath] = process.argv;
if (!htmlPath || !apkPath || !outPath) {
  console.error('Usage: node make-manifest.mjs <app.html> <app.apk> <update.json>');
  process.exit(1);
}

const versionJson = JSON.parse(readFileSync('version.json', 'utf8'));
const html = readFileSync(htmlPath);
const apk = readFileSync(apkPath);

function meta(name) {
  const m = html.toString('utf8').match(new RegExp(`<meta name="${name}" content="([^"]*)"`));
  return m ? m[1] : '';
}

const webBuild = Number(meta('app-build')) || Number(process.env.GITHUB_RUN_NUMBER) || 0;
const version = meta('app-version') || versionJson.version;
const nativeVersionCode = Number(versionJson.nativeVersionCode) || 1;

let notes = (process.env.RELEASE_NOTES || '').trim();
if (!notes) {
  try {
    notes = execSync('git log -1 --pretty=%s', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {}
}
if (!notes) notes = `Build ${webBuild}`;
notes = notes.slice(0, 2000);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const manifest = {
  version,
  webBuild,
  nativeVersionCode,
  minNativeVersionCode: nativeVersionCode,
  releasedAt: new Date().toISOString(),
  notes,
  web: {
    asset: 'app.html',
    size: statSync(htmlPath).size,
    sha256: sha256(html)
  },
  apk: {
    asset: 'app.apk',
    size: statSync(apkPath).size,
    sha256: sha256(apk),
    versionName: version,
    versionCode: nativeVersionCode
  }
};

writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `update.json  version=${version}  webBuild=${webBuild}  nativeVersionCode=${nativeVersionCode}`
);
