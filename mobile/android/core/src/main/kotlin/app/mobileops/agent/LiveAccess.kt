package app.mobileops.agent

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class LiveAccessState(val workspace: WorkspaceConfiguration? = null, val busy: Boolean = false, val failure: Failure? = null, val cleanupUnknown: Boolean = false)
/** Explicit account selection only. Creating/reading this coordinator cannot initialize Firebase or call HTTP. */
class LiveAccess(private val config: MobileConfiguration, private val controller: MobileController,
    private val createIdentity: () -> SessionIdentity,
    private val notifications: MobileNotifications? = null,
    private val agent: MobileAgent? = null,
    private val createClient: (String, Scope, IdentityPort) -> MobileApi = { origin, scope, identity -> GcpMobileClient(origin, scope, identity) }) {
    private val mutable = MutableStateFlow(LiveAccessState())
    val state = mutable.asStateFlow()
    private var generation = 0L
    private var identity: SessionIdentity? = null
    private var subscription: AutoCloseable? = null
    private var bound: IdentitySession? = null
    private var outstandingRetirements = 0
    private var unknownRetirement = false
    private fun cleanupUnconfirmed() = unknownRetirement || outstandingRetirements > 0
    init { config.validate() }
    fun leave() {
        agent?.detach()
        notifications?.abandon()
        unknownRetirement = unknownRetirement || notifications?.state?.value?.cleanupUnknown == true
        generation++; controller.connect(null); bound = null
        val oldSubscription = subscription; subscription = null
        val old = identity; identity = null
        mutable.value = LiveAccessState(cleanupUnknown = cleanupUnconfirmed())
        // Clear local authority first. One failed SDK cleanup must not skip the other.
        try { oldSubscription?.close() } catch (_: Exception) { /* No raw SDK errors in state. */ }
        closeRetired(old)
    }
    private fun closeRetired(old: SessionIdentity?) { try { old?.close() } catch (_: Exception) { /* Already unbound. */ } }
    /** Normal sign-out fences registration requests while the old identity still exists.
     * Local views/listeners are removed immediately; cleanup has a fixed two-second budget. */
    suspend fun signOut(): Boolean {
        agent?.detach()
        val retirement = notifications?.detach()
        outstandingRetirements++
        val ticket = ++generation; controller.connect(null); bound = null
        val oldSubscription = subscription; subscription = null
        val old = identity; identity = null
        mutable.value = LiveAccessState(busy = true, cleanupUnknown = cleanupUnconfirmed())
        try { oldSubscription?.close() } catch (_: Exception) { /* Continue server cleanup and identity close. */ }
        var confirmed = false
        try { confirmed = retirement?.finish() ?: true }
        finally {
            closeRetired(old)
            outstandingRetirements--; unknownRetirement = unknownRetirement || !confirmed
            if (ticket == generation) mutable.value = LiveAccessState(cleanupUnknown = cleanupUnconfirmed())
            else mutable.value = state.value.copy(cleanupUnknown = cleanupUnconfirmed())
        }
        return ticket == generation
    }
    fun authenticationFailed() {
        if (identity != null) { leave(); mutable.value = LiveAccessState(failure = Failure.SIGN_IN, cleanupUnknown = cleanupUnconfirmed()) }
    }
    suspend fun signIn(workspaceKey: String, authenticate: suspend (SessionIdentity) -> Unit) {
        if (state.value.busy) return
        val workspace = config.workspaces.singleOrNull { it.key == workspaceKey } ?: throw IllegalArgumentException("Unknown workspace")
        if (!signOut()) return
        val ticket = generation
        mutable.value = LiveAccessState(busy = true, cleanupUnknown = cleanupUnconfirmed())
        var next: SessionIdentity? = null
        try {
            next = createIdentity(); identity = next
            subscription = next.subscribe {
                // Refreshing a token retains sessionKey; replacing a user invalidates the whole view.
                if (ticket == generation && bound != null && bound != next.session) authenticationFailed()
            }
            authenticate(next)
            if (ticket != generation) { closeRetired(next); return }
            val current = next.session ?: throw MobileFailure(Failure.SIGN_IN)
            val client = createClient(config.origin, workspace.scope(current.actorId), next)
            if (next.session != current) throw MobileFailure(Failure.SIGN_IN)
            bound = current; notifications?.attach(client, current.sessionKey); agent?.attach(client as? MobileAgentApi, current.sessionKey); controller.connect(client)
            mutable.value = LiveAccessState(workspace = workspace, cleanupUnknown = cleanupUnconfirmed())
            awaitCurrentInbox(ticket)
        } catch (error: CancellationException) {
            if (ticket == generation) leave() else closeRetired(next)
            throw error
        } catch (_: Exception) {
            if (ticket == generation) { leave(); mutable.value = LiveAccessState(failure = Failure.SIGN_IN, cleanupUnknown = cleanupUnconfirmed()) } else closeRetired(next)
        }
    }
    private suspend fun awaitCurrentInbox(ticket: Long) {
        controller.refresh()
        if (ticket == generation && controller.state.value.failure == Failure.SIGN_IN) authenticationFailed()
    }
}
