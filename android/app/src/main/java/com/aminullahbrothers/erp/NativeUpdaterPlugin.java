package com.aminullahbrothers.erp;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads a new APK from the GitHub release and hands it to Android's
 * package installer. Progress is emitted as "downloadProgress" events.
 */
@CapacitorPlugin(name = "NativeUpdater")
public class NativeUpdaterPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String fileName = call.getString("fileName", "update.apk");
        String sha256 = call.getString("sha256", "");
        if (url == null || url.isEmpty()) {
            call.reject("Missing download URL");
            return;
        }
        call.setKeepAlive(true);
        executor.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new Exception("Could not create the update folder");
                }
                File apk = new File(dir, fileName);
                download(url, apk, sha256);

                // Opening the installer must happen on the UI thread.
                getActivity().runOnUiThread(() -> {
                    try {
                        JSObject result = new JSObject();
                        result.put("path", apk.getAbsolutePath());
                        if (!canInstallPackages()) {
                            result.put("needsPermission", true);
                            openInstallSettings();
                        } else {
                            result.put("needsPermission", false);
                            startInstaller(apk);
                        }
                        call.resolve(result);
                    } catch (Exception e) {
                        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
                        call.reject(msg, e);
                    } finally {
                        call.setKeepAlive(false);
                    }
                });
            } catch (Exception e) {
                String msg = e.getMessage() == null ? e.toString() : e.getMessage();
                call.reject(msg, e);
                call.setKeepAlive(false);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Missing APK path");
            return;
        }
        File apk = new File(path);
        if (!apk.exists()) {
            call.reject("APK file not found");
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("path", apk.getAbsolutePath());
            if (!canInstallPackages()) {
                result.put("needsPermission", true);
                openInstallSettings();
            } else {
                result.put("needsPermission", false);
                result.put("started", true);
                startInstaller(apk);
            }
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? e.toString() : e.getMessage(), e);
        }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", canInstallPackages());
        call.resolve(result);
    }

    private void download(String urlString, File destination, String expectedSha256) throws Exception {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlString).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(60000);
            conn.setRequestProperty("User-Agent", "AminERP-Android");
            conn.setRequestProperty("Accept", "application/octet-stream");

            int code = conn.getResponseCode();
            if (code >= 400) {
                throw new Exception("Download failed (HTTP " + code + ")");
            }
            int total = conn.getContentLength();
            MessageDigest digest = MessageDigest.getInstance("SHA-256");

            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(destination)) {
                byte[] buffer = new byte[64 * 1024];
                long received = 0;
                long lastEmit = 0;
                int read;
                while ((read = in.read(buffer)) > 0) {
                    out.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    received += read;

                    long now = System.currentTimeMillis();
                    if (now - lastEmit > 250) {
                        lastEmit = now;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total);
                        progress.put("percent", total > 0 ? (received * 100.0 / total) : 0);
                        notifyListeners("downloadProgress", progress);
                    }
                }
            }

            if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                StringBuilder sb = new StringBuilder();
                for (byte b : digest.digest()) {
                    sb.append(String.format("%02x", b));
                }
                if (!sb.toString().equalsIgnoreCase(expectedSha256)) {
                    //noinspection ResultOfMethodCallIgnored
                    destination.delete();
                    throw new Exception("Downloaded APK is corrupted (checksum mismatch)");
                }
            }
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private boolean canInstallPackages() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    private void openInstallSettings() {
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
            // Some OEMs do not expose this settings screen; the install
            // prompt itself will still ask the user for permission.
        }
    }

    private void startInstaller(File apk) {
        Uri uri = FileProvider.getUriForFile(
            getContext(),
            getContext().getPackageName() + ".fileprovider",
            apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.setClipData(ClipData.newRawUri("apk", uri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
