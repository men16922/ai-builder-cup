package app.mobileops.agent

import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

val wireJson = Json { ignoreUnknownKeys = false; explicitNulls = false }
internal fun validId(value: String) = Regex("^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$").matches(value)
internal fun uuid(value: String) = Regex("^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$").matches(value)
internal fun digest(value: String) = Regex("^[a-f0-9]{64}$").matches(value)
internal fun time(value: String): Instant = Instant.parse(value)
internal fun mode(value: String) = value in setOf("synthetic", "live")

@Serializable data class Owner(val kind: String, val userId: String? = null, val organizationId: String? = null) {
    fun validate() = require(when (kind) {
        "personal" -> userId?.let(::validId) == true && organizationId == null
        "organization" -> organizationId?.let(::validId) == true && userId == null
        else -> false
    })
}
@Serializable data class Scope(val actorId: String, val owner: Owner, val workspaceId: String) {
    init { owner.validate(); require(validId(actorId) && validId(workspaceId)); require(owner.kind != "personal" || owner.userId == actorId) }
    val path: String get() = if (owner.kind == "personal") "/api/mobile/v1/personal/workspaces/$workspaceId/gcp"
        else "/api/mobile/v1/organizations/${owner.organizationId}/workspaces/$workspaceId/gcp"
}
@Serializable data class Target(val provider: String, val projectId: String, val location: String, val resourceId: String,
    val resourceName: String, val resourceUid: String, val revision: String) {
    fun validate() {
        require(provider == "gcp" && Regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$").matches(projectId))
        require(Regex("^[a-z][a-z0-9-]{1,62}$").matches(location) && validId(resourceId) && validId(resourceUid))
        require(Regex("^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$").matches(revision))
        require(Regex("^projects/$projectId/locations/$location/services/[a-z](?:[a-z0-9-]{0,47}[a-z0-9])?$").matches(resourceName))
    }
}
@Serializable data class Binding(val owner: Owner, val workspaceId: String, val environmentId: String, val target: Target) {
    fun validate(scope: Scope) { owner.validate(); target.validate(); require(owner == scope.owner && workspaceId == scope.workspaceId && validId(environmentId)) }
}
@Serializable data class InboxItem(val id: String, val resourceId: String, val label: String, val binding: Binding,
    val dataMode: String, val createdAt: String, val expiresAt: String, val evidenceObservedAt: String,
    val lifecycle: String, val reviewStatus: String, val executionState: String? = null, val expired: Boolean)
@Serializable data class Inbox(val owner: Owner, val workspaceId: String, val serverTime: String, val status: String,
    val recentPlanLimit: Int, val items: List<InboxItem>, val nextCursor: String? = null) {
    fun validate(scope: Scope, filter: String) {
        require(owner == scope.owner && workspaceId == scope.workspaceId && status == filter && recentPlanLimit == 50)
        require(items.size <= 20 && items.map { it.id }.distinct().size == items.size)
        val now = time(serverTime)
        items.forEach {
            it.binding.validate(scope)
            require(uuid(it.id) && validId(it.resourceId) && it.label.length in 1..128 && mode(it.dataMode))
            require(it.lifecycle in lifecycles && it.reviewStatus in reviews && (it.executionState == null || it.executionState in executionStates))
            require(time(it.expiresAt) > time(it.createdAt) && time(it.evidenceObservedAt) <= time(it.createdAt))
            require(it.expired == (time(it.expiresAt) <= now))
            require(filter != "pending" || (!it.expired && it.lifecycle == "prepared" && it.reviewStatus == "pending"))
            require(filter != "results" || it.executionState != null)
        }
        require(nextCursor == null || uuid(nextCursor) && items.lastOrNull()?.id == nextCursor)
    }
}
internal val lifecycles = setOf("prepared", "superseded", "consumed")
internal val reviews = setOf("not_requested", "pending", "approved", "rejected", "changes_requested")
internal val executionStates = setOf("queued", "running", "succeeded", "failed", "unknown", "cancelled")
@Serializable data class EvidenceRef(val snapshotId: String, val digest: String, val sourceIds: List<String>, val observedAt: String)
@Serializable data class Finding(val statement: String, val evidenceIds: List<String>, val kind: String)
@Serializable data class Analysis(val engine: String, val summary: String, val findings: List<Finding>, val missingInformation: List<String>,
    val serviceAssessment: String, val modelId: String? = null, val promptVersion: String? = null)
@Serializable data class Action(val id: String, val version: Int, val effect: String, val completionCriteria: List<String>, val inputs: JsonObject)
@Serializable data class PlanPayload(val schemaVersion: Int, val planId: String, val version: Int, val dataMode: String,
    val owner: Owner, val workspaceId: String, val environmentId: String, val target: Target, val evidence: EvidenceRef,
    val analysis: Analysis, val action: Action, val createdAt: String, val expiresAt: String) {
    val binding get() = Binding(owner, workspaceId, environmentId, target)
    fun validate(scope: Scope) {
        binding.validate(scope)
        require(schemaVersion == 1 && uuid(planId) && version > 0 && mode(dataMode) && uuid(evidence.snapshotId) && digest(evidence.digest))
        require(action.version == 1 && action.effect == "read" && action.completionCriteria.size in 1..10)
        require(when (action.id) {
            "gcp.cloudrun.metadata.inspect.v1" -> action.inputs.isEmpty()
            "gcp.cloudrun.inspect.v1" -> action.inputs == buildJsonObject { put("windowMinutes", 15); put("maxLogEntries", 50) }
            else -> false
        })
        require(evidence.sourceIds.isNotEmpty() && evidence.sourceIds.size <= 100 && evidence.sourceIds.distinct() == evidence.sourceIds)
        require(analysis.engine in setOf("synthetic-fixture", "gemini") && analysis.serviceAssessment == "unknown")
        require(analysis.summary.length in 1..4000 && analysis.findings.size <= 30 && analysis.missingInformation.size <= 30)
        require(analysis.findings.all { it.kind in setOf("observation", "hypothesis") && it.statement.length in 1..2000 && it.evidenceIds.isNotEmpty() && evidence.sourceIds.containsAll(it.evidenceIds) })
        val created = time(createdAt); val expires = time(expiresAt); val observed = time(evidence.observedAt)
        require(expires > created && expires <= created.plusSeconds(600) && observed <= created && observed >= created.minusSeconds(900))
    }
}
@Serializable data class Review(val status: String, val requestedAt: String? = null, val requestedBy: String? = null,
    val decidedAt: String? = null, val decidedBy: String? = null, val note: String? = null)
@Serializable data class StoredPlan(val payload: PlanPayload, val digest: String, val lifecycle: String, val review: Review,
    val executionId: String? = null, val supersededBy: String? = null)
@Serializable data class ResultRef(val evidenceId: String, val digest: String, val coverage: String, val serviceAssessment: String)
@Serializable data class Handoff(val id: String, val at: String, val actorId: String, val note: String)
@Serializable data class Execution(val id: String, val binding: Binding, val planId: String, val planDigest: String, val dataMode: String,
    val actionId: String, val state: String, val createdAt: String, val updatedAt: String, val createdBy: String,
    val message: String, val handoffs: List<Handoff>, val startedAt: String? = null, val finishedAt: String? = null, val result: ResultRef? = null)
@Serializable data class Observation(val id: String, val source: String, val quality: String, val value: JsonElement,
    val label: String? = null, val observedAt: String? = null, val limitation: String? = null)
@Serializable data class Window(val start: String, val end: String)
@Serializable data class Evidence(val schemaVersion: Int, val id: String, val dataMode: String, val owner: Owner, val workspaceId: String,
    val environmentId: String, val target: Target, val observedAt: String, val observations: List<Observation>, val window: Window? = null, val notice: String? = null) {
    val binding get() = Binding(owner, workspaceId, environmentId, target)
}
@Serializable data class Capabilities(val requestReview: Boolean, val decide: Boolean, val execute: Boolean, val handoff: Boolean, val cancel: Boolean)
@Serializable data class Workflow(val plan: StoredPlan, val serverTime: String, val capabilities: Capabilities,
    val execution: Execution? = null, val evidence: Evidence? = null) {
    fun validate(scope: Scope, requestedPlan: String? = null) {
        val p = plan.payload; p.validate(scope); time(serverTime)
        require(requestedPlan == null || p.planId == requestedPlan)
        require(digest(plan.digest) && plan.lifecycle in lifecycles && plan.review.status in reviews)
        require((plan.executionId != null) == (execution != null) && (execution?.result != null) == (evidence != null))
        execution?.let {
            it.binding.validate(scope)
            require(uuid(it.id) && it.id == plan.executionId && it.planId == p.planId && it.planDigest == plan.digest)
            require(it.actionId == p.action.id && it.binding == p.binding && it.dataMode == p.dataMode && it.state in executionStates)
            require(time(it.updatedAt) >= time(it.createdAt) && it.handoffs.size <= 100)
            require(it.handoffs.all { h -> uuid(h.id) && h.note.length <= 2000 && validId(h.actorId) })
            it.result?.let { r -> require(digest(r.digest) && r.coverage in setOf("complete", "partial") && r.serviceAssessment == "unknown") }
        }
        evidence?.let {
            it.binding.validate(scope)
            require(it.schemaVersion == 1 && it.binding == p.binding && it.dataMode == p.dataMode && it.id == execution?.result?.evidenceId)
            require(it.observations.size in 1..100 && it.observations.map { o -> o.id }.distinct().size == it.observations.size)
            require(it.observations.all { o -> o.quality in setOf("complete", "partial", "missing", "unknown", "denied") && validId(o.id) })
            if (p.action.id == "gcp.cloudrun.inspect.v1") requireNotNull(inspectionReceipt(it))
        }
    }
}

@Serializable data class QueryOutcome(val id: String, val status: String, val truncated: Boolean?)
@Serializable data class InspectionReceipt(val window: Window, val maxLogEntries: Int, val maxPointsPerMetric: Int, val outcomes: List<QueryOutcome>)
fun inspectionReceipt(evidence: Evidence): InspectionReceipt? {
    val item = evidence.observations.singleOrNull { it.id == "gcp-run-query-completion" && it.source == "mobileops:bounded-telemetry-read-completion" } ?: return null
    val receipt = wireJson.decodeFromJsonElement<InspectionReceipt>(item.value)
    require(receipt.maxLogEntries == 50 && receipt.maxPointsPerMetric == 120 && time(receipt.window.end) == time(receipt.window.start).plusSeconds(900))
    require(receipt.outcomes.map { it.id } == listOf("gcp-run-logs", "gcp-run-requests", "gcp-run-latency"))
    require(receipt.outcomes.all { it.status in setOf("collected", "no_data", "denied", "unavailable", "skipped") && (it.truncated != null) == (it.status == "collected") })
    return receipt
}

