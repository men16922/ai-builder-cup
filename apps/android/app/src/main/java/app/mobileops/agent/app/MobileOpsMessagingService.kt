package app.mobileops.agent.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import app.mobileops.agent.GcpNotification
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Receives only the strict data locator. The visible text is generic: no resource, owner, result or
 * URL. Tapping opens the existing explicit "open latest task" flow; nothing is reviewed or
 * executed.
 */
class MobileOpsMessagingService : FirebaseMessagingService() {
    override fun onCreate() {
        // Incoming messages may start a cold process; FCM needs the default app from the packaged
        // public configuration.
        PushFirebase.packaged(applicationContext)?.let { PushFirebase.app(applicationContext, it) }
        super.onCreate()
    }

    override fun onNewToken(token: String) {
        PushTokenChanges.publish()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val raw = JsonObject(message.data.mapValues { JsonPrimitive(it.value) }).toString()
        val notification =
            try {
                GcpNotification.parse(raw)
            } catch (_: Exception) {
                return
            }
        if (
            Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
        )
            return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL,
                getString(R.string.push_channel),
                NotificationManager.IMPORTANCE_DEFAULT,
            ),
        )
        val open =
            Intent(
                    this,
                    MainActivity::class.java,
                )
                .setAction("app.mobileops.agent.OPEN_GCP_NOTIFICATION")
                .putExtra("gcp_notification", raw)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending =
            PendingIntent.getActivity(
                this,
                notification.notificationId.hashCode(),
                open,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        manager.notify(
            notification.notificationId.hashCode(),
            android.app.Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.push_body))
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build(),
        )
    }

    private companion object {
        const val CHANNEL = "gcp-work"
    }
}
