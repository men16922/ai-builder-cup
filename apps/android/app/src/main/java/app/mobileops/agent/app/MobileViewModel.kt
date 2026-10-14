package app.mobileops.agent.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import app.mobileops.agent.Operation
import app.mobileops.agent.SessionIdentity
import app.mobileops.agent.app.data.ConfigurationState
import app.mobileops.agent.data.MobileRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/** Presents immutable state and actions without retaining an Activity or Android services. */
class MobileViewModel(
    repositoryFactory: (CoroutineScope) -> MobileRepository,
    val configuration: ConfigurationState,
) : ViewModel() {
    private val repository = repositoryFactory(viewModelScope)
    val mobilityRepository = repository.mobility
    val workflowState = repository.workflow
    val agentState = repository.agent
    val notificationState = repository.notifications
    val liveState = repository.liveAccess
    val connectionState = repository.connection
    val notificationAvailable = repository.notificationAvailable

    fun connect(edition: String) {
        viewModelScope.launch { repository.connectRehearsal(edition) }
    }

    suspend fun signIn(key: String, authenticate: suspend (SessionIdentity) -> Unit) {
        repository.signIn(key, authenticate)
    }

    fun leave() {
        viewModelScope.launch { repository.signOut() }
    }

    fun refreshInbox(filter: String = workflowState.value.filter, more: Boolean = false) {
        viewModelScope.launch { repository.refreshInbox(filter, more) }
    }

    fun openWorkflow(id: String) {
        viewModelScope.launch { repository.openWorkflow(id) }
    }

    // Returning to a list or foreground only reads current state; it never starts an execution.
    fun backToInbox() {
        repository.back()
        refreshInbox()
    }

    fun reviewEvidence(checked: Boolean) = repository.reviewEvidence(checked)

    fun canPerform(operation: Operation) = repository.canPerform(operation)

    fun perform(operation: Operation, note: String) {
        viewModelScope.launch { repository.perform(operation, note) }
    }

    fun recover() {
        viewModelScope.launch { repository.recover() }
    }

    // A lost reply keeps its original request key in the repository. Do not create a new action.
    fun retrySameRequest() {
        viewModelScope.launch { repository.retrySameRequest() }
    }

    fun toggleNetwork() {
        viewModelScope.launch { repository.toggleRehearsalNetwork() }
    }

    fun enableNotifications() {
        viewModelScope.launch { repository.enableNotifications() }
    }

    fun disableNotifications() {
        viewModelScope.launch { repository.disableNotifications() }
    }

    fun openNotification() {
        viewModelScope.launch { repository.openNotification() }
    }

    fun receiveNotification(raw: String) = repository.receiveNotification(raw)

    fun dismissNotification() = repository.dismissNotification()

    fun sendInstruction(instruction: String, language: String) =
        repository.sendInstruction(instruction, language)

    fun selectAgentTask(id: String) = repository.selectAgentTask(id)

    fun decideAgentTask(id: String, approve: Boolean) = repository.decideAgentTask(id, approve)

    fun resume() {
        viewModelScope.launch { repository.resume() }
    }

    fun hideUntilRevalidated() = repository.hideUntilRevalidated()

    // Fence late callbacks and cancel session work when the retained ViewModel is finally cleared.
    override fun onCleared() {
        repository.close()
        super.onCleared()
    }
}
