package com.jfmod.GiteePro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Gitee Pro：原生壳 + 本地 Web 前端 SPA。
 * 网络、Cookie 登录态、文件读写/上传/下载、SAF 文件选择等能力全部由原生层提供，
 * 页面通过 window.Android 桥接对象调用。
 */
public class MainActivity extends Activity {

    private static final String TAG = "GiteePro";
    private static final String START_URL = "file:///android_asset/index.html";
    private static final String PREF = "gitee_auth";
    private static final String UA = "Mozilla/5.0 (Linux; Android 10; GiteePro/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

    private WebView webView;
    private ExecutorService executor;
    private Handler mainHandler;
    private SharedPreferences prefs;

    private volatile String cookie = "";
    private volatile String csrf = "";
    private volatile String accessToken = "";
    private volatile String pendingCb = "";

    // 内嵌 Gitee 登录页
    private WebView loginWebView;
    private View loginLayer;
    private String pendingLoginCb = "";
    private final Object loginLock = new Object();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        executor = Executors.newFixedThreadPool(3);
        mainHandler = new Handler(Looper.getMainLooper());
        prefs = getSharedPreferences(PREF, MODE_PRIVATE);
        cookie = prefs.getString("cookie", "");
        csrf = prefs.getString("csrf", "");
        accessToken = prefs.getString("token", "");

        applyStatusBar("dark".equals(getSharedPreferences("gitee_theme", MODE_PRIVATE).getString("theme", "")));

        ensureStoragePermission();

        webView = (WebView) findViewById(R.id.webview);
        setupWebView();
        webView.loadUrl(START_URL);

        initLoginWebView();
    }

    @Override
    protected void onDestroy() {
        if (executor != null) {
            executor.shutdown();
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        if (loginWebView != null) {
            loginWebView.destroy();
            loginWebView = null;
        }
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        if (loginWebView != null) loginWebView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (loginWebView != null) loginWebView.onResume();
    }

    @Override
    public void onBackPressed() {
        if (loginLayer != null && loginLayer.getVisibility() == View.VISIBLE) {
            cancelLogin();
            return;
        }
        callJs("window.__onBack && window.__onBack();");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != 1001) return;
        final String cb = pendingCb;
        pendingCb = "";
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            callback(cb, jsonObjError("cancelled"));
            return;
        }
        final Uri uri = data.getData();
        runAsync(new Runnable() {
            public void run() {
                JSONObject o = new JSONObject();
                try {
                    String name = queryDisplayName(uri);
                    byte[] bytes = readAll(getContentResolver().openInputStream(uri));
                    o.put("ok", true);
                    o.put("name", name);
                    o.put("size", bytes.length);
                    o.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                } catch (Throwable t) {
                    try {
                        o.put("ok", false);
                        o.put("error", String.valueOf(t.getMessage()));
                    } catch (Exception ignored) {}
                }
                callback(cb, o);
            }
        });
    }

    // ==================== WebView ====================

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        try {
            s.setAllowFileAccessFromFileURLs(true);
            s.setAllowUniversalAccessFromFileURLs(true);
        } catch (Throwable ignored) {}
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setBackgroundColor(0xFFF5F6F8);
        webView.addJavascriptInterface(new NativeBridge(), "Android");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    if (!url.contains("gitee.com")) {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        } catch (Throwable ignored) {}
                        return true;
                    }
                }
                return false;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());
    }

    private void callJs(final String js) {
        mainHandler.post(new Runnable() {
            public void run() {
                if (webView != null) {
                    try {
                        webView.evaluateJavascript(js, null);
                    } catch (Throwable ignored) {}
                }
            }
        });
    }

    private void callback(String cb, JSONObject data) {
        callJs("window.__giteeCb(" + JSONObject.quote(cb) + ", " + data.toString() + ");");
    }

    private void runAsync(Runnable r) {
        executor.execute(r);
    }

    // ==================== 工具 ====================

    private void ensureStoragePermission() {
        if (Build.VERSION.SDK_INT >= 23) {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                        Manifest.permission.WRITE_EXTERNAL_STORAGE,
                        Manifest.permission.READ_EXTERNAL_STORAGE
                }, 100);
            }
        }
    }

    private void savePrefs() {
        prefs.edit().putString("cookie", cookie)
                .putString("csrf", csrf)
                .putString("token", accessToken).apply();
    }

    private void applyStatusBar(final boolean dark) {
        runOnUiThread(new Runnable() {
            public void run() {
                try {
                    if (Build.VERSION.SDK_INT >= 21) {
                        getWindow().setStatusBarColor(dark ? 0xFF1C2128 : 0xFFFFFFFF);
                        try { getWindow().setNavigationBarColor(dark ? 0xFF14181D : 0xFFFFFFFF); } catch (Throwable ignored) {}
                    }
                    int flags = getWindow().getDecorView().getSystemUiVisibility();
                    if (Build.VERSION.SDK_INT >= 23) {
                        flags = dark ? (flags & ~0x2000) : (flags | 0x2000);
                    }
                    if (Build.VERSION.SDK_INT >= 26) {
                        flags = dark ? (flags & ~0x10) : (flags | 0x10);
                    }
                    getWindow().getDecorView().setSystemUiVisibility(flags);
                } catch (Throwable ignored) {}
            }
        });
    }

    private String nz(String s) {
        return s == null ? "" : s;
    }

    private String urlenc(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (Throwable t) {
            return s;
        }
    }

    private String authUrl(String url) {
        if (accessToken.length() > 0 && url.indexOf("access_token") < 0) {
            return url + (url.indexOf('?') >= 0 ? "&" : "?") + "access_token=" + urlenc(accessToken);
        }
        return url;
    }

    private JSONObject jsonObjError(String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", msg);
        } catch (Exception ignored) {}
        return o;
    }

    private String readText(InputStream is) {
        if (is == null) return "";
        try {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            return bos.toString("UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    private byte[] readAll(InputStream is) throws Exception {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        is.close();
        return bos.toByteArray();
    }

    private String sanitize(String name) {
        if (name == null) name = "file";
        name = name.replace('\\', '/');
        int i = name.lastIndexOf('/');
        if (i >= 0) name = name.substring(i + 1);
        name = name.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (name.length() == 0) name = "file";
        return name;
    }

    private File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int n = 1; n < 1000; n++) {
            f = new File(dir, base + "(" + n + ")" + ext);
            if (!f.exists()) return f;
        }
        return f;
    }

    private String queryDisplayName(Uri uri) {
        String name = null;
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0) name = c.getString(i);
                if (name == null || name.length() == 0) {
                    int j = c.getColumnIndex("_display_name");
                    if (j >= 0) name = c.getString(j);
                }
            }
        } catch (Throwable ignored) {
        } finally {
            if (c != null) {
                try {
                    c.close();
                } catch (Throwable ignored) {}
            }
        }
        if (name == null || name.length() == 0) name = "file";
        return name;
    }

    private String extractMeta(String html, String metaName) {
        int from = 0;
        while (true) {
            int i = html.indexOf("<meta", from);
            if (i < 0) return null;
            int j = html.indexOf('>', i);
            if (j < 0) return null;
            String tag = html.substring(i, j + 1);
            if (tag.contains(metaName)) {
                int c = tag.indexOf("content=");
                if (c >= 0) {
                    int q1 = tag.indexOf('"', c + 8);
                    int q2 = tag.indexOf('\'', c + 8);
                    char quote;
                    int start;
                    if (q1 >= 0 && (q2 < 0 || q1 < q2)) {
                        quote = '"';
                        start = q1 + 1;
                    } else {
                        quote = '\'';
                        start = q2 + 1;
                    }
                    int end = tag.indexOf(quote, start);
                    if (end > start) return tag.substring(start, end);
                }
            }
            from = j + 1;
        }
    }

    // ==================== 网络 ====================

    private JSONObject httpJson(String method, String url, String body) {
        return httpJsonWithCookie(method, url, body, cookie);
    }

    private JSONObject httpJsonWithCookie(String method, String url, String body, String cookieVal) {
        JSONObject o = new JSONObject();
        int status = -1;
        String text = "";
        HttpURLConnection conn = null;
        try {
            URL u = new URL(authUrl(url));
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(40000);
            conn.setRequestMethod(method);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Accept", "application/json, text/plain, */*");
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            conn.setRequestProperty("Referer", "https://gitee.com/");
            String ck = cookieVal == null ? "" : cookieVal;
            if (ck.length() > 0) conn.setRequestProperty("Cookie", ck);
            if (csrf.length() > 0 && !"GET".equalsIgnoreCase(method)) {
                conn.setRequestProperty("X-CSRF-Token", csrf);
            }
            if (body != null && body.length() > 0) {
                byte[] data = body.getBytes("UTF-8");
                conn.setRequestProperty("Content-Type", "application/json;charset=UTF-8");
                conn.setDoOutput(true);
                OutputStream os = conn.getOutputStream();
                os.write(data);
                os.flush();
                os.close();
            }
            status = conn.getResponseCode();
            InputStream is = (status >= 200 && status < 400) ? conn.getInputStream() : conn.getErrorStream();
            text = readText(is);
        } catch (Throwable t) {
            try {
                o.put("error", String.valueOf(t.getMessage()));
            } catch (Exception ignored) {}
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Throwable ignored) {}
            }
        }
        try {
            o.put("status", status);
        } catch (Exception ignored) {}
        try {
            o.put("body", text == null ? "" : text);
        } catch (Exception ignored) {}
        return o;
    }

    private String doFetchCsrf() {
        HttpURLConnection c = null;
        try {
            URL u = new URL("https://gitee.com/");
            c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", UA);
            if (cookie.length() > 0) c.setRequestProperty("Cookie", cookie);
            String html = readText(c.getInputStream());
            String t = extractMeta(html, "csrf-token");
            if (t != null && t.length() > 0) {
                csrf = t;
                savePrefs();
            }
            return t == null ? "" : t;
        } catch (Throwable t) {
            return "";
        } finally {
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Throwable ignored) {}
            }
        }
    }

    private String doDownload(String url, String filename) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "GiteePro");
        if (!dir.exists()) dir.mkdirs();
        File out = unique(dir, sanitize(filename));
        HttpURLConnection c = null;
        try {
            URL u = new URL(authUrl(url));
            c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(15000);
            c.setReadTimeout(60000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", UA);
            if (cookie.length() > 0) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            if (code < 200 || code >= 300) {
                throw new Exception("HTTP " + code + " · " + readErr(c));
            }
            InputStream is = c.getInputStream();
            FileOutputStream fos = new FileOutputStream(out);
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) fos.write(buf, 0, n);
            fos.close();
            is.close();
            return out.getAbsolutePath();
        } finally {
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Throwable ignored) {}
            }
        }
    }

    private String readErr(HttpURLConnection c) {
        try {
            InputStream es = c.getErrorStream();
            if (es == null) return "";
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[1024];
            int n;
            while ((n = es.read(buf)) > 0) bos.write(buf, 0, n);
            es.close();
            String s = new String(bos.toByteArray(), "UTF-8");
            if (s.length() > 300) s = s.substring(0, 300) + "…";
            return s;
        } catch (Throwable t) {
            return "";
        }
    }

    private String doSaveBase64(String data, String filename) throws Exception {
        byte[] bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT);
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "GiteePro");
        if (!dir.exists()) dir.mkdirs();
        File out = unique(dir, sanitize(filename));
        FileOutputStream fos = new FileOutputStream(out);
        fos.write(bytes);
        fos.close();
        return out.getAbsolutePath();
    }

    // ==================== 内嵌 Gitee 登录页 ====================

    @SuppressLint("SetJavaScriptEnabled")
    private void initLoginWebView() {
        loginLayer = findViewById(R.id.login_layer);
        loginWebView = (WebView) findViewById(R.id.login_webview);
        WebSettings ws = loginWebView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setUserAgentString(UA);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        loginWebView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                handleLoginPage(url);
            }
        });
        View cancel = findViewById(R.id.login_cancel);
        if (cancel != null) {
            cancel.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    cancelLogin();
                }
            });
        }
        View done = findViewById(R.id.login_done);
        if (done != null) {
            done.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    finishLogin();
                }
            });
        }
    }

    private void startLoginPage(String cb) {
        pendingLoginCb = cb;
        // 清空旧登录态，避免验证时误用过期令牌/会话
        cookie = "";
        csrf = "";
        accessToken = "";
        savePrefs();
        try {
            CookieManager cm = CookieManager.getInstance();
            if (Build.VERSION.SDK_INT >= 21) {
                cm.removeAllCookies(null);
            } else {
                cm.removeAllCookie();
            }
        } catch (Throwable ignored) {}
        if (loginLayer != null) loginLayer.setVisibility(View.VISIBLE);
        if (loginWebView != null) loginWebView.loadUrl("https://gitee.com/login");
    }

    private void handleLoginPage(String url) {
        if (loginLayer == null || loginLayer.getVisibility() != View.VISIBLE) return;
        verifyLoginCookie();
        // Cookie 写入 CookieManager 可能有延迟，稍后再查一次
        mainHandler.postDelayed(new Runnable() {
            public void run() {
                if (loginLayer != null && loginLayer.getVisibility() == View.VISIBLE) {
                    verifyLoginCookie();
                }
            }
        }, 1500);
    }

    private void verifyLoginCookie() {
        final String cookieStr = getWebViewCookie();
        runAsync(new Runnable() {
            public void run() {
                try {
                    JSONObject r = httpJsonWithCookie("GET", "https://gitee.com/api/v5/user", "", cookieStr);
                    int status = r.optInt("status", -1);
                    String body = r.optString("body", "");
                    JSONObject user = null;
                    try { user = new JSONObject(body); } catch (Exception ignored) {}
                    if (status >= 200 && status < 300 && user != null && user.optString("login", "").length() > 0) {
                        synchronized (loginLock) {
                            if (pendingLoginCb == null || pendingLoginCb.length() == 0) return;
                            cookie = cookieStr;
                            csrf = extractCsrfFromCookie(cookieStr);
                            accessToken = "";
                            savePrefs();
                            String cb = pendingLoginCb;
                            pendingLoginCb = "";
                            JSONObject o = new JSONObject();
                            try {
                                o.put("ok", true);
                                o.put("user", user);
                            } catch (Exception ignored) {}
                            mainHandler.post(new Runnable() {
                                public void run() {
                                    hideLoginLayer();
                                }
                            });
                            callback(cb, o);
                        }
                    }
                } catch (Throwable ignored) {}
            }
        });
    }

    private void cancelLogin() {
        if (loginLayer != null && loginLayer.getVisibility() == View.VISIBLE) {
            loginLayer.setVisibility(View.GONE);
        }
        String cb = pendingLoginCb;
        pendingLoginCb = "";
        if (cb != null && cb.length() > 0) {
            callback(cb, jsonObjError("cancelled"));
        }
    }

    private void finishLogin() {
        if (loginLayer == null || loginLayer.getVisibility() != View.VISIBLE) return;
        verifyLoginCookie();
        mainHandler.postDelayed(new Runnable() {
            public void run() {
                if (loginLayer != null && loginLayer.getVisibility() == View.VISIBLE) {
                    Toast.makeText(MainActivity.this, "尚未登录成功，请先完成登录后再点完成", Toast.LENGTH_SHORT).show();
                }
            }
        }, 2500);
    }

    private void hideLoginLayer() {
        if (loginLayer != null) loginLayer.setVisibility(View.GONE);
    }

    private String getWebViewCookie() {
        try {
            return CookieManager.getInstance().getCookie("https://gitee.com/");
        } catch (Throwable t) {
            return "";
        }
    }

    private String extractCsrfFromCookie(String c) {
        if (c == null) return "";
        String[] parts = c.split(";");
        for (String part : parts) {
            String t = part.trim();
            if (t.startsWith("csrf_token=")) {
                String v = t.substring("csrf_token=".length());
                try {
                    return URLDecoder.decode(v, "UTF-8");
                } catch (Throwable e) {
                    return v;
                }
            }
        }
        return "";
    }

    // ==================== JS 桥 ====================

    private class NativeBridge {

        @JavascriptInterface
        public String getVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Throwable t) {
                return "1.0";
            }
        }

        @JavascriptInterface
        public void saveAuth(String cookieStr, String csrfStr, String tokenStr) {
            cookie = nz(cookieStr);
            csrf = nz(csrfStr);
            accessToken = nz(tokenStr);
            savePrefs();
        }

        @JavascriptInterface
        public String loadAuth() {
            JSONObject o = new JSONObject();
            try {
                o.put("cookie", cookie);
                o.put("csrf", csrf);
                o.put("token", accessToken);
            } catch (Exception ignored) {}
            return o.toString();
        }

        @JavascriptInterface
        public void saveTheme(final String theme) {
            getSharedPreferences("gitee_theme", MODE_PRIVATE).edit().putString("theme", theme == null ? "" : theme).apply();
        }

        @JavascriptInterface
        public String loadTheme() {
            return getSharedPreferences("gitee_theme", MODE_PRIVATE).getString("theme", "");
        }

        @JavascriptInterface
        public void setStatusBar(final boolean dark) {
            applyStatusBar(dark);
        }

        @JavascriptInterface
        public void clearAuth() {
            cookie = "";
            csrf = "";
            accessToken = "";
            prefs.edit().clear().apply();
            try {
                CookieManager cm = CookieManager.getInstance();
                if (Build.VERSION.SDK_INT >= 21) {
                    cm.removeAllCookies(null);
                } else {
                    cm.removeAllCookie();
                }
            } catch (Throwable ignored) {}
        }

        @JavascriptInterface
        public void api(final String method, final String url, final String body, final String cb) {
            runAsync(new Runnable() {
                public void run() {
                    callback(cb, httpJson(method, url, body));
                }
            });
        }

        @JavascriptInterface
        public void fetchCsrf(final String cb) {
            runAsync(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        String t = doFetchCsrf();
                        o.put("ok", t != null && t.length() > 0);
                        o.put("csrf", t == null ? "" : t);
                    } catch (Throwable t2) {
                        try {
                            o.put("ok", false);
                            o.put("csrf", "");
                        } catch (Exception ignored) {}
                    }
                    callback(cb, o);
                }
            });
        }

        @JavascriptInterface
        public void openLoginPage(final String cb) {
            runOnUiThread(new Runnable() {
                public void run() {
                    startLoginPage(cb);
                }
            });
        }

        @JavascriptInterface
        public void downloadFile(final String url, final String filename, final String cb) {
            runAsync(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        String path = doDownload(url, filename);
                        o.put("ok", true);
                        o.put("path", path == null ? "" : path);
                    } catch (Throwable t) {
                        try {
                            o.put("ok", false);
                            o.put("error", String.valueOf(t.getMessage()));
                        } catch (Exception ignored) {}
                    }
                    callback(cb, o);
                }
            });
        }

        @JavascriptInterface
        public void saveBase64(final String data, final String filename, final String cb) {
            runAsync(new Runnable() {
                public void run() {
                    JSONObject o = new JSONObject();
                    try {
                        String path = doSaveBase64(data, filename);
                        o.put("ok", true);
                        o.put("path", path == null ? "" : path);
                    } catch (Throwable t) {
                        try {
                            o.put("ok", false);
                            o.put("error", String.valueOf(t.getMessage()));
                        } catch (Exception ignored) {}
                    }
                    callback(cb, o);
                }
            });
        }

        @JavascriptInterface
        public void pickFile(String cb) {
            pendingCb = cb;
            try {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                startActivityForResult(i, 1001);
            } catch (Throwable t) {
                pendingCb = "";
                toast("无法打开文件选择器");
            }
        }

        @JavascriptInterface
        public void openFile(String path) {
            try {
                Uri uri = Uri.parse("content://com.jfmod.GiteePro.provider/file?path=" + Uri.encode(path));
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "*/*");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(i, "打开文件"));
            } catch (Throwable t) {
                toast("无法打开文件");
            }
        }

        @JavascriptInterface
        public void openUrl(String url) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (Throwable t) {
                toast("无法打开链接");
            }
        }

        @JavascriptInterface
        public void copyText(final String text) {
            runOnUiThread(new Runnable() {
                public void run() {
                    try {
                        if (Build.VERSION.SDK_INT >= 11) {
                            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            cm.setPrimaryClip(android.content.ClipData.newPlainText("text", text));
                        } else {
                            @SuppressWarnings("deprecation")
                            android.text.ClipboardManager cm = (android.text.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                            cm.setText(text);
                        }
                        toast("已复制");
                    } catch (Throwable ignored) {}
                }
            });
        }

        @JavascriptInterface
        public void toast(final String msg) {
            runOnUiThread(new Runnable() {
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
