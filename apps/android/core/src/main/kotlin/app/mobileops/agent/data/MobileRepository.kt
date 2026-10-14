package app.mobileops.agent.data

import app.mobileops.agent.AgentBoard
import app.mobileops.agent.LiveAccessState
import app.mobileops.agent.MobileState
import app.mobileops.agent.NotificationState
import app.mobileops.agent.Operation
import app.mobileops.agent.SessionIdentity
import app.mobileops.agent.mobility.MobilityRepository
import kotlinx.coroutines.flow.StateFlow

/**
 * App data and session boundary. Screens never receive API clients, SDKs, or mutable coordinators.
 */
interface MobileRepository {
    val mobility: MobilityRepository
    val workflow: StateFlow<MobileState>
    val agent: StateFlow<AgentBoard>
    val notifications: StateFlow<NotificationState>
    val liveAccess: StateFlow<LiveAccessState>
    val connection: StateFlow<MobileConnection>
    val notificationAvailable: StateFlow<Boolean>

    suspend fun connectRehearsal(edition: String)

    suspend fun signIn(workspaceKey: String, authenticate: suspend (SessionIdentity) -> Unit)

    suspend fun signOut()

    suspend fun refreshInbox(filter: String = workflow.value.filter, more: Boolean = false)

    suspend fun openWorkflow(id: String)

    suspend fun perform(operation: Operation, note: String)

    suspend fun recover()

    suspend fun retrySameRequest()

    suspend fun toggleRehearsalNetwork()

    suspend fun enableNotifications()

    suspend fun disableNotifications()

    suspend fun openNotification()

    suspend fun resume()

    fun canPerform(operation: Operation): Boolean

    fun reviewEvidence(checked: Boolean)

    fun back()

    fun hideUntilRevalidated()

    fun receiveNotification(raw: String)

    fun dismissNotification()

    fun sendInstruction(instruction: String, language: String)

    fun selectAgentTask(id: String)

    fun decideAgentTask(id: String, approve: Boolean)

    fun close()
}
