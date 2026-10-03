package com.opus.tickets;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "RouterOs")
public class RouterOsPlugin extends Plugin {
    private final ExecutorService pool = Executors.newCachedThreadPool();

    @PluginMethod
    public void run(PluginCall call) {
        String host = call.getString("host", "");
        int port = call.getInt("port", 8728);
        String username = call.getString("username", "");
        String password = call.getString("password", "");
        JSArray commands = call.getArray("commands");
        if (host == null || host.isEmpty() || commands == null) {
            call.reject("Indiquez l'adresse du routeur sur le réseau.");
            return;
        }
        pool.execute(() -> {
            try {
                List<List<String>> parsed = new ArrayList<>();
                for (int i = 0; i < commands.length(); i += 1) {
                    JSONArray sentence = commands.getJSONArray(i);
                    List<String> words = new ArrayList<>();
                    for (int j = 0; j < sentence.length(); j += 1) words.add(sentence.getString(j));
                    parsed.add(words);
                }
                int timeout = call.getInt("timeout", 15000);
                if (timeout < 1000 || timeout > 20000) timeout = 15000;
                List<List<Map<String, String>>> results = RouterOsClient.run(host, port, username, password, parsed, timeout);
                JSArray payload = new JSArray();
                for (List<Map<String, String>> rows : results) {
                    JSObject item = new JSObject();
                    JSArray rowArray = new JSArray();
                    for (Map<String, String> row : rows) {
                        JSONObject record = new JSONObject();
                        for (Map.Entry<String, String> entry : row.entrySet()) {
                            record.put(entry.getKey(), entry.getValue());
                        }
                        rowArray.put(record);
                    }
                    item.put("rows", rowArray);
                    payload.put(item);
                }
                JSObject response = new JSObject();
                response.put("results", payload);
                if (getActivity() == null) call.resolve(response);
                else getActivity().runOnUiThread(() -> call.resolve(response));
            } catch (Exception error) {
                String message = error.getMessage() == null
                    ? "Impossible de joindre le routeur."
                    : error.getMessage();
                if (getActivity() == null) call.reject(message);
                else getActivity().runOnUiThread(() -> call.reject(message));
            }
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) {
            call.reject("Adresse de mise à jour invalide.");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        if (getActivity() == null) {
            call.reject("Impossible d'ouvrir le lien.");
            return;
        }
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void googleLogin(PluginCall call) {
        String clientId = call.getString("clientId", "");
        String challenge = call.getString("challenge", "");
        String state = call.getString("state", "tickets");
        if (clientId == null || clientId.isEmpty() || challenge == null || challenge.isEmpty() || getActivity() == null) {
            call.reject("La liaison Gmail n'est pas encore ouverte.");
            return;
        }
        call.save();
        String redirect = "http://127.0.0.1:4173/oauth.html";
        Uri auth = Uri.parse("https://accounts.google.com/o/oauth2/v2/auth").buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", redirect)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email")
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("access_type", "offline")
            .appendQueryParameter("prompt", "consent")
            .appendQueryParameter("state", state)
            .build();
        getActivity().runOnUiThread(() -> openGoogleLogin(call, auth, redirect, state));
    }

    private void openGoogleLogin(PluginCall call, Uri auth, String redirect, String state) {
        if (getActivity() == null) {
            call.reject("La liaison Gmail n'est pas encore ouverte.");
            return;
        }
        AtomicBoolean done = new AtomicBoolean(false);
        WebView webView = new WebView(getActivity());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", "").replace("Version/4.0 ", ""));
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 21) cookies.setAcceptThirdPartyCookies(webView, true);
        android.app.Dialog dialog = new android.app.Dialog(getActivity(), android.R.style.Theme_DeviceDefault_Light_NoActionBar);
        LinearLayout root = new LinearLayout(getActivity());
        root.setOrientation(LinearLayout.VERTICAL);
        Button close = new Button(getActivity());
        close.setText("Fermer");
        root.addView(close, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        root.addView(webView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        dialog.setContentView(root);
        dialog.setOnDismissListener(unused -> {
            webView.post(() -> {
                webView.stopLoading();
                webView.destroy();
            });
            if (done.compareAndSet(false, true)) call.reject("La liaison Gmail a été annulée.");
        });
        close.setOnClickListener(unused -> dialog.dismiss());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request != null && catchGoogleReturn(request.getUrl(), call, dialog, done, redirect, state);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return catchGoogleReturn(Uri.parse(url), call, dialog, done, redirect, state);
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                catchGoogleReturn(Uri.parse(url), call, dialog, done, redirect, state);
            }
        });
        dialog.show();
        webView.loadUrl(auth.toString());
    }

    private boolean catchGoogleReturn(Uri uri, PluginCall call, android.app.Dialog dialog, AtomicBoolean done, String redirect, String state) {
        if (uri == null || uri.getHost() == null) return false;
        if (!"127.0.0.1".equals(uri.getHost()) && !"localhost".equals(uri.getHost())) return false;
        String code = uri.getQueryParameter("code");
        String error = uri.getQueryParameter("error");
        String gotState = uri.getQueryParameter("state");
        if (!done.compareAndSet(false, true)) return true;
        dialog.dismiss();
        if (error != null || code == null || code.isEmpty() || !state.equals(gotState == null ? "" : gotState)) {
            call.reject("La liaison Gmail a été annulée.");
            return true;
        }
        JSObject out = new JSObject();
        out.put("code", code);
        out.put("redirect", redirect);
        call.resolve(out);
        return true;
    }

    @PluginMethod
    public void shareImage(PluginCall call) {
        String base64 = call.getString("base64", "");
        String text = call.getString("text", "");
        String name = call.getString("name", "ticket-qr.png");
        if (base64 == null || base64.isEmpty() || getActivity() == null || getContext() == null) {
            call.reject("Impossible de partager le QR.");
            return;
        }
        try {
            String raw = base64;
            int comma = raw.indexOf(',');
            if (raw.startsWith("data:") && comma >= 0) raw = raw.substring(comma + 1);
            byte[] bytes = android.util.Base64.decode(raw, android.util.Base64.DEFAULT);
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Impossible de partager le QR.");
                return;
            }
            String safeName = (name == null || name.isEmpty()) ? "ticket-qr.png" : name.replaceAll("[^A-Za-z0-9._-]", "_");
            File file = new File(dir, safeName);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/png");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Partager le ticket"));
            call.resolve();
        } catch (Exception error) {
            call.reject("Impossible de partager le QR.");
        }
    }

    @PluginMethod
    public void saveTextFile(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.isEmpty() || getActivity() == null || getContext() == null) {
            call.reject("Impossible d'enregistrer la copie.");
            return;
        }
        try {
            File dir = new File(getContext().getCacheDir(), "backup");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("Impossible d'enregistrer la copie.");
                return;
            }
            File file = new File(dir, "Tickets-sauvegarde.json");
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/json");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, "Enregistrer la copie"));
            call.resolve();
        } catch (Exception error) {
            call.reject("Impossible d'enregistrer la copie.");
        }
    }
}
