# Android app, GitHub builds & in-app updates

This project is now a Capacitor Android app. GitHub Actions builds a
downloadable APK and publishes it to a rolling **latest** GitHub Release.
The app checks that release on launch and supports two kinds of updates.

## What happens on launch

1. A tiny loader (`www/index.html`) starts first.
2. If a newer web bundle was downloaded on a previous run, the loader boots it.
3. Otherwise it boots the app baked into the APK.
4. The app checks GitHub about 2.5 seconds later.

### 1. Code update (no reinstall)

For HTML/JS/CSS-only changes, the app downloads `app.html` in the
background, stores it in local storage, and boots it on the **next launch**.
The APK is not replaced. A "Restart" button applies it immediately.

### 2. APK update (native changes)

When `nativeVersionCode` in `version.json` is higher than the installed
build, the app downloads `app.apk` and opens Android's package installer.
Data stays on the device.

> Android only allows an APK update when the new APK is signed with the
> **same key** as the installed one. Set up the signing secrets below.

## Android hardware back button

The back button now behaves like an in-app back button:

1. closes the confirmation dialog
2. closes any open modal
3. closes the mobile sidebar
4. closes an open customer dropdown
5. returns from a customer ledger to the customer list
6. walks back through visited pages
7. on the dashboard, shows "Press back again to exit"; a second press exits

Only the final press closes the app.

## GitHub setup

### 1. Push the repo

```bash
git init
git add .
git commit -m "Capacitor app with in-app updates"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

The workflow runs on `main`/`master` and can also be started manually from
the **Actions** tab (`Build Android APK` → *Run workflow*).

### 2. Add signing secrets (strongly recommended)

Without these the workflow still builds an installable APK, but every run
is debug-signed with a different key, so later APKs **cannot** install over
an older one. Create one keystore and reuse it forever.

Generate a keystore (use the JDK bundled with Android Studio if `keytool`
is not on PATH):

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" `
  -genkeypair -v -keystore release.keystore `
  -alias amin -keyalg RSA -keysize 2048 -validity 10000
```

Then create these four repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `amin` (or your alias) |
| `ANDROID_KEY_PASSWORD` | key password |

Base64 encoding:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Set-Clipboard
```

```bash
base64 -w0 release.keystore
```

Keep `release.keystore` backed up and **never commit it** (it is gitignored).

### 3. Make the update channel reachable

The app downloads `update.json` / `app.html` / `app.apk` from the public
release address:

```
https://github.com/<owner>/<repo>/releases/latest/download/update.json
```

That means the repository must be **public** (no token is compiled into the
app).

If the repo is private, publishing a public update feed is still possible,
but it is outside this setup. The simplest option is a public repo.

### 4. Install the first APK

Open **Actions → Build Android APK → latest run → Artifacts** and download
`AminBrothers-v…`, or open **Releases → latest** and download `app.apk`.
Transfer it to the phone and install it (allow "install unknown apps").

## Releasing updates

### Web-only change (most changes)

1. Edit `index.html` (or other web files).
2. Optionally bump `version` in `version.json`.
3. Commit and push to `main`.

The workflow stamps a new `webBuild` from the Actions run number, publishes
`app.html`, and installed apps download it silently and apply it on the
next launch.

### Native change

Bump `nativeVersionCode` in `version.json` whenever you change anything
Android-side: native plugins (`android/...`), permissions, app icon, splash,
Capacitor version, package name, or the CDN library list in `index.html`.

```json
{
  "version": "1.1.0",
  "nativeVersionCode": 2
}
```

Push. The manifest now advertises a higher native code, so the app downloads
and installs the APK.

### Web bundle vs. loader

`www/index.html` is a small loader that also loads the CDN libraries
(Firebase, Chart.js, jsPDF). The loader boots either the downloaded
`app.html` or the copy embedded in the APK.

- Normal app code changes → OTA.
- Changing one of those CDN `<script src>` URLs in `index.html` → requires a
  new APK, because the loader (not the OTA bundle) loads them.
- Installing a newer APK automatically discards any older downloaded
  `app.html`, so an old OTA bundle never overrides a newer APK.

### Version fields

| Field | Meaning |
| --- | --- |
| `version` | Human-readable version name (shown in the app) |
| `nativeVersionCode` | Android version code. Bump for APK releases |
| `webBuild` | Auto-generated from the GitHub Actions run number |
| `minNativeVersionCode` | Native build required by this web bundle |

The update repository is injected automatically at build time from
`GITHUB_REPOSITORY` (`scripts/build-web.mjs`), so no source edit is needed.
For local testing you can override it in the browser console:

```js
localStorage.setItem('erp_update_repo', 'owner/repo');
```

## Local builds

Requirements: Node 22+, JDK 21, Android SDK 36.

```bash
npm install
npm run sync
cd android
./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/`.

## Files involved

| File | Purpose |
| --- | --- |
| `index.html` | The app document (source) |
| `scripts/build-web.mjs` | Stamps version, writes `www/app.html` + loader `www/index.html` |
| `scripts/make-manifest.mjs` | Creates `update.json` for the release |
| `version.json` | Version name + native version code |
| `capacitor.config.json` | Capacitor app id / web dir |
| `android/.../NativeUpdaterPlugin.java` | APK download + Android installer |
| `android/.../MainActivity.java` | Registers the plugin |
| `.github/workflows/android.yml` | Build + release pipeline |

## Troubleshooting

- **"Update channel not configured"** — the app was built without
  `GITHUB_REPOSITORY` (local build). Set `erp_update_repo` as above or let CI
  stamp it.
- **Update check fails with HTTP 404** — no `latest` release yet, the repo is
  private, or the repo name is wrong.
- **Android refuses to install the APK** — the signing key changed. Restore the
  same keystore secrets; the user may need to uninstall once.
- **Update downloads but the app stays on the old code** — the downloaded
  bundle confirms itself after a successful start. Check the Updates page;
  "Ready" means it will start on the next launch.
