package app.mobileops.agent

import java.time.Instant
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.json.*

// Kotlin's numeric decoder accepts quoted numbers. The server's strict schema does not.
private fun jsonNumber(decoder: Decoder): JsonPrimitive {
    val value =
        (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonPrimitive
            ?: throw SerializationException("Expected JSON number")
    if (value.isString || value is JsonNull) throw SerializationException("Expected JSON number")
    return value
}

private object StrictInt : KSerializer<Int> by Int.serializer() {
    override fun deserialize(decoder: Decoder) =
        jsonNumber(decoder).intOrNull ?: throw SerializationException("Expected JSON integer")
}

private object StrictLong : KSerializer<Long> by Long.serializer() {
    override fun deserialize(decoder: Decoder) =
        jsonNumber(decoder).longOrNull ?: throw SerializationException("Expected JSON integer")
}

private object StrictDouble : KSerializer<Double> by Double.serializer() {
    override fun deserialize(decoder: Decoder) =
        jsonNumber(decoder).doubleOrNull ?: throw SerializationException("Expected JSON number")
}

private object StrictBoolean : KSerializer<Boolean> by Boolean.serializer() {
    override fun deserialize(decoder: Decoder): Boolean {
        val value = (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonPrimitive
        return value?.takeUnless { it.isString }?.booleanOrNull
            ?: throw SerializationException("Expected JSON boolean")
    }
}

private const val serviceSource = "run.googleapis.com/v2/projects.locations.services.get"
private const val revisionSource = "run.googleapis.com/v2/projects.locations.services.revisions.get"
private const val loggingSource = "logging.googleapis.com/v2/entries.list"
private const val monitoringSource = "monitoring.googleapis.com/v3/projects.timeSeries.list"
private const val maxSafeInteger = 9007199254740991L
private val readCodes =
    setOf(
        "access_denied",
        "not_found",
        "throttled",
        "unavailable",
        "invalid_response",
        "service_unverified",
    )
private val readyStates = setOf("succeeded", "failed", "pending", "reconciling", "unknown")

private fun revisionId(value: String) = Regex("^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$").matches(value)

private fun atWithin(value: String, start: Instant, end: Instant) =
    require(time(value) >= start && time(value) <= end)

private fun metadata(
    name: String,
    uid: String,
    generation: String?,
    observedGeneration: String?,
    updateTime: String?,
    readiness: String,
    missingFields: List<String>,
) {
    require(name.length in 1..512 && uid.length in 1..128 && readiness in readyStates)
    listOfNotNull(
            generation,
            observedGeneration,
        )
        .forEach { require(Regex("^\\d{1,19}$").matches(it)) }
    updateTime?.let(::time)
    require(missingFields.size <= 20 && missingFields.all { it.length in 1..100 })
}

@Serializable
data class TrafficAllocation(
    val revision: String?,
    @Serializable(with = StrictInt::class) val percent: Int?,
)

@Serializable
data class ServiceMetadata(
    val name: String,
    val uid: String,
    val generation: String?,
    val observedGeneration: String?,
    val updateTime: String?,
    @Serializable(with = StrictBoolean::class) val reconciling: Boolean?,
    val readiness: String,
    val missingFields: List<String>,
    val latestCreatedRevision: String?,
    val latestReadyRevision: String?,
    val traffic: List<TrafficAllocation>?,
) {
    fun validate() {
        metadata(name, uid, generation, observedGeneration, updateTime, readiness, missingFields)
        listOfNotNull(
                latestCreatedRevision,
                latestReadyRevision,
            )
            .forEach { require(revisionId(it)) }
        traffic?.let {
            require(it.size <= 100)
            it.forEach { row ->
                require(
                    (row.revision == null ||
                        revisionId(
                            row.revision,
                        )) && (row.percent == null || row.percent in 0..100),
                )
            }
        }
    }
}

@Serializable
data class RevisionMetadata(
    val name: String,
    val uid: String,
    val generation: String?,
    val observedGeneration: String?,
    val updateTime: String?,
    @Serializable(with = StrictBoolean::class) val reconciling: Boolean?,
    val readiness: String,
    val missingFields: List<String>,
    val service: String,
) {
    fun validate() =
        metadata(name, uid, generation, observedGeneration, updateTime, readiness, missingFields)
}

@Serializable
data class MetadataRead<T>(
    val status: String,
    val source: String,
    val resourceName: String,
    val observedAt: String,
    val value: T? = null,
    val code: String? = null,
) {
    fun validate(expectedSource: String, expectedName: String, start: Instant, end: Instant) {
        require(source == expectedSource && resourceName == expectedName)
        atWithin(
            observedAt,
            start,
            end,
        )
        if (status == "collected") require(value != null && code == null)
        else
            require(
                status in
                    setOf(
                        "denied",
                        "missing",
                        "unavailable",
                        "skipped",
                    ) && value == null && code in readCodes,
            )
    }
}

@Serializable
data class LogSample(
    val timestamp: String,
    val severity: String,
    val stream: String,
    @Serializable(with = StrictInt::class) val responseCode: Int?,
    @Serializable(with = StrictDouble::class) val latencyMs: Double?,
)

@Serializable
data class RequestPoint(
    val start: String,
    val end: String,
    @Serializable(with = StrictLong::class) val count: Long,
)

@Serializable
data class LatencyPoint(
    val start: String,
    val end: String,
    @Serializable(with = StrictDouble::class) val p95Ms: Double,
)

@Serializable
data class RequestSeries(
    val responseCode: String,
    val responseClass: String,
    val points: List<RequestPoint>,
)

@Serializable
data class LatencySeries(
    val responseCode: String,
    val responseClass: String,
    val points: List<LatencyPoint>,
)

@Serializable
data class TelemetryRead<T>(
    val status: String,
    val source: String,
    val observedAt: String,
    val value: List<T>? = null,
    @Serializable(with = StrictBoolean::class) val truncated: Boolean? = null,
    val code: String? = null,
) {
    fun validate(expectedSource: String, start: Instant, end: Instant, maxItems: Int) {
        require(source == expectedSource)
        atWithin(observedAt, start, end)
        if (status == "collected")
            require(
                value != null &&
                    truncated != null &&
                    code == null &&
                    value.size <= maxItems &&
                    (value.isNotEmpty() || truncated),
            )
        else
            require(
                status in
                    setOf(
                        "no_data",
                        "denied",
                        "unavailable",
                        "skipped",
                    ) &&
                    value == null &&
                    truncated == null &&
                    code in readCodes + "no_matching_data",
            )
    }
}

@Serializable data class RequestCount(val code: String, val count: Long)

@Serializable
data class SignalSummary(
    val counts: List<RequestCount>,
    val total: Long?,
    val errorCount: Long?,
    val highestP95Ms: Double?,
    val logs: List<LogSample>,
)

@Serializable
data class TelemetryEvidence(
    val window: Window,
    val logs: TelemetryRead<LogSample>,
    val requests: TelemetryRead<RequestSeries>,
    val latency: TelemetryRead<LatencySeries>,
) {
    fun validate(started: Instant, observed: Instant) {
        val start = time(window.start)
        val end = time(window.end)
        require(end == start.plusSeconds(900) && end.toEpochMilli() % 60000 == 0L)
        val lag = started.toEpochMilli() - end.toEpochMilli()
        require(lag in 120000..179999)
        logs.validate(loggingSource, started, observed, 50)
        requests.validate(
            monitoringSource,
            started,
            observed,
            40,
        )
        latency.validate(monitoringSource, started, observed, 40)
        logs.value?.forEach {
            require(time(it.timestamp) >= start && time(it.timestamp) < end)
            require(
                it.severity in
                    setOf(
                        "DEFAULT",
                        "DEBUG",
                        "INFO",
                        "NOTICE",
                        "WARNING",
                        "ERROR",
                        "CRITICAL",
                        "ALERT",
                        "EMERGENCY",
                        "UNKNOWN",
                    ),
            )
            require(
                it.stream in
                    setOf(
                        "requests",
                        "stdout",
                        "stderr",
                    ) && (it.responseCode == null || it.responseCode in 100..599),
            )
            it.latencyMs?.let { ms -> require(ms.isFinite() && ms in 0.0..86400000.0) }
        }
        fun series(code: String, responseClass: String, ends: List<String>) {
            require(Regex("^[1-5][0-9]{2}$").matches(code) && responseClass == "${code[0]}xx")
            require(ends.size in 1..15 && ends.distinct().size == ends.size)
        }

        fun point(from: String, to: String) {
            require(
                time(from) >= start &&
                    time(to) <= end &&
                    time(to) == time(from).plusSeconds(60) &&
                    time(
                            to,
                        )
                        .toEpochMilli() % 60000 == 0L,
            )
        }
        requests.value?.let { values ->
            require(
                values.sumOf { it.points.size } <= 120 &&
                    values.map { it.responseCode }.distinct().size == values.size,
            )
            values.forEach { row ->
                series(
                    row.responseCode,
                    row.responseClass,
                    row.points.map { it.end },
                )
                row.points.forEach {
                    point(
                        it.start,
                        it.end,
                    )
                    require(it.count in 0..maxSafeInteger)
                }
            }
            require(values.sumOf { row -> row.points.sumOf { it.count } } <= maxSafeInteger)
        }
        latency.value?.let { values ->
            require(
                values.sumOf { it.points.size } <= 120 &&
                    values.map { it.responseCode }.distinct().size == values.size,
            )
            values.forEach { row ->
                series(
                    row.responseCode,
                    row.responseClass,
                    row.points.map { it.end },
                )
                row.points.forEach {
                    point(
                        it.start,
                        it.end,
                    )
                    require(it.p95Ms.isFinite() && it.p95Ms in 0.0..86400000.0)
                }
            }
        }
    }

    /** Same display calculation as web summarizeTelemetry; absent matching samples stay null. */
    fun summary(): SignalSummary {
        val counts =
            requests.value.orEmpty().map {
                RequestCount(it.responseCode, it.points.sumOf { point -> point.count })
            }
        val errors = counts.filter { it.code.startsWith('5') }
        return SignalSummary(
            counts,
            counts.takeIf { it.isNotEmpty() }?.sumOf { it.count },
            errors.takeIf { it.isNotEmpty() }?.sumOf { it.count },
            latency.value.orEmpty().flatMap { it.points }.maxOfOrNull { it.p95Ms },
            logs.value.orEmpty(),
        )
    }
}

@Serializable
private data class Snapshot(
    @Serializable(with = StrictInt::class) val schemaVersion: Int,
    val id: String,
    val dataMode: String,
    val binding: Binding,
    val startedAt: String,
    val observedAt: String,
    val service: MetadataRead<ServiceMetadata>,
    val revision: MetadataRead<RevisionMetadata>,
    val recheck: MetadataRead<ServiceMetadata>,
    val consistency: String,
    val serviceAssessment: String,
    val telemetry: TelemetryEvidence? = null,
)

@Serializable
private data class ObservationReply(
    val resourceId: String,
    val configurationDigest: String,
    val evidenceDigest: String,
    val snapshot: Snapshot,
)

data class SourceFact(
    val id: String,
    val source: String,
    val status: String,
    val observedAt: String,
    val code: String? = null,
    val missingFields: List<String> = emptyList(),
    val truncated: Boolean? = null,
)

data class OriginalEvidence(
    val id: String,
    val observedAt: String,
    val facts: List<SourceFact>,
    val consistency: String,
    val service: ServiceMetadata?,
    val revision: RevisionMetadata?,
    val recheck: ServiceMetadata?,
    val telemetry: TelemetryEvidence?,
)

/**
 * Strict source DTO projection. Never includes log payloads, arbitrary JSON or executable output.
 */
fun originalEvidence(raw: String, plan: PlanPayload, scope: Scope): OriginalEvidence {
    require(raw.toByteArray().size <= 2097152)
    plan.validate(scope)
    val reply = wireJson.decodeFromString<ObservationReply>(raw)
    val s = reply.snapshot
    val target = plan.target
    require(
        validId(reply.resourceId) &&
            digest(reply.configurationDigest) &&
            reply.evidenceDigest == plan.evidence.digest,
    )
    s.binding.validate(scope)
    require(
        s.schemaVersion == 1 &&
            s.binding == plan.binding &&
            s.id == plan.evidence.snapshotId &&
            s.dataMode == plan.dataMode,
    )
    require(
        s.serviceAssessment == "unknown" &&
            s.observedAt == plan.evidence.observedAt &&
            s.consistency in
                setOf(
                    "stable",
                    "changed",
                    "unverified",
                ),
    )
    val start = time(s.startedAt)
    val end = time(s.observedAt)
    require(start <= end && end <= start.plusSeconds(15))
    s.service.validate(serviceSource, target.resourceName, start, end)
    s.recheck.validate(
        serviceSource,
        target.resourceName,
        start,
        end,
    )
    val revisionName = target.resourceName + "/revisions/" + target.revision
    s.revision.validate(revisionSource, revisionName, start, end)
    listOfNotNull(
            s.service.value,
            s.recheck.value,
        )
        .forEach {
            it.validate()
            require(it.name == target.resourceName && it.uid == target.resourceUid)
        }
    s.revision.value?.let {
        it.validate()
        require(it.name == revisionName && it.service == target.resourceName)
    }
    if (s.consistency != "unverified")
        require(s.service.status == "collected" && s.recheck.status == "collected")
    s.telemetry?.validate(start, end)
    val facts =
        listOf(
            SourceFact(
                "service",
                s.service.source,
                s.service.status,
                s.service.observedAt,
                s.service.code,
                s.service.value?.missingFields.orEmpty(),
            ),
            SourceFact(
                "revision",
                s.revision.source,
                s.revision.status,
                s.revision.observedAt,
                s.revision.code,
                s.revision.value?.missingFields.orEmpty(),
            ),
            SourceFact(
                "recheck",
                s.recheck.source,
                s.recheck.status,
                s.recheck.observedAt,
                s.recheck.code,
                s.recheck.value?.missingFields.orEmpty(),
            ),
        ) +
            (s.telemetry?.let { t ->
                listOf(
                        "logs" to t.logs,
                        "requests" to t.requests,
                        "latency" to t.latency,
                    )
                    .map { (id, read) ->
                        SourceFact(
                            id,
                            read.source,
                            read.status,
                            read.observedAt,
                            read.code,
                            truncated = read.truncated,
                        )
                    }
            } ?: emptyList())
    return OriginalEvidence(
        s.id,
        s.observedAt,
        facts,
        s.consistency,
        s.service.value,
        s.revision.value,
        s.recheck.value,
        s.telemetry,
    )
}
