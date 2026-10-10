package app.mobileops.agent

import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Optional SDK adapter. Construct only after explicit enable; token changes announce a fresh read.
 * close stops callbacks/SDK auto registration and must not block on network I/O. */
interface PushTokenSource {
    suspend fun token(): String
    fun subscribe(changed: () -> Unit): AutoCloseable
    fun close()
}
data class NotificationState(val supported: Boolean = false, val enabled: Boolean = false, val busy: Boolean = false,
    val uncertain: Boolean = false, val expiresAt: String? = null, val failure: Failure? = null, val cleanupUnknown: Boolean = false)

/** Captures IDs/API only, never a token. Local authority is already gone before finish runs. */
class NotificationRetirement internal constructor(private val api: MobileNotificationApi?, private val installationId: String,
    private val keys: List<String>, private val sourceStopped: Boolean) {
    suspend fun finish(): Boolean = withContext(NonCancellable) {
        var confirmed = sourceStopped
        try {
            withTimeout(2000) {
                for (key in keys) try { api!!.retireDevice(installationId, key) }
                catch (cancel: CancellationException) { throw cancel }
                catch (_: Exception) { confirmed = false }
            }
        } catch (_: Exception) { confirmed = false }
        confirmed
    }
    val requiresServerConfirmation get() = keys.isNotEmpty()
    val localCleanupUnconfirmed get() = !sourceStopped
}

/** UI-dispatcher coordinator. One connection/installation per signed-in session.
 * Source callbacks/foreground refresh may renew a confirmed registration, but NEVER retry an uncertain POST. */
class MobileNotifications(private val jobs: CoroutineScope, private val createSource: ((Scope) -> PushTokenSource)? = null,
    private val now: () -> Long = System::currentTimeMillis) {
    private data class Pending(val input: DeviceRegistration, val key: String)
    private class Connection(val scope: Scope, val sessionKey: String, val api: MobileNotificationApi?, val installation: String = UUID.randomUUID().toString()) {
        var source: PushTokenSource? = null; var subscription: AutoCloseable? = null
        var receipt: DeviceReceipt? = null; var confirmedKey: String? = null; var pending: Pending? = null
        var enabled = false; var working = false; var dirty = false; var tokenDigest: String? = null
    }
    private var active: Connection? = null
    private val mutable = MutableStateFlow(NotificationState())
    val state = mutable.asStateFlow()
    fun attach(api: MobileApi, sessionKey: String) {
        check(active == null); require(sessionKey.isNotBlank())
        active = Connection(api.scope, sessionKey, api as? MobileNotificationApi)
        mutable.value = NotificationState(supported = createSource != null && api is MobileNotificationApi)
    }
    fun detach(): NotificationRetirement {
        val old = active; active = null
        mutable.value = NotificationState()
        var stopped = true
        try { old?.subscription?.close() } catch (_: Exception) { stopped = false }
        try { old?.source?.close() } catch (_: Exception) { stopped = false }
        old?.subscription = null; old?.source = null; old?.enabled = false
        val keys = listOfNotNull(old?.confirmedKey, old?.pending?.key).distinct()
        return NotificationRetirement(old?.api, old?.installation ?: UUID.randomUUID().toString(), keys, stopped)
    }
    /** Used on forced auth loss/process teardown when server cleanup cannot be awaited. */
    fun abandon() {
        val retirement = detach()
        if (retirement.requiresServerConfirmation || retirement.localCleanupUnconfirmed) mutable.value = state.value.copy(cleanupUnknown = true)
    }
    suspend fun disable() {
        val old = active ?: return
        val retirement = detach()
        val next = Connection(old.scope, old.sessionKey, old.api); active = next
        mutable.value = NotificationState(supported = createSource != null && next.api != null, busy = true)
        val confirmed = retirement.finish()
        if (active === next) mutable.value = state.value.copy(busy = false, cleanupUnknown = !confirmed)
    }
    suspend fun enableOrRetry() {
        val current = active ?: return
        if (current.api == null || createSource == null || current.working || state.value.busy) return
        current.enabled = true
        update(current, retry = true)
    }
    suspend fun refresh() {
        val current = active ?: return
        if (current.enabled) update(current, retry = false)
    }
    private suspend fun update(current: Connection, retry: Boolean) {
        if (active !== current || !current.enabled) return
        if (current.working) { current.dirty = true; return }
        if (current.pending != null && !retry) return
        current.working = true; current.dirty = true
        mutable.value = state.value.copy(busy = true, failure = null)
        try {
            if (current.source == null) {
                if (!current.api!!.notificationsConfigured()) throw MobileFailure(Failure.UNAVAILABLE)
                if (active !== current || !current.enabled) return
                val source = createSource!!(current.scope); current.source = source
                current.subscription = source.subscribe { if (active === current && current.enabled) jobs.launch { update(current, retry = false) } }
            }
            do {
                current.dirty = false
                var pending = current.pending
                if (pending == null) {
                    val token = current.source!!.token()
                    if (active !== current || !current.enabled) return
                    val hash = MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).joinToString("") { "%02x".format(it) }
                    if (current.tokenDigest == hash && current.receipt?.let { time(it.expiresAt).toEpochMilli() > now() + 60000 } == true) continue
                    val input = DeviceRegistration(current.installation, current.receipt?.generation, token); input.validate()
                    pending = Pending(input, UUID.randomUUID().toString()); current.pending = pending
                }
                val receipt = current.api!!.registerDevice(pending.input, pending.key)
                if (active !== current || !current.enabled) return
                receipt.validate()
                if (!receipt.active || receipt.installationId != current.installation || time(receipt.expiresAt).toEpochMilli() <= now()) throw MobileFailure(Failure.INVALID_RESPONSE)
                current.tokenDigest = MessageDigest.getInstance("SHA-256").digest(pending.input.token.toByteArray()).joinToString("") { "%02x".format(it) }
                current.receipt = receipt; current.confirmedKey = pending.key; current.pending = null
                mutable.value = state.value.copy(enabled = true, uncertain = false, expiresAt = receipt.expiresAt, failure = null)
            } while (current.dirty && active === current && current.enabled)
        } catch (cancel: CancellationException) {
            if (active === current) mutable.value = state.value.copy(uncertain = current.pending != null)
            throw cancel
        } catch (error: Exception) {
            if (active === current) mutable.value = state.value.copy(enabled = false, uncertain = current.pending != null,
                failure = (error as? MobileFailure)?.reason ?: Failure.UNAVAILABLE)
        } finally {
            current.working = false
            if (active === current) mutable.value = state.value.copy(busy = false)
        }
    }
}

/** Intent reception does no HTTP or SDK work. The user chooses a workspace and explicitly opens it. */
class NotificationNavigation(private val controller: MobileController) {
    private var pending: GcpNotification? = null
    private var generation = 0L
    private val mutable = MutableStateFlow(false)
    val available = mutable.asStateFlow()
    fun receive(raw: String): Boolean {
        val parsed = try { GcpNotification.parse(raw) } catch (_: Exception) { return false }
        generation++; pending = parsed; mutable.value = true; return true
    }
    fun clear() { generation++; pending = null; mutable.value = false }
    suspend fun open() {
        val data = pending ?: return
        if (controller.state.value.scope == null || controller.state.value.busy) return
        val ticket = generation
        controller.openNotification(data)
        if (ticket == generation && controller.state.value.failure == null && controller.state.value.detail?.plan?.payload?.planId == data.planId) clear()
    }
}
