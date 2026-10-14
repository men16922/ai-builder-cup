package app.mobileops.agent

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MobileState(
    val scope: Scope? = null,
    val filter: String = "pending",
    val inbox: Inbox? = null,
    val detail: Workflow? = null,
    val original: OriginalEvidence? = null,
    val selectedId: String? = null,
    val busy: Boolean = false,
    val failure: Failure? = null,
    val uncertain: Boolean = false,
    val reviewed: Boolean = false
)

/** Called on the UI dispatcher. Session epochs discard late responses after switch/logout.
 * All data are memory-only; a new process begins with an empty state and must GET again. */
class MobileController {
    private var api: MobileApi? = null
    private var epoch = 0L
    private var pending: Mutation? = null
    private val mutable = MutableStateFlow(MobileState())
    val state: StateFlow<MobileState> = mutable.asStateFlow()
    fun connect(next: MobileApi?) {
        epoch++; api = next; pending = null; mutable.value = MobileState(scope = next?.scope)
    }

    fun hideUntilRevalidated() {
        epoch++
        mutable.value = state.value.copy(
            inbox = null,
            detail = null,
            original = null,
            busy = false,
            reviewed = false,
            uncertain = pending != null
        )
    }

    fun reviewed(checked: Boolean) {
        if (!state.value.busy && state.value.detail != null && !state.value.uncertain) mutable.value =
            state.value.copy(reviewed = checked)
    }

    fun back() {
        if (!state.value.busy) {
            epoch++; mutable.value = state.value.copy(
                detail = null,
                original = null,
                selectedId = null,
                reviewed = false
            )
        }
    }

    fun can(operation: Operation): Boolean {
        val s = state.value;
        val v = s.detail ?: return false
        if (s.busy || s.failure != null || s.uncertain) return false
        return when (operation) {
            Operation.REVIEW -> v.capabilities.requestReview
            Operation.APPROVE, Operation.REJECT, Operation.CHANGES -> v.capabilities.decide && s.reviewed
            Operation.EXECUTE -> v.capabilities.execute && s.reviewed
            Operation.HANDOFF -> v.capabilities.handoff
            Operation.CANCEL -> v.capabilities.cancel
        }
    }

    private suspend fun call(mutation: Boolean = false, block: suspend (MobileApi) -> Unit) {
        val client = api ?: return; if (state.value.busy) return
        val ticket = epoch
        mutable.value = state.value.copy(busy = true, failure = null)
        try {
            block(client)
        } catch (error: CancellationException) {
            if (ticket == epoch) mutable.value = state.value.copy(
                inbox = null,
                detail = null,
                original = null,
                reviewed = false,
                uncertain = mutation || pending != null
            )
            throw error
        } catch (error: Exception) {
            if (ticket == epoch) {
                val failure = (error as? MobileFailure)?.reason ?: Failure.UNAVAILABLE
                if (failure in setOf(Failure.SIGN_IN, Failure.DENIED, Failure.STALE)) pending = null
                mutable.value = state.value.copy(
                    inbox = null,
                    detail = null,
                    original = null,
                    reviewed = false,
                    failure = failure,
                    uncertain = pending != null
                )
            }
        } finally {
            if (ticket == epoch) mutable.value = state.value.copy(busy = false)
        }
    }

    suspend fun refresh(filter: String = state.value.filter, more: Boolean = false) {
        require(filter in setOf("pending", "results", "all"))
        val previous = state.value.inbox
        val cursor =
            if (more && filter == state.value.filter) previous?.nextCursor ?: return else null
        val ticket = epoch
        call { client ->
            mutable.value = state.value.copy(
                inbox = null,
                detail = null,
                original = null,
                selectedId = null,
                filter = filter,
                reviewed = false
            )
            val page = client.inbox(filter, cursor)
            if (ticket == epoch) mutable.value =
                state.value.copy(inbox = if (cursor == null) page else page.copy(items = (previous!!.items + page.items).distinctBy { it.id }
                    .take(50)))
        }
    }

    suspend fun open(id: String) {
        require(uuid(id));
        val ticket = epoch
        call { client ->
            mutable.value =
                state.value.copy(detail = null, original = null, selectedId = id, reviewed = false)
            val view = client.detail(id)
            if (ticket != epoch) return@call
            val evidence = client.original(view.plan.payload)
            if (ticket == epoch) mutable.value =
                state.value.copy(detail = view, original = evidence, uncertain = pending != null)
        }
    }

    /** Explicit click only. Always resolve against the currently signed-in scope; never replay a push outcome. */
    suspend fun openNotification(data: GcpNotification) {
        val ticket = epoch
        call { client ->
            mutable.value = state.value.copy(
                inbox = null,
                detail = null,
                original = null,
                selectedId = null,
                reviewed = false
            )
            try {
                data.validate()
            } catch (_: RuntimeException) {
                throw MobileFailure(Failure.INVALID_RESPONSE)
            }
            val notifications =
                client as? MobileNotificationApi ?: throw MobileFailure(Failure.UNAVAILABLE)
            val view = notifications.resolveNotification(data)
            if (ticket != epoch) return@call
            view.validate(client.scope, data.planId)
            val evidence = client.original(view.plan.payload)
            if (ticket == epoch) mutable.value = state.value.copy(
                detail = view,
                original = evidence,
                selectedId = data.planId,
                uncertain = pending != null,
                reviewed = false
            )
        }
    }

    suspend fun perform(operation: Operation, note: String = "") {
        if (!can(operation)) return
        val request = Mutation.create(operation, state.value.detail!!, note)
        pending = request
        send(request)
    }

    private suspend fun send(request: Mutation) {
        val ticket = epoch
        call(mutation = true) { client ->
            val view = client.mutate(request)
            if (ticket != epoch) return@call
            pending = null
            mutable.value = state.value.copy(
                detail = view,
                selectedId = view.plan.payload.planId,
                reviewed = false,
                uncertain = false
            )
        }
    }

    /** User-triggered, fresh GET first. Never generate a replacement request key. */
    suspend fun recover() {
        val request = pending ?: return;
        val ticket = epoch
        call { client ->
            val view = client.detail(request.planId)
            if (ticket != epoch) return@call
            val evidence = client.original(view.plan.payload)
            if (ticket == epoch) mutable.value = state.value.copy(
                detail = view,
                original = evidence,
                selectedId = request.planId,
                uncertain = true,
                reviewed = false
            )
        }
    }

    suspend fun retrySameRequest() {
        val request = pending ?: return
        if (state.value.busy || state.value.failure != null || state.value.detail?.plan?.payload?.planId != request.planId) return
        send(request)
    }
}
