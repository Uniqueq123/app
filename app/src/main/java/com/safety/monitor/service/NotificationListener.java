package com.safety.monitor.service;

import android.app.Notification;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import com.safety.monitor.config.AppConfig;
import com.safety.monitor.data.NotificationData;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class NotificationListener extends NotificationListenerService {
    private static final String TAG = "NotificationListener";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            // Skip system notifications if desired
            if (isSystemPackage(sbn.getPackageName())) {
                return;
            }

            Notification notification = sbn.getNotification();
            if (notification == null) return;

            CharSequence title = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
            
            if (title == null && text == null) return;

            NotificationData data = new NotificationData();
            data.setPackageName(sbn.getPackageName());
            data.setTitle(title != null ? title.toString() : "");
            data.setText(text != null ? text.toString() : "");
            data.setTimestamp(sbn.getPostTime());
            data.setAppName(getAppName(sbn.getPackageName()));

            sendToServer(data);
            
        } catch (Exception e) {
            Log.e(TAG, "Error processing notification", e);
        }
    }

    private boolean isSystemPackage(String packageName) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(packageName, 0);
            return (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private String getAppName(String packageName) {
        try {
            PackageManager pm = getPackageManager();
            ApplicationInfo ai = pm.getApplicationInfo(packageName, 0);
            return pm.getApplicationLabel(ai).toString();
        } catch (PackageManager.NameNotFoundException e) {
            return packageName;
        }
    }

    private void sendToServer(NotificationData data) {
        new Thread(() -> {
            try {
                URL url = new URL(AppConfig.SERVER_URL + "/api/notifications");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("X-API-Key", "safety-monitor-123");
                conn.setDoOutput(true);

                JSONObject jsonData = new JSONObject();
                jsonData.put("packageName", data.getPackageName());
                jsonData.put("appName", data.getAppName());
                jsonData.put("title", data.getTitle());
                jsonData.put("text", data.getText());
                jsonData.put("timestamp", data.getTimestamp());
                jsonData.put("source", "android");

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(jsonData.toString().getBytes("UTF-8"));
                }

                int responseCode = conn.getResponseCode();
                Log.d(TAG, "Server response: " + responseCode);
            } catch (Exception e) {
                Log.e(TAG, "Error sending to server", e);
            }
        }).start();
    }
} 