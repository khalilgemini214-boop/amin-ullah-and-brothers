/**
 * Builds the web bundle consumed by Capacitor and the OTA updater.
 *
 *   index.html  -> app source (full document)
 *   www/app.html -> stamped app document (this is also the OTA asset)
 *   www/index.html -> tiny loader shell that boots either the downloaded
 *                     app.html or the copy embedded in the APK.
 *
 * Stamping:
 *   APP_VERSION       from version.json
 *   APP_BUILD         GITHUB_RUN_NUMBER in Actions, otherwise a timestamp
 *   UPDATE_REPO       GITHUB_REPOSITORY in Actions
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionJson = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));
const version = String(versionJson.version || '0.0.0');
const nativeVersionCode = Number(versionJson.nativeVersionCode || 1);
const webBuild = process.env.GITHUB_RUN_NUMBER
  ? Number(process.env.GITHUB_RUN_NUMBER)
  : Date.now();
const updateRepo = process.env.GITHUB_REPOSITORY || 'OWNER/REPO';

let appHtml = readFileSync(join(root, 'index.html'), 'utf8');
appHtml = appHtml
  .replaceAll('__APP_VERSION__', version)
  .replaceAll('__APP_NATIVE_CODE__', String(nativeVersionCode))
  .replaceAll('__APP_BUILD__', String(webBuild))
  .replaceAll('__UPDATE_REPO__', updateRepo);

// The loader loads these libraries once, before it writes the app document.
// Keeping them out of the written document avoids Chrome's document.write
// script intervention and means the globals survive OTA document swaps.
// The URLs come from index.html, so there is only one place to update them.
const CDN_TAG_RE =
  /<script src="https:\/\/(?:www\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\/[^"]+"><\/script>/g;
const cdnTags = (appHtml.match(CDN_TAG_RE) || [])
  .map((tag) => tag.replace('<script ', '<script defer '))
  .join('\n');
const CDN_STRIP_RE =
  /<script src="https:\/\/(?:www\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\/[^"]+"><\/script>\s*/g;
appHtml = appHtml.replace(CDN_STRIP_RE, '');

mkdirSync(join(root, 'www'), { recursive: true });
writeFileSync(join(root, 'www', 'app.html'), appHtml, 'utf8');

// A JS string literal, safe to embed inside a <script> element.
const appLiteral = JSON.stringify(appHtml).replace(/<\/script/gi, '<\\/script');

const loader = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
<meta name="theme-color" content="#0d0f14"/>
<title>Amin Ullah &amp; Brothers</title>
${cdnTags}
<style>
  html,body{height:100%;margin:0;background:#0d0f14;color:#f5a623;font-family:system-ui,-apple-system,sans-serif}
  #boot{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
  #boot .sp{width:34px;height:34px;border:3px solid #222736;border-top-color:#f5a623;border-radius:50%;animation:sp .7s linear infinite}
  #boot .lbl{font-size:12px;color:#7c8699;letter-spacing:.04em}
  @keyframes sp{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div id="boot"><div class="sp"></div><div class="lbl">Amin Ullah &amp; Brothers</div></div>
<script>window.__BUILTIN_APP__=${appLiteral};</script>
<script>
/* OTA loader: boot the downloaded app.html when one is stored, otherwise
   boot the app embedded in the APK. The app calls Updater.confirmBoot()
   after a healthy start; two failed starts discard the downloaded bundle. */
(function(){
  var KEY='erp_ota_bundle_v1', PEND='erp_ota_pending', FAILS='erp_ota_fails';
  var html=null;
  try{
    // A freshly installed APK may already contain a newer web build than
    // the downloaded bundle. Never boot an older bundle over a newer APK.
    var builtin=window.__BUILTIN_APP__||'';
    var bm=builtin.match(/<meta name="app-build" content="([^"]+)"/);
    var builtinBuild=bm?Number(bm[1])||0:0;

    var raw=localStorage.getItem(KEY);
    if(raw){
      var o=JSON.parse(raw);
      if(o&&o.html&&o.build!=null){
        if(builtinBuild&&Number(o.build)<=builtinBuild){
          localStorage.removeItem(KEY);
          localStorage.removeItem(PEND);
          localStorage.removeItem(FAILS);
        }else{
          var fails=parseInt(localStorage.getItem(FAILS)||'0',10)||0;
          var pending=String(localStorage.getItem(PEND)||'');
          var pBuild=pending?pending.split(':')[0]:'';
          var pAt=Number(pending.split(':')[1]||0)||0;
          // A pending boot older than 15s that never confirmed means the
          // previous attempt crashed. Two crashes discard the bundle.
          if(pBuild===String(o.build)&&Date.now()-pAt>15000){
            fails++;
            localStorage.setItem(FAILS,String(fails));
            if(fails>=2){
              try{ localStorage.setItem('erp_ota_bad',String(o.build)+':'+Date.now()); }catch(_){}
              localStorage.removeItem(KEY);
              localStorage.removeItem(PEND);
              localStorage.removeItem(FAILS);
            }else{
              html=o.html;
            }
          }else{
            html=o.html;
          }
          if(html){
            localStorage.setItem(PEND,String(o.build)+':'+Date.now());
          }
        }
      }
    }
  }catch(e){ html=null; }

  if(!html) html=window.__BUILTIN_APP__||'';

  function boot(){
    try{
      window.__ERP_OTA_BOOT__=true;
      document.open();
      document.write(html);
      document.close();
    }catch(e){
      try{localStorage.removeItem(KEY);localStorage.removeItem(PEND);}catch(_){}
      location.reload();
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
</script>
</body>
</html>
`;
writeFileSync(join(root, 'www', 'index.html'), loader, 'utf8');

// Static files Capacitor should also ship (optional).
for (const file of ['icon.png', 'manifest.webmanifest']) {
  if (existsSync(join(root, file))) copyFileSync(join(root, file), join(root, 'www', file));
}

console.log(`Built www/index.html (loader) + www/app.html  version=${version}  nativeCode=${nativeVersionCode}  webBuild=${webBuild}  repo=${updateRepo}`);
