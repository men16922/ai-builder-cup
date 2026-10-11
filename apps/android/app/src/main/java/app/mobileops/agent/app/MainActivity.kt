package app.mobileops.agent.app

import android.os.Bundle
import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.mobileops.agent.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MobileViewModel : ViewModel() {
    val controller = MobileController()
    val language = MutableStateFlow("ko")
    val disconnected = MutableStateFlow(false)
    val mode = MutableStateFlow<String?>(null)
    val configuration = MutableStateFlow<MobileConfiguration?>(null)
    val configurationInvalid = MutableStateFlow(false)
    val liveState = MutableStateFlow(LiveAccessState())
    private var pushApplication: android.app.Application? = null
    // The FCM source is created only after an explicit enable in a configured server session.
    val notifications = MobileNotifications(viewModelScope, { _ -> AndroidPushTokenSource(pushApplication!!, configuration.value!!.firebase) })
    val notificationNavigation = NotificationNavigation(controller)
    val agent = MobileAgent(viewModelScope)
    private var fixture: FixtureApi? = null
    private var configured = false
    private var live: LiveAccess? = null
    private var signInJob: Job? = null
    private var signOutJob: Job? = null
    fun configure(context: Context) {
        if (configured) return
        configured = true
        try {
            val file = "mobileops-agent.json"
            val raw = if (context.assets.list("")?.contains(file) == true) context.assets.open(file).use { input ->
                val bytes = java.io.ByteArrayOutputStream(); val chunk = ByteArray(4096)
                while (true) { val count = input.read(chunk); if (count < 0) break; require(bytes.size() + count <= 32768); bytes.write(chunk, 0, count) }
                bytes.toString("UTF-8")
            } else null
            val config = readMobileConfiguration(raw); configuration.value = config
            if (config != null) {
                val application = context.applicationContext
                pushApplication = application as android.app.Application
                val access = LiveAccess(config, controller, { AndroidFirebaseIdentity(application, config.firebase) }, notifications, agent)
                live = access
                viewModelScope.launch { access.state.collect {
                    if (liveState.value.workspace != null && it.workspace == null) notificationNavigation.clear()
                    liveState.value = it
                } }
            }
        } catch (_: Exception) { configurationInvalid.value = true }
    }
    fun connect(edition: String) {
        leave(); mode.value = "synthetic"
        val api = FixtureApi.load(edition); fixture = api; disconnected.value = false
        controller.connect(api); launch { refresh() }
        agent.attach(FixtureAgentApi(), "synthetic")
    }
    fun signIn(activity: Activity, key: String) {
        val access = live ?: return
        if (access.state.value.busy || signOutJob?.isActive == true) return
        if (controller.state.value.scope != null) notificationNavigation.clear()
        fixture = null; disconnected.value = false; mode.value = "server"
        signInJob = viewModelScope.launch { access.signIn(key) { (it as AndroidFirebaseIdentity).signIn(activity) } }
    }
    fun leave() {
        signInJob?.cancel(); signInJob = null; notificationNavigation.clear()
        fixture = null; disconnected.value = false; mode.value = null; controller.connect(null); agent.detach()
        if (signOutJob?.isActive != true) signOutJob = viewModelScope.launch { live?.signOut() }
    }
    fun enableNotifications() { viewModelScope.launch {
        notifications.enableOrRetry()
        if (notifications.state.value.failure == Failure.SIGN_IN) { notificationNavigation.clear(); live?.authenticationFailed() }
    } }
    fun disableNotifications() { viewModelScope.launch { notifications.disable() } }
    fun receiveNotification(raw: String) { notificationNavigation.receive(raw) }
    fun openNotification() {
        if (mode.value != "server") return
        viewModelScope.launch {
            notificationNavigation.open()
            if (controller.state.value.failure == Failure.SIGN_IN) { notificationNavigation.clear(); live?.authenticationFailed() }
        }
    }
    fun toggleNetwork() { fixture?.let { it.offline = !it.offline; disconnected.value = it.offline }; launch { refresh() } }
    fun launch(action: suspend MobileController.() -> Unit) { viewModelScope.launch {
        controller.action()
        if (mode.value == "server" && controller.state.value.failure == Failure.SIGN_IN) { notificationNavigation.clear(); live?.authenticationFailed() }
    } }
    fun resume() {
        if (controller.state.value.scope != null) launch { state.value.selectedId?.let { open(it) } ?: refresh() }
        if (mode.value == "server") agent.refresh()
        if (mode.value == "server") viewModelScope.launch {
            notifications.refresh()
            if (notifications.state.value.failure == Failure.SIGN_IN) { notificationNavigation.clear(); live?.authenticationFailed() }
        }
    }
    override fun onCleared() { notificationNavigation.clear(); agent.detach(); live?.leave(); controller.connect(null); super.onCleared() }
}
class MainActivity : ComponentActivity() {
    private val model: MobileViewModel by viewModels()
    private var notificationPermissionAsked = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); enableEdgeToEdge()
        model.configure(applicationContext)
        consumeNotification(intent)
        val preferences = getSharedPreferences("display", MODE_PRIVATE)
        // A saved choice wins; otherwise Korean devices get Korean and every other device gets English.
        model.language.value = preferences.getString("language", null) ?: if (java.util.Locale.getDefault().language == "ko") "ko" else "en"
        // Ask for the system notification permission only after the user enabled work notifications.
        val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
        lifecycleScope.launch { model.notifications.state.collect {
            if (it.enabled && android.os.Build.VERSION.SDK_INT >= 33 && !notificationPermissionAsked
                && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                notificationPermissionAsked = true; permission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
        } }
        setContent { MobileOpsApp(model, onSignIn = { key -> model.signIn(this, key) }) { language -> model.language.value = language; preferences.edit().putString("language", language).apply() } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); consumeNotification(intent) }
    private fun consumeNotification(intent: Intent?) {
        if (intent?.action != "app.mobileops.agent.OPEN_GCP_NOTIFICATION") return
        val raw = try { intent.getStringExtra("gcp_notification") } catch (_: Exception) { null }
        intent.removeExtra("gcp_notification")
        if (raw != null) model.receiveNotification(raw)
    }
    override fun onResume() { super.onResume(); model.resume() }
    override fun onStop() { model.controller.hideUntilRevalidated(); super.onStop() }
}
