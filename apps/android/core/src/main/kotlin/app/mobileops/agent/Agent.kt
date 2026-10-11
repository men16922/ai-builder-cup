package app.mobileops.agent

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The same view the web console shows. Server-private ids (A2A task, confirmation call, actor) never reach the app. */
@Serializable enum class AgentState {
    @SerialName("working") WORKING, @SerialName("awaiting_approval") AWAITING_APPROVAL, @SerialName("deciding") DECIDING,
    @SerialName("completed") COMPLETED, @SerialName("rejected") REJECTED, @SerialName("failed") FAILED, @SerialName("unknown") UNKNOWN;
    val terminal get() = this == COMPLETED || this == REJECTED || this == FAILED || this == UNKNOWN
}
@Serializable data class AgentStep(val at: String, val agent: String, val kind: String, val name: String, val summary: String) {
    fun validate() { time(at); require(agent.length in 1..40 && kind in setOf("call", "result", "note") && name.length in 1..60 && summary.length <= 240) }
}
/** The state of an approved change, as the gateway writes it into the Chief's result step ("state" or "state: reason"). */
enum class ExecutionState { APPLIED, PENDING, UNKNOWN, FAILED, REFUSED }
private val EXECUTION = Regex("^(refused|pending|applied|failed|unknown)(?::|$)")
val AgentStep.executionState: ExecutionState? get() = if (name == "propose_rollback" && kind == "result")
    EXECUTION.find(summary)?.groupValues?.get(1)?.let { ExecutionState.valueOf(it.uppercase()) } else null

@Serializable data class AgentAction(val action: String, val service: String, val revision: String) {
    fun validate() { require(action == "rollback_traffic" && SLUG.matches(service) && SLUG.matches(revision)) }
    private companion object { val SLUG = Regex("^[a-z][a-z0-9-]{0,62}$") }
}
@Serializable data class AgentApproval(val action: AgentAction, val risk: String, val reason: String, val requestedAt: String, val expiresAt: String) {
    fun validate() { action.validate(); require(risk in setOf("low", "medium", "high") && reason.length <= 500); time(requestedAt); time(expiresAt) }
}
@Serializable data class AgentDecision(val value: String, val at: String, val byYou: Boolean) {
    fun validate() { require(value == "approve" || value == "reject"); time(at) }
}
@Serializable data class AgentTask(val id: String, val state: AgentState, val instruction: String, val language: String, val createdAt: String, val updatedAt: String, val steps: List<AgentStep>,
    val approval: AgentApproval? = null, val result: String? = null, val decision: AgentDecision? = null, val note: String? = null) {
    fun validate() {
        require(uuid(id) && instruction.length in 1..1000 && language in setOf("ko", "en") && steps.size <= 60 && (result?.length ?: 0) <= 4000 && (note?.length ?: 0) <= 240)
        time(createdAt); time(updatedAt); steps.forEach { it.validate() }; approval?.validate(); decision?.validate()
    }
    /** An approval can only be acted on while the server says so and the window has not passed. */
    fun decidable(nowMillis: Long) = state == AgentState.AWAITING_APPROVAL && approval != null && time(approval.expiresAt).toEpochMilli() > nowMillis
}
@Serializable data class AgentTaskList(val items: List<AgentTask>) { fun validate() { require(items.size <= 20); items.forEach { it.validate() } } }

interface MobileAgentApi {
    suspend fun agentTasks(): List<AgentTask>
    suspend fun agentTask(id: String): AgentTask
    suspend fun sendInstruction(instruction: String, language: String, key: String): AgentTask
    suspend fun decideTask(id: String, approve: Boolean, key: String): AgentTask
}
internal class AgentPost(override val body: String, override val key: String = UUID.randomUUID().toString()) : JsonPost {
    init { require(uuid(key) && body.toByteArray().size <= 32768) }
    override fun toString() = "AgentPost(redacted)"
}
internal fun agentInstructionBody(instruction: String, language: String) = buildJsonObject { put("instruction", instruction); put("language", language) }.toString()
internal fun agentDecisionBody(approve: Boolean) = buildJsonObject { put("decision", if (approve) "approve" else "reject") }.toString()

data class AgentBoard(val available: Boolean = false, val items: List<AgentTask> = emptyList(), val selectedId: String? = null, val busy: Boolean = false, val failure: Failure? = null) {
    val selected get() = items.firstOrNull { it.id == selectedId }
    val pending get(): Int { val now = System.currentTimeMillis(); return items.count { it.decidable(now) } }
}

/** Polls the stored task while the crew works. Never resends an uncertain request: after a failure it only reads the server's record. */
class MobileAgent(private val jobs: CoroutineScope, private val pollMillis: Long = 1500) {
    private val mutable = MutableStateFlow(AgentBoard())
    val state = mutable.asStateFlow()
    private var api: MobileAgentApi? = null
    private var session: String? = null
    private var watcher: Job? = null
    private var epoch = 0L
    private fun update(change: (AgentBoard) -> AgentBoard) { mutable.value = change(mutable.value) }

    fun attach(client: MobileAgentApi?, sessionKey: String) {
        detach(); if (client == null) return
        api = client; session = sessionKey; val ticket = ++epoch
        update { AgentBoard(available = true, busy = true) }
        jobs.launch {
            try {
                val items = client.agentTasks()
                if (ticket == epoch) { update { AgentBoard(available = true, items = items, selectedId = items.firstOrNull()?.id) }; watch() }
            } catch (error: CancellationException) { throw error }
            catch (error: MobileFailure) { if (ticket == epoch) update { it.copy(busy = false, failure = error.reason, available = error.reason != Failure.DENIED && error.reason != Failure.UNAVAILABLE) } }
            catch (_: Exception) { if (ticket == epoch) update { it.copy(busy = false, failure = Failure.INVALID_RESPONSE) } }
        }
    }
    fun detach() { epoch++; watcher?.cancel(); watcher = null; api = null; session = null; mutable.value = AgentBoard() }
    /** Re-reads the stored tasks, for example when the app returns to the foreground. Never sends anything. */
    fun refresh() {
        val client = api ?: return; val ticket = epoch
        jobs.launch {
            try {
                val items = client.agentTasks()
                if (ticket == epoch) { update { board -> board.copy(items = items, selectedId = board.selectedId?.takeIf { id -> items.any { it.id == id } } ?: items.firstOrNull()?.id, failure = null) }; watch() }
            } catch (error: CancellationException) { throw error }
            catch (error: MobileFailure) { if (ticket == epoch) update { it.copy(failure = error.reason) } }
            catch (_: Exception) { /* The previous list stays visible. */ }
        }
    }
    fun select(id: String) { if (mutable.value.items.any { it.id == id }) { update { it.copy(selectedId = id) }; watch() } }

    fun send(instruction: String, language: String) {
        val client = api ?: return; val text = instruction.trim()
        if (text.isEmpty() || text.length > 1000 || mutable.value.busy) return
        run(client) { client.sendInstruction(text, language, UUID.randomUUID().toString()) }
    }
    fun decide(id: String, approve: Boolean) {
        val client = api ?: return
        if (mutable.value.busy || mutable.value.items.firstOrNull { it.id == id }?.decidable(System.currentTimeMillis()) != true) return
        run(client) { client.decideTask(id, approve, UUID.randomUUID().toString()) }
    }
    private fun run(client: MobileAgentApi, call: suspend () -> AgentTask) {
        val ticket = epoch; update { it.copy(busy = true, failure = null) }
        jobs.launch {
            try {
                val task = call()
                if (ticket == epoch) { update { board -> board.copy(busy = false, items = (listOf(task) + board.items.filter { it.id != task.id }).take(20), selectedId = task.id) }; watch() }
            } catch (error: CancellationException) { throw error }
            catch (error: MobileFailure) { if (ticket == epoch) { update { it.copy(busy = false, failure = error.reason) }; refreshSelected(client) } }
            catch (_: Exception) { if (ticket == epoch) update { it.copy(busy = false, failure = Failure.INVALID_RESPONSE) } }
        }
    }
    private fun refreshSelected(client: MobileAgentApi) {
        val id = mutable.value.selectedId ?: return; val ticket = epoch
        jobs.launch { try { val task = client.agentTask(id); if (ticket == epoch) update { board -> board.copy(items = board.items.map { if (it.id == id) task else it }) } } catch (_: Exception) { /* The failure stays visible. */ } }
    }
    private fun watch() {
        watcher?.cancel(); val client = api ?: return; val ticket = epoch
        watcher = jobs.launch {
            while (ticket == epoch) {
                val selected = mutable.value.selected ?: return@launch
                if (selected.state.terminal || selected.state == AgentState.AWAITING_APPROVAL && !selected.decidable(System.currentTimeMillis())) return@launch
                delay(pollMillis)
                try { val task = client.agentTask(selected.id); if (ticket == epoch) update { board -> board.copy(items = board.items.map { if (it.id == task.id) task else it }) } }
                catch (error: CancellationException) { throw error }
                catch (error: MobileFailure) { if (ticket == epoch) update { it.copy(failure = error.reason) }; return@launch }
                catch (_: Exception) { return@launch }
            }
        }
    }
}
