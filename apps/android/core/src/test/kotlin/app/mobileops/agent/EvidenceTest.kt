package app.mobileops.agent

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import kotlin.test.*

class EvidenceTest {
    @Serializable private data class Expected(val consistency: String, val service: ServiceMetadata?, val revision: RevisionMetadata?, val summary: SignalSummary?, val statuses: List<String>)
    @Serializable private data class Vector(val name: String, val scope: Scope, val plan: PlanPayload, val original: JsonObject, val expected: Expected)
    private fun vectors() = wireJson.decodeFromString<List<Vector>>(javaClass.getResourceAsStream("/evidence-projections.json")!!.bufferedReader().use { it.readText() })
    private fun project(v: Vector, value: JsonElement = v.original) = originalEvidence(value.toString(), v.plan, v.scope)
    private fun patch(root: JsonElement, path: String, value: JsonElement?): JsonElement {
        fun replace(node: JsonElement, keys: List<String>): JsonElement {
            val key = keys.first()
            return if (node is JsonArray) JsonArray(node.mapIndexed { index, child -> if (index.toString() != key) child else if (keys.size == 1) requireNotNull(value) else replace(child, keys.drop(1)) })
            else { val entries = node.jsonObject.toMutableMap()
                if (keys.size == 1) { if (value == null) entries.remove(key) else entries[key] = value }
                else entries[key] = replace(entries.getValue(key), keys.drop(1))
                JsonObject(entries)
            }
        }
        return replace(root, path.split('/'))
    }
    @Test fun `native evidence matches strict server vectors and the actual web summary in both editions`() {
        val vectors = vectors(); assertEquals(11, vectors.size)
        vectors.forEach { v ->
            val result = project(v)
            assertEquals(v.expected.consistency, result.consistency, v.name)
            assertEquals(v.expected.service, result.service, v.name); assertEquals(v.expected.revision, result.revision, v.name)
            assertEquals(v.expected.summary, result.telemetry?.summary(), v.name)
            assertEquals(v.expected.statuses, result.facts.map { it.status }, v.name)
            assertEquals(listOf("service", "revision", "recheck") + if (result.telemetry == null) emptyList() else listOf("logs", "requests", "latency"), result.facts.map { it.id })
        }
    }
    @Test fun `real zero absent matching code partial empty page and no telemetry remain distinct`() {
        val samples = vectors().associate { it.name to project(it) }
        val zero = samples.getValue("personal-explicit-zero-without-5xx").telemetry!!.summary()
        assertEquals(0L, zero.total); assertNull(zero.errorCount); assertEquals(0.0, zero.highestP95Ms)
        val empty = samples.getValue("personal-empty"); assertEquals("no_data", empty.telemetry!!.requests.status); assertNull(empty.telemetry.summary().total)
        val partial = samples.getValue("personal-truncated-empty-page"); assertEquals("collected", partial.telemetry!!.requests.status); assertEquals(true, partial.telemetry.requests.truncated); assertNull(partial.telemetry.summary().total)
        val denied = samples.getValue("personal-denied"); assertEquals("denied", denied.telemetry!!.latency.status); assertNull(denied.telemetry.summary().highestP95Ms)
        assertNull(samples.getValue("personal-metadata-only").telemetry)
        val metadata = samples.getValue("personal-metadata-denied"); assertNull(metadata.service); assertNull(metadata.revision); assertEquals("unverified", metadata.consistency)
    }
    @Test fun `source target identity time and collected failure shape mismatches are rejected`() {
        val v = vectors().first()
        val cases = listOf(
            "snapshot/service/source" to JsonPrimitive("other.googleapis.com"),
            "snapshot/telemetry/requests/source" to JsonPrimitive("logging.googleapis.com/v2/entries.list"),
            "snapshot/binding/owner/userId" to JsonPrimitive("another-user"),
            "snapshot/service/resourceName" to JsonPrimitive("projects/other-project/locations/us-central1/services/other"),
            "snapshot/service/value/uid" to JsonPrimitive("another-service-uid"),
            "snapshot/revision/value/service" to JsonPrimitive("projects/other-project/locations/us-central1/services/other"),
            "snapshot/service/observedAt" to JsonPrimitive("2026-10-10T01:00:01.000Z"),
            "snapshot/startedAt" to JsonPrimitive("2026-10-10T00:59:44.000Z"),
            "snapshot/telemetry/window/end" to JsonPrimitive("2026-10-10T00:59:00.000Z"),
            "snapshot/service/value/readiness" to JsonPrimitive("healthy"),
            "snapshot/schemaVersion" to JsonPrimitive("1"),
            "snapshot/service/value/traffic/0/percent" to JsonPrimitive("100"),
            "snapshot/service/value/reconciling" to JsonPrimitive("false"),
            "snapshot/service/status" to JsonPrimitive("denied"),
            "snapshot/telemetry/logs/status" to JsonPrimitive("no_data"),
            "snapshot/telemetry/logs/truncated" to JsonNull,
            "snapshot/telemetry/logs/truncated" to JsonPrimitive("true"),
            "snapshot/telemetry/logs/code" to JsonPrimitive("no_matching_data"),
        )
        cases.forEach { (path, value) -> assertFails(path) { project(v, patch(v.original, path, value)) } }
        assertFails { project(v, patch(v.original, "snapshot/service/value", null)) }
        val denied = vectors().first { it.name == "personal-metadata-denied" }
        assertFails { project(denied, patch(denied.original, "snapshot/consistency", JsonPrimitive("stable"))) }
    }
    @Test fun `logs expose only bounded safe metadata and reject payload URL IP and oversized samples`() {
        val v = vectors().first(); val log = v.original["snapshot"]!!.jsonObject["telemetry"]!!.jsonObject["logs"]!!.jsonObject["value"]!!.jsonArray.first()
        val missingLatency = patch(v.original, "snapshot/telemetry/logs/value/0/latencyMs", JsonNull)
        val nullable = project(v, patch(missingLatency, "snapshot/telemetry/logs/value/0/responseCode", JsonNull)).telemetry!!.logs.value!!.first()
        assertNull(nullable.latencyMs); assertNull(nullable.responseCode)
        for (field in listOf("textPayload", "jsonPayload", "requestUrl", "remoteIp", "authorization"))
            assertFails(field) { project(v, patch(v.original, "snapshot/telemetry/logs/value/0/$field", JsonPrimitive("sensitive-raw-value"))) }
        assertEquals(50, project(v, patch(v.original, "snapshot/telemetry/logs/value", JsonArray(List(50) { log }))).telemetry!!.logs.value!!.size)
        assertFails { project(v, patch(v.original, "snapshot/telemetry/logs/value", JsonArray(List(51) { log }))) }
        for ((path, value) in listOf(
            "timestamp" to JsonPrimitive("2026-10-10T00:58:00.000Z"), "stream" to JsonPrimitive("private-url"), "severity" to JsonPrimitive("private-body"),
            "responseCode" to JsonPrimitive(999), "latencyMs" to JsonPrimitive(-1)))
            assertFails(path) { project(v, patch(v.original, "snapshot/telemetry/logs/value/0/$path", value)) }
    }
    @Test fun `metric summaries reject duplicate intervals codes overflow and malformed numeric values`() {
        val v = vectors().first()
        val request = v.original["snapshot"]!!.jsonObject["telemetry"]!!.jsonObject["requests"]!!.jsonObject["value"]!!.jsonArray.first()
        val point = request.jsonObject["points"]!!.jsonArray.first()
        val cases = listOf(
            "snapshot/telemetry/requests/value/0/responseClass" to JsonPrimitive("5xx"),
            "snapshot/telemetry/requests/value/0/points/0/count" to JsonPrimitive(-1),
            "snapshot/telemetry/requests/value/0/points/0/count" to JsonPrimitive(9007199254740992L),
            "snapshot/telemetry/requests/value/0/points/0/count" to JsonPrimitive(0.1),
            "snapshot/telemetry/requests/value/0/points/0/count" to JsonPrimitive("88"),
            "snapshot/telemetry/requests/value/0/points/0/start" to JsonPrimitive("2026-10-10T00:55:00.000Z"),
            "snapshot/telemetry/requests/value/0/points" to JsonArray(listOf(point, point)),
            "snapshot/telemetry/requests/value" to JsonArray(listOf(request, request)),
            "snapshot/telemetry/latency/value/0/points/0/p95Ms" to JsonPrimitive(-0.1),
            "snapshot/telemetry/latency/value/0/points/0/p95Ms" to JsonPrimitive(86400001),
            "snapshot/telemetry/latency/value/0/points/0/p95Ms" to JsonPrimitive("NaN"),
            "snapshot/telemetry/latency/value/0/points/0/p95Ms" to JsonPrimitive("1250"),
        )
        cases.forEach { (path, value) -> assertFails(path) { project(v, patch(v.original, path, value)) } }
        val overflow = patch(v.original, "snapshot/telemetry/requests/value/0/points/0/count", JsonPrimitive(9007199254740991L))
        assertFails { project(v, overflow) } // The second series adds twelve beyond the safe-integer boundary.
        val end = time("2026-10-10T00:58:00.000Z")
        val minutes = JsonArray((0..14).map { index -> buildJsonObject {
            put("start", end.minusSeconds((15 - index) * 60L).toString()); put("end", end.minusSeconds((14 - index) * 60L).toString()); put("count", 1)
        } })
        fun series(index: Int, points: JsonArray = minutes) = buildJsonObject { put("responseCode", (200 + index).toString()); put("responseClass", "2xx"); put("points", points) }
        val atLimit = JsonArray((0..7).map { series(it) })
        assertEquals(120L, project(v, patch(v.original, "snapshot/telemetry/requests/value", atLimit)).telemetry!!.summary().total)
        assertFails { project(v, patch(v.original, "snapshot/telemetry/requests/value", JsonArray(atLimit + series(8, JsonArray(listOf(minutes.first())))))) }
        assertFails { project(v, patch(v.original, "snapshot/telemetry/requests/value", JsonArray((0..40).map { series(it, JsonArray(listOf(minutes.first()))) }))) }
    }
    @Test fun `invalid original response clears prior evidence and disables decisions`() = runTest {
        val fixture = FixtureApi.load("personal"); val id = fixture.inbox("pending").items.first().id; val view = fixture.detail(id)
        val bundles = wireJson.parseToJsonElement(javaClass.getResourceAsStream("/synthetic-personal.json")!!.bufferedReader().use { it.readText() }).jsonArray
        var original = bundles.first().jsonObject.getValue("original")
        val identity = object : IdentityPort { override val actorId = fixture.scope.actorId; override suspend fun tokenFor(actorId: String) = "synthetic-token" }
        val client = GcpMobileClient("https://mobile.example", fixture.scope, identity, HttpPort { uri, _, mutation ->
            assertNull(mutation)
            HttpReply(200, "application/json", if (uri.path.contains("/plans/")) wireJson.encodeToString(view) else original.toString())
        })
        val controller = MobileController(); controller.connect(client); controller.open(id); controller.reviewed(true)
        assertEquals(100L, controller.state.value.original!!.telemetry!!.summary().total); assertTrue(controller.can(Operation.APPROVE))
        original = patch(original, "snapshot/telemetry/logs/value/0/requestUrl", JsonPrimitive("private-url"))
        controller.open(id)
        assertEquals(Failure.INVALID_RESPONSE, controller.state.value.failure); assertNull(controller.state.value.detail); assertNull(controller.state.value.original)
        assertFalse(controller.can(Operation.APPROVE)); assertFalse(controller.state.value.reviewed)
    }
}
