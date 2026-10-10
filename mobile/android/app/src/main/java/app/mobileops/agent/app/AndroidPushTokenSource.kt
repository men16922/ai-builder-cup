package app.mobileops.agent.app

import android.content.Context
import app.mobileops.agent.FirebaseConfiguration
import app.mobileops.agent.PushTokenSource
import app.mobileops.agent.readMobileConfiguration
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.tasks.await

/** Process-wide token change signal from the messaging service. Carries no token. */
internal object PushTokenChanges {
    private val listeners = CopyOnWriteArraySet<() -> Unit>()
    fun subscribe(listener: () -> Unit): AutoCloseable { listeners += listener; return AutoCloseable { listeners -= listener } }
    fun publish() = listeners.forEach { it() }
}

/** FCM needs the default app; it is created only after an explicit enable or for an incoming message,
 * from the packaged public configuration, with data collection off. Sign-in keeps its own named apps. */
internal object PushFirebase {
    fun app(context: Context, configuration: FirebaseConfiguration): FirebaseApp = synchronized(this) {
        FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME } ?: FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setProjectId(configuration.projectId).setApiKey(configuration.apiKey).setApplicationId(configuration.appId)
            // The Firebase Android app ID embeds the project number, which is the FCM sender ID.
            .setGcmSenderId(configuration.appId.split(":")[1]).build())!!.also { it.setDataCollectionDefaultEnabled(false) }
    }
    fun packaged(context: Context): FirebaseConfiguration? = try {
        val file = "mobileops-agent.json"
        if (context.assets.list("")?.contains(file) != true) null
        else readMobileConfiguration(context.assets.open(file).use { input -> String(input.readBytes(32769).also { require(it.size <= 32768) }, Charsets.UTF_8) })?.firebase
    } catch (_: Exception) { null }
    private fun java.io.InputStream.readBytes(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream(); val chunk = ByteArray(4096)
        while (output.size() < limit) { val count = read(chunk); if (count < 0) break; output.write(chunk, 0, count) }
        return output.toByteArray()
    }
}

/** Constructed only by MobileNotifications after explicit enable. close() stops auto registration and
 * deletes the local FCM registration without waiting for the network; server retirement stays separate. */
class AndroidPushTokenSource(context: Context, configuration: FirebaseConfiguration) : PushTokenSource {
    private val messaging = PushFirebase.app(context.applicationContext, configuration).get(FirebaseMessaging::class.java).also { it.isAutoInitEnabled = true }
    @Volatile private var closed = false
    override suspend fun token(): String {
        check(!closed)
        val token = messaging.token.await()
        check(!closed)
        return token
    }
    override fun subscribe(changed: () -> Unit): AutoCloseable = PushTokenChanges.subscribe { if (!closed) changed() }
    override fun close() {
        if (closed) return
        closed = true
        try { messaging.isAutoInitEnabled = false; messaging.deleteToken() } catch (_: Exception) { /* Server retirement and expiry still apply. */ }
    }
}
