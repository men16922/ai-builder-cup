package app.mobileops.agent.data

import app.mobileops.agent.Failure
import app.mobileops.agent.FixtureAgentApi
import app.mobileops.agent.FixtureApi
import app.mobileops.agent.LiveAccess
import app.mobileops.agent.LiveAccessState
import app.mobileops.agent.MobileAgent
import app.mobileops.agent.MobileConfiguration
import app.mobileops.agent.MobileController
import app.mobileops.agent.MobileNotifications
import app.mobileops.agent.NotificationNavigation
import app.mobileops.agent.Operation
import app.mobileops.agent.PushTokenSource
import app.mobileops.agent.Scope
import app.mobileops.agent.SessionIdentity
import app.mobileops.agent.mobility.MobileMobility
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Reuses the tested session, request-key and notification coordinators behind one data boundary.
 */
class DefaultMobileRepository(
    configuration: MobileConfiguration?,
    scope: CoroutineScope,
    createIdentity: (() -> SessionIdentity)? = null,
    createPushSource: ((Scope) -> PushTokenSource)? = null,
    private val loadFixture: (String) -> FixtureApi = FixtureApi::load,
) : MobileRepository {
    override val mobility = MobileMobility(scope)
    private val controller = MobileController()
    private val crew = MobileAgent(scope)
    private val push = MobileNotifications(scope, createPushSource)
    private val navigation = NotificationNavigation(controller)
    private val mutableConnection = MutableStateFlow(MobileConnection())
    private val access = configuration?.let {
        requireNotNull(createIdentity)
        LiveAccess(it, controller, createIdentity, push, crew, mobility = mobility)
    }
    private var fixture: FixtureApi? = null
    private var signInJob: Job? = null

    override val workflow = controller.state
    override val agent = crew.state
    override val notifications = push.state
    override val liveAccess = access?.state ?: MutableStateFlow(LiveAccessState()).asStateFlow()
    override val connection = mutableConnection.asStateFlow()
    override val notificationAvailable = navigation.available

    init {
        scope.launch {
            var previousWorkspace = liveAccess.value.workspace
            liveAccess.collect {
                if (previousWorkspace != null && it.workspace == null) navigation.clear()
                previousWorkspace = it.workspace
            }
        }
    }

    override suspend fun connectRehearsal(edition: String) {
        signOut()
        val next = loadFixture(edition)
        fixture = next
        mutableConnection.value = MobileConnection(mode = "synthetic")
        controller.connect(next)
        crew.attach(FixtureAgentApi(), "synthetic")
        controller.refresh()
    }

    override suspend fun signIn(
        workspaceKey: String,
        authenticate: suspend (SessionIdentity) -> Unit,
    ) {
        val next = access ?: return
        if (next.state.value.busy) return
        navigation.clear()
        fixture = null
        mutableConnection.value = MobileConnection(mode = "server")
        val job = currentCoroutineContext()[Job]
        signInJob = job
        try {
            next.signIn(workspaceKey, authenticate)
        } finally {
            if (signInJob === job) signInJob = null
        }
    }

    override suspend fun signOut() {
        mobility.detach()
        signInJob?.cancel()
        signInJob = null
        navigation.clear()
        fixture = null
        mutableConnection.value = MobileConnection()
        controller.connect(null)
        crew.detach()
        access?.signOut()
    }

    private suspend fun checkAuthentication(action: suspend () -> Unit) {
        action()
        if (
            connection.value.mode == "server" && controller.state.value.failure == Failure.SIGN_IN
        ) {
            navigation.clear()
            access?.authenticationFailed()
        }
    }

    override suspend fun refreshInbox(filter: String, more: Boolean) {
        checkAuthentication { controller.refresh(filter, more) }
    }

    override suspend fun openWorkflow(id: String) {
        checkAuthentication { controller.open(id) }
    }

    override suspend fun perform(operation: Operation, note: String) {
        checkAuthentication { controller.perform(operation, note) }
    }

    override suspend fun recover() {
        checkAuthentication { controller.recover() }
    }

    override suspend fun retrySameRequest() {
        checkAuthentication { controller.retrySameRequest() }
    }

    override suspend fun toggleRehearsalNetwork() {
        fixture?.let {
            it.offline = !it.offline
            mutableConnection.value = connection.value.copy(disconnected = it.offline)
        }
        refreshInbox()
    }

    override suspend fun enableNotifications() {
        push.enableOrRetry()
        if (push.state.value.failure == Failure.SIGN_IN) {
            navigation.clear()
            access?.authenticationFailed()
        }
    }

    override suspend fun disableNotifications() {
        push.disable()
    }

    override suspend fun openNotification() {
        if (connection.value.mode == "server") checkAuthentication { navigation.open() }
    }

    override suspend fun resume() {
        mobility.refresh()
        if (workflow.value.scope != null) {
            workflow.value.selectedId?.let { openWorkflow(it) } ?: refreshInbox()
        }
        if (connection.value.mode == "server") {
            crew.refresh()
            push.refresh()
            if (push.state.value.failure == Failure.SIGN_IN) {
                navigation.clear()
                access?.authenticationFailed()
            }
        }
    }

    override fun canPerform(operation: Operation) = controller.can(operation)

    override fun reviewEvidence(checked: Boolean) = controller.reviewed(checked)

    override fun back() = controller.back()

    override fun hideUntilRevalidated() = controller.hideUntilRevalidated()

    override fun receiveNotification(raw: String) {
        navigation.receive(raw)
    }

    override fun dismissNotification() = navigation.clear()

    override fun sendInstruction(instruction: String, language: String) =
        crew.send(instruction, language)

    override fun selectAgentTask(id: String) = crew.select(id)

    override fun decideAgentTask(id: String, approve: Boolean) = crew.decide(id, approve)

    override fun close() {
        mobility.detach()
        signInJob?.cancel()
        signInJob = null
        navigation.clear()
        crew.detach()
        access?.leave()
        controller.connect(null)
    }
}
