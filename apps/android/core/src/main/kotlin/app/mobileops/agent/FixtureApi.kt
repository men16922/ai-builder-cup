package app.mobileops.agent

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

@Serializable
data class DemoBundle(
    val scope: Scope, val scenario: String, val initial: Workflow, val original: JsonObject,
    val resultEvidence: Evidence, val resultDigest: String, val resultState: String
)

/** Explicit rehearsal only. No HTTP/Firebase/model/Google calls; process restart resets every record. */
class FixtureApi(private val bundles: List<DemoBundle>) : MobileApi {
    override val scope = bundles.first().scope
    var offline = false
    var deny = false
    var now: Instant = time(bundles.first().initial.serverTime)
    var executions = 0; private set
    private val records =
        bundles.associate { it.initial.plan.payload.planId to it.initial }.toMutableMap()
    private val receipts = mutableMapOf<String, Pair<Mutation, Workflow>>()

    init {
        require(bundles.isNotEmpty()); bundles.forEach {
            require(it.scope == scope); it.initial.validate(
            scope
        )
        }
    }

    private fun available() {
        if (offline) throw MobileFailure(Failure.OFFLINE); if (deny) throw MobileFailure(Failure.DENIED)
    }

    private fun current(id: String): Workflow {
        val record = records[id] ?: throw MobileFailure(Failure.DENIED)
        val fresh = record.plan.lifecycle == "prepared" && now < time(record.plan.payload.expiresAt)
        val terminal =
            record.execution?.state in setOf("succeeded", "failed", "unknown", "cancelled")
        return record.copy(
            serverTime = now.toString(), capabilities = Capabilities(
                requestReview = fresh && record.plan.review.status == "not_requested",
                decide = fresh && record.plan.review.status == "pending",
                execute = fresh && record.plan.review.status == "approved",
                handoff = terminal,
                cancel = record.execution?.state == "queued"
            )
        )
    }

    override suspend fun inbox(filter: String, cursor: String?): Inbox {
        available(); require(filter in setOf("pending", "results", "all"))
        val index = bundles.map { it.initial.plan.payload.planId }
        if (cursor != null && cursor !in index) throw MobileFailure(Failure.STALE)
        val items = index.drop(if (cursor == null) 0 else index.indexOf(cursor) + 1).map { id ->
            val view = current(id);
            val p = view.plan.payload
            InboxItem(
                id,
                p.target.resourceId,
                bundles.first { it.initial.plan.payload.planId == id }.scenario,
                p.binding,
                p.dataMode,
                p.createdAt,
                p.expiresAt,
                p.evidence.observedAt,
                view.plan.lifecycle,
                view.plan.review.status,
                view.execution?.state,
                time(p.expiresAt) <= now
            )
        }
            .filter { filter == "all" || filter == "results" && it.executionState != null || filter == "pending" && !it.expired && it.lifecycle == "prepared" && it.reviewStatus == "pending" }
        return Inbox(
            scope.owner,
            scope.workspaceId,
            now.toString(),
            filter,
            50,
            items.take(20),
            if (items.size > 20) items[19].id else null
        ).also { it.validate(scope, filter) }
    }

    override suspend fun detail(id: String): Workflow {
        available(); return current(id).also { it.validate(scope, id) }
    }

    override suspend fun original(plan: PlanPayload): OriginalEvidence {
        available();
        val bundle = bundles.firstOrNull { it.initial.plan.payload.planId == plan.planId }
            ?: throw MobileFailure(Failure.DENIED)
        return originalEvidence(bundle.original.toString(), plan, scope)
    }

    override suspend fun mutate(request: Mutation): Workflow {
        available()
        receipts[request.key]?.let {
            if (it.first != request) throw MobileFailure(Failure.STALE); return current(
            request.planId
        )
        }
        val view = current(request.planId);
        val p = view.plan.payload;
        val body = wireJson.parseToJsonElement(request.body) as JsonObject
        val c = view.capabilities
        val allowed = when (request.operation) {
            Operation.REVIEW -> c.requestReview; Operation.APPROVE, Operation.REJECT, Operation.CHANGES -> c.decide
            Operation.EXECUTE -> c.execute; Operation.HANDOFF -> c.handoff; Operation.CANCEL -> c.cancel
        }
        if (!allowed) throw MobileFailure(Failure.STALE)
        if (request.operation !in setOf(Operation.HANDOFF, Operation.CANCEL) &&
            (body["expectedDigest"]?.jsonPrimitive?.content != view.plan.digest || body["expectedVersion"]?.jsonPrimitive?.content != p.version.toString())
        ) throw MobileFailure(Failure.STALE)
        val stamp = now.toString()
        val changed = when (request.operation) {
            Operation.REVIEW -> view.copy(
                plan = view.plan.copy(
                    review = Review(
                        "pending",
                        stamp,
                        scope.actorId
                    )
                )
            )

            Operation.APPROVE, Operation.REJECT, Operation.CHANGES -> view.copy(
                plan = view.plan.copy(
                    review = view.plan.review.copy(
                        status = when (request.operation) {
                            Operation.APPROVE -> "approved"; Operation.REJECT -> "rejected"; else -> "changes_requested"
                        },
                        decidedAt = stamp,
                        decidedBy = scope.actorId,
                        note = body["note"]?.jsonPrimitive?.content ?: ""
                    )
                )
            )

            Operation.EXECUTE -> {
                val bundle = bundles.first { it.initial.plan.payload.planId == p.planId };
                val executionId = UUID.randomUUID().toString(); executions++
                view.copy(
                    plan = view.plan.copy(lifecycle = "consumed", executionId = executionId),
                    evidence = bundle.resultEvidence,
                    execution = Execution(
                        executionId,
                        p.binding,
                        p.planId,
                        view.plan.digest,
                        "synthetic",
                        p.action.id,
                        bundle.resultState,
                        stamp,
                        stamp,
                        scope.actorId,
                        "Synthetic rehearsal only.",
                        emptyList(),
                        stamp,
                        stamp,
                        ResultRef(
                            bundle.resultEvidence.id,
                            bundle.resultDigest,
                            "partial",
                            "unknown"
                        )
                    )
                )
            }

            Operation.HANDOFF -> view.copy(
                execution = view.execution!!.copy(
                    handoffs = view.execution.handoffs + Handoff(
                        UUID.randomUUID().toString(),
                        stamp,
                        scope.actorId,
                        body.getValue("note").jsonPrimitive.content
                    )
                )
            )

            Operation.CANCEL -> view.copy(
                execution = view.execution!!.copy(
                    state = "cancelled",
                    finishedAt = stamp
                )
            )
        }
        changed.validate(scope); records[p.planId] = changed
        val result = current(p.planId); receipts[request.key] = request to result; return result
    }

    companion object {
        fun load(edition: String): FixtureApi {
            require(edition in setOf("personal", "organization"))
            val text =
                requireNotNull(FixtureApi::class.java.getResourceAsStream("/synthetic-$edition.json")).bufferedReader()
                    .use { it.readText() }
            return FixtureApi(wireJson.decodeFromString<List<DemoBundle>>(text))
        }
    }
}
