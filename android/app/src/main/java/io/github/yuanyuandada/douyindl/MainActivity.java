package io.github.yuanyuandada.douyindl;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/**
 * WebView 壳：页面逻辑在 assets/index.html。
 * 原生侧只负责两件事：代发 HTTP（绕开 WebView 的跨域限制）、把媒体流式写入系统下载目录。
 */
public class MainActivity extends Activity {

    private static final String PAGE_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private WebView web;
    private String pendingShare;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final AtomicLong jobSeq = new AtomicLong(0);
    private volatile String ttwidCache = "";

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(PAGE_UA); // 页面内 makeABogus 读 navigator.userAgent，必须与请求头一致
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (pendingShare != null) {
                    String json = JSONObject.quote(pendingShare);
                    view.evaluateJavascript("window.setShareText && window.setShareText(" + json + ")", null);
                    pendingShare = null;
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "Native");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
        pendingShare = getIntent().getStringExtra(Intent.EXTRA_TEXT);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && web != null) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) {
                String json = JSONObject.quote(text);
                web.evaluateJavascript("window.setShareText && window.setShareText(" + json + ")", null);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** 用魔数判断真实类型；返回 null 表示不是可保存的媒体 */
    static String sniffMime(byte[] b) {
        if (b.length > 8 && new String(b, 4, 4).equals("ftyp")) return "video/mp4";
        if (b.length > 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) return "image/jpeg";
        if (b.length > 3 && (b[0] & 0xFF) == 0x89 && (b[1] & 0xFF) == 0x50) return "image/png";
        if (b.length > 12 && new String(b, 0, 4).equals("RIFF") && new String(b, 8, 4).equals("WEBP")) return "image/webp";
        if (b.length > 3 && new String(b, 0, 3).equals("ID3")) return "audio/mpeg";
        if (b.length > 2 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xE0) == 0xE0) return "audio/mpeg";
        return null;
    }

    private void js(final String script) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(script, null);
            }
        });
    }

    class Bridge {

        /** 同步 GET（分享页 / 详情接口等小响应），返回 {"status":200,"body":"...","finalUrl":"..."} */
        @JavascriptInterface
        public String http(String url, String headersJson) {
            try {
                JSONObject h = new JSONObject(headersJson == null ? "{}" : headersJson);
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                for (Map.Entry<String, String> e : toMap(h).entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
                c.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9");
                if (c.getRequestProperty("User-Agent") == null) c.setRequestProperty("User-Agent", PAGE_UA);
                int status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                if (in != null) {
                    while ((n = in.read(buf)) > 0 && bos.size() < 8 * 1024 * 1024) bos.write(buf, 0, n);
                    in.close();
                }
                JSONObject out = new JSONObject();
                out.put("status", status);
                out.put("body", new String(bos.toByteArray(), "UTF-8"));
                out.put("finalUrl", c.getURL().toString());
                return out.toString();
            } catch (Exception e) {
                return errJson(e);
            }
        }

        /** 注册并缓存 ttwid Cookie（进程内只注册一次） */
        @JavascriptInterface
        public String ttwid() {
            if (!ttwidCache.isEmpty()) return ttwidCache;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL("https://ttwid.bytedance.com/ttwid/union/register/").openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(15000);
                c.setReadTimeout(15000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setRequestProperty("User-Agent", PAGE_UA);
                OutputStream os = c.getOutputStream();
                os.write("{\"region\":\"cn\",\"aid\":1768,\"needFid\":false,\"service\":\"www.ixigua.com\",\"mss_info\":{\"X-Bogus\":\"\",\"_signature\":\"\",\"bytegif\":\"\"}}".getBytes("UTF-8"));
                os.close();
                c.getResponseCode(); // 触发请求以拿到 Set-Cookie
                for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                    if (e.getKey() != null && "set-cookie".equalsIgnoreCase(e.getKey())) {
                        for (String v : e.getValue()) {
                            if (v.startsWith("ttwid=")) {
                                ttwidCache = v.substring(0, v.indexOf(';') > 0 ? v.indexOf(';') : v.length());
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            }
            return ttwidCache;
        }

        /**
         * 异步下载：立即返回任务 id，进度/结果经 window.__dlProgress / window.__dlDone 回调页面。
         * 文件写入系统"下载/douyin-dl/"目录（MediaStore，无需存储权限）。
         */
        @JavascriptInterface
        public String downloadStart(final String url, final String headersJson, final String fileName) {
            final long id = jobSeq.incrementAndGet();
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    doDownload(id, url, headersJson, fileName);
                }
            });
            try {
                return new JSONObject().put("id", id).toString();
            } catch (Exception e) {
                return "{\"id\":" + id + "}";
            }
        }

        private void doDownload(final long id, String url, String headersJson, String fileName) {
            OutputStream target = null;
            Uri rowUri = null;
            String pendingName = fileName;
            try {
                JSONObject h = new JSONObject(headersJson == null ? "{}" : headersJson);
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(60000);
                for (Map.Entry<String, String> e : toMap(h).entrySet()) c.setRequestProperty(e.getKey(), e.getValue());
                if (c.getRequestProperty("User-Agent") == null) c.setRequestProperty("User-Agent", PAGE_UA);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());

                InputStream in = c.getInputStream();
                long total = c.getContentLength();
                // 先读 16 字节做魔数校验，避免把风控页存成 mp4
                byte[] head = new byte[16];
                int got = 0;
                while (got < 16) {
                    int r = in.read(head, got, 16 - got);
                    if (r < 0) break;
                    got += r;
                }
                final String mime = sniffMime(head);
                if (mime == null) {
                    in.close();
                    throw new Exception("内容不是视频/图片（可能触发风控或链接失效）");
                }

                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, pendingName);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                if (Build.VERSION.SDK_INT >= 29) {
                    cv.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/douyin-dl");
                    cv.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    rowUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (rowUri == null) throw new Exception("无法创建下载文件");
                    target = getContentResolver().openOutputStream(rowUri);
                }

                long done = 0;
                long last = 0;
                target.write(head, 0, got);
                done += got;
                byte[] buf = new byte[32 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    target.write(buf, 0, n);
                    done += n;
                    if (System.currentTimeMillis() - last > 250) {
                        last = System.currentTimeMillis();
                        js("window.__dlProgress && window.__dlProgress(" + id + "," + done + "," + Math.max(total, 0) + ")");
                    }
                }
                target.flush();
                in.close();
                target.close();
                target = null;

                String realName = pendingName;
                if (rowUri != null && Build.VERSION.SDK_INT >= 29) {
                    ContentValues clear = new ContentValues();
                    clear.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(rowUri, clear, null, null);
                    android.database.Cursor cur = getContentResolver().query(rowUri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null);
                    if (cur != null) {
                        if (cur.moveToFirst()) realName = cur.getString(0);
                        cur.close();
                    }
                }
                JSONObject ok = new JSONObject();
                ok.put("ok", true);
                ok.put("name", realName);
                ok.put("size", done);
                js("window.__dlDone && window.__dlDone(" + id + "," + ok + ")");
            } catch (final Exception e) {
                try {
                    if (target != null) target.close();
                } catch (Exception ignored) {
                }
                if (rowUri != null) getContentResolver().delete(rowUri, null, null); // 清掉半截文件
                js("window.__dlDone && window.__dlDone(" + id + ",{\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "})");
            }
        }

        private Map<String, String> toMap(JSONObject o) {
            Map<String, String> m = new java.util.HashMap<>();
            java.util.Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                try {
                    m.put(k, o.getString(k));
                } catch (Exception ignored) {
                }
            }
            return m;
        }

        private String errJson(Exception e) {
            try {
                return new JSONObject().put("status", 0).put("error", String.valueOf(e.getMessage())).toString();
            } catch (Exception x) {
                return "{\"status\":0,\"error\":\"network error\"}";
            }
        }
    }
}
