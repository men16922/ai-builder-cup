package app.mobileops.agent

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MobileTest {
    @Test fun `real HTTP cancellation closes a stalled socket without waiting for the read timeout`() = runBlocking {
        val release = java.util.concurrent.CountDownLatch(1)
        val entered = java.util.concurrent.CountDownLatch(1)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply { createContext("/") {
            entered.countDown()
            try { release.await(3, java.util.concurrent.TimeUnit.SECONDS); it.sendResponseHeaders(200, -1) } catch (_: Exception) {} finally { it.close() }
        }; start() }
        try {
            val before = System.nanoTime()
            assertFailsWith<TimeoutCancellationException> {
                withTimeout(250) { UrlConnectionPort().request(URI("http://127.0.0.1:${server.address.port}/"), "synthetic", null) }
            }
            val elapsedMs = (System.nanoTime() - before) / 1000000
            assertEquals(0L, entered.count)
            assertTrue(elapsedMs < 1500, "Cancellation took ${elapsedMs}ms")
        } finally { release.countDown(); server.stop(0) }
    }
    private fun ready(api: MobileApi) = MobileController().also { it.connect(api) }
    @Test fun `both editions complete review explicit execution and handoff without treating health as success`() = runTest {
        for (edition in listOf("personal", "organization")) {
            val api = FixtureApi.load(edition); val c = ready(api)
            c.refresh(); assertEquals(3, c.state.value.inbox!!.items.size)
            c.open(c.state.value.inbox!!.items.first().id)
            assertEquals(6, c.state.value.original!!.facts.size)
            c.perform(Operation.APPROVE); assertEquals("pending", c.state.value.detail!!.plan.review.status)
            c.reviewed(true); c.perform(Operation.APPROVE)
            assertEquals(0, api.executions); assertEquals("approved", c.state.value.detail!!.plan.review.status)
            assertFalse(c.can(Operation.EXECUTE)); c.reviewed(true); c.perform(Operation.EXECUTE)
            val execution = c.state.value.detail!!.execution!!
            assertEquals(1, api.executions); assertEquals("succeeded", execution.state)
            assertEquals("partial", execution.result!!.coverage); assertEquals("unknown", execution.result.serviceAssessment)
            c.perform(Operation.HANDOFF, "Follow up missing historical UID")
            assertEquals(execution.state, c.state.value.detail!!.execution!!.state)
            c.refresh("results"); assertEquals(1, c.state.value.inbox!!.items.size)
            c.open(execution.planId); assertEquals(1, c.state.value.detail!!.execution!!.handoffs.size)
        }
    }
    @Test fun `empty and denied sources never become healthy or fabricated zero samples`() = runTest {
        val api = FixtureApi.load("personal")
        for (item in api.inbox("pending").items.drop(1)) {
            val c = ready(api); c.open(item.id); c.reviewed(true); c.perform(Operation.APPROVE); c.reviewed(true); c.perform(Operation.EXECUTE)
            val view = c.state.value.detail!!
            assertEquals(if(item.label == "empty") "succeeded" else "failed", view.execution!!.state)
            assertEquals("unknown", view.execution.result!!.serviceAssessment)
            val outcome = view.evidence!!.observations.first { it.id == "gcp-run-query-completion" }.value.jsonObject.getValue("outcomes").jsonArray.last().jsonObject.getValue("status").jsonPrimitive.content
            assertEquals(if(item.label == "empty") "no_data" else "denied", outcome)
        }
    }
    @Test fun `lost execution response recovers with exact request and never repeats provider read`() = runTest {
        val fixture = FixtureApi.load("personal"); val sent = mutableListOf<Mutation>(); var lose = true
        val api = object : MobileApi by fixture {
            override suspend fun mutate(request: Mutation): Workflow {
                sent += request; val result = fixture.mutate(request)
                if (request.operation == Operation.EXECUTE && lose) { lose = false; throw MobileFailure(Failure.OFFLINE) }
                return result
            }
        }
        val c = ready(api); c.open(api.inbox("pending").items.first().id); c.reviewed(true); c.perform(Operation.APPROVE); c.reviewed(true); c.perform(Operation.EXECUTE)
        assertTrue(c.state.value.uncertain); assertNull(c.state.value.detail); assertEquals(1, fixture.executions)
        c.perform(Operation.EXECUTE); assertEquals(2, sent.size)
        c.recover(); assertTrue(c.state.value.uncertain); assertEquals("succeeded", c.state.value.detail!!.execution!!.state)
        c.retrySameRequest(); assertFalse(c.state.value.uncertain); assertEquals(sent[1], sent[2]); assertEquals(1, fixture.executions)
    }
    @Test fun `offline read clears records reconnect does not submit and process restart has no queued decisions`() = runTest {
        val api = FixtureApi.load("organization"); val c = ready(api); c.refresh(); val id = c.state.value.inbox!!.items.first().id
        c.open(id); c.reviewed(true); api.offline = true; c.open(id)
        assertNull(c.state.value.inbox); assertNull(c.state.value.detail); assertFalse(c.state.value.reviewed)
        api.offline = false; c.open(id); assertEquals("pending", c.state.value.detail!!.plan.review.status); assertEquals(0, api.executions)
        val restarted = ready(api); assertNull(restarted.state.value.detail); restarted.refresh(); assertEquals(3, restarted.state.value.inbox!!.items.size)
        api.deny = true; c.open(id); assertNull(c.state.value.detail); assertNull(c.state.value.original); assertEquals(Failure.DENIED, c.state.value.failure)
    }
    @Test fun `late owner response is discarded after switching edition or signing out`() = runTest {
        val old = FixtureApi.load("personal"); val delayed = CompletableDeferred<Inbox>()
        val c = ready(object : MobileApi by old { override suspend fun inbox(filter: String, cursor: String?) = delayed.await() })
        val work = async { c.refresh() }; runCurrent()
        val next = FixtureApi.load("organization"); c.connect(next); c.refresh()
        delayed.complete(old.inbox("pending")); work.await()
        assertEquals(next.scope, c.state.value.scope); assertEquals("organization", c.state.value.inbox!!.owner.kind)
        c.connect(null); assertEquals(MobileState(), c.state.value)
    }
    @Test fun `expired plan remains readable but cannot be decided or executed`() = runTest {
        val api = FixtureApi.load("personal"); val id = api.inbox("pending").items.first().id
        api.now = api.now.plusSeconds(301); assertTrue(api.inbox("pending").items.isEmpty())
        assertTrue(api.inbox("all").items.all { it.expired })
        val c = ready(api); c.open(id); c.reviewed(true); assertFalse(c.can(Operation.APPROVE)); assertFalse(c.can(Operation.EXECUTE))
    }
    @Test fun `background and rotation invalidate checks and ignore a late mutation without losing its request key`() = runTest {
        val fixture = FixtureApi.load("personal"); val release = CompletableDeferred<Unit>(); val requests = mutableListOf<Mutation>()
        val api = object : MobileApi by fixture {
            override suspend fun mutate(request: Mutation): Workflow {
                requests += request; val result = fixture.mutate(request)
                if (requests.size == 1) release.await()
                return result
            }
        }
        val c = ready(api); val id = fixture.inbox("pending").items.first().id
        c.open(id); c.reviewed(true); val work = async { c.perform(Operation.APPROVE) }; runCurrent()
        c.hideUntilRevalidated(); assertNull(c.state.value.detail); assertTrue(c.state.value.uncertain)
        release.complete(Unit); work.await(); assertNull(c.state.value.detail)
        c.recover(); assertFalse(c.can(Operation.EXECUTE)); c.retrySameRequest()
        assertEquals(requests[0], requests[1]); assertFalse(c.state.value.reviewed); assertEquals(0, fixture.executions)
    }
    @Test fun `known stale rejection clears retry intent while an unavailable mutation retains it`() = runTest {
        val fixture = FixtureApi.load("personal"); var reason = Failure.STALE
        val api = object : MobileApi by fixture { override suspend fun mutate(request: Mutation): Workflow = throw MobileFailure(reason) }
        val c = ready(api); val id = fixture.inbox("pending").items.first().id
        c.open(id); c.reviewed(true); c.perform(Operation.APPROVE); assertFalse(c.state.value.uncertain)
        reason = Failure.UNAVAILABLE; c.open(id); c.reviewed(true); c.perform(Operation.APPROVE); assertTrue(c.state.value.uncertain)
    }
    @Test fun `wire client confines native routes and rejects foreign owners providers action drift and broken records`() = runTest {
        val fixture = FixtureApi.load("personal"); val inbox = fixture.inbox("pending"); val id = inbox.items.first().id
        val view = fixture.detail(id); var body = wireJson.encodeToString(view); var seen: URI? = null
        val identity = object : IdentityPort { override val actorId = fixture.scope.actorId; override suspend fun tokenFor(actorId: String) = "synthetic-id-token" }
        val client = GcpMobileClient("https://mobile.example", fixture.scope, identity, HttpPort { uri, _, _ -> seen = uri; HttpReply(200, "application/json", body) })
        assertEquals(view, client.detail(id)); assertEquals(fixture.scope.path + "/plans/$id", seen!!.path)
        val bad = listOf(
            body.replace("\"provider\":\"gcp\"", "\"provider\":\"aws\""),
            body.replace("\"userId\":\"synthetic-operator\"", "\"userId\":\"another-user\""),
            body.replace("\"maxLogEntries\":50", "\"maxLogEntries\":100"),
            body.replace("\"serviceAssessment\":\"unknown\"", "\"serviceAssessment\":\"healthy\""),
            body.replace("\"lifecycle\":\"prepared\"", "\"lifecycle\":\"prepared\",\"executionId\":\"${UUID.randomUUID()}\""),
        )
        for (invalid in bad) { body = invalid; assertEquals(Failure.INVALID_RESPONSE, assertFailsWith<MobileFailure> { client.detail(id) }.reason) }
        for (origin in listOf("http://example.com", "https://user:pass@example.com", "https://example.com/api", "https://example.com?key=x")) assertFailsWith<IllegalArgumentException> { GcpMobileClient(origin, fixture.scope, identity) }
    }
    @Test fun `token subject changes during a request hide even valid response`() = runTest {
        val fixture = FixtureApi.load("personal"); var actor: String? = fixture.scope.actorId
        val identity = object : IdentityPort { override val actorId get() = actor; override suspend fun tokenFor(actorId: String) = "synthetic" }
        val payload = wireJson.encodeToString(fixture.inbox("pending"))
        val client = GcpMobileClient("https://mobile.example", fixture.scope, identity, HttpPort { _, _, _ -> actor = "other"; HttpReply(200, "application/json", payload) })
        assertEquals(Failure.SIGN_IN, assertFailsWith<MobileFailure> { client.inbox("pending") }.reason)
    }
    @Test fun `pagination merges bounded pages and filter changes discard the previous page`() = runTest {
        val fixture = FixtureApi.load("personal"); val source = fixture.inbox("pending").items.first()
        val ids = (1..24).map { "10000000-0000-4000-8000-${it.toString().padStart(12, '0')}" }
        val cursors = mutableListOf<String?>()
        val api = object : MobileApi by fixture {
            override suspend fun inbox(filter: String, cursor: String?): Inbox {
                cursors += cursor
                val items = if (filter == "results") emptyList() else (if (cursor == null) ids.take(20) else ids.drop(20)).map { source.copy(id = it) }
                return Inbox(scope.owner, scope.workspaceId, "2026-10-10T01:00:00Z", filter, 50, items, if (filter == "pending" && cursor == null) ids[19] else null).also { it.validate(scope, filter) }
            }
        }
        val c = ready(api); c.refresh(); c.refresh(more = true)
        assertEquals(ids, c.state.value.inbox!!.items.map { it.id }); assertEquals(listOf(null, ids[19]), cursors)
        c.refresh("results"); assertTrue(c.state.value.inbox!!.items.isEmpty()); assertNull(cursors.last())
    }
    @Test fun `HTTP failures expose fixed categories and discard raw response bodies`() = runTest {
        val fixture = FixtureApi.load("personal"); var status = 401
        val identity = object : IdentityPort { override val actorId = fixture.scope.actorId; override suspend fun tokenFor(actorId: String) = "synthetic" }
        val client = GcpMobileClient("https://mobile.example", fixture.scope, identity, HttpPort { _, _, _ -> HttpReply(status, "text/html", "private raw body") })
        for ((code, reason) in listOf(401 to Failure.SIGN_IN, 403 to Failure.DENIED, 404 to Failure.DENIED, 409 to Failure.STALE, 410 to Failure.STALE, 500 to Failure.UNAVAILABLE, 200 to Failure.INVALID_RESPONSE)) {
            status = code; val error = assertFailsWith<MobileFailure> { client.inbox("pending") }; assertEquals(reason, error.reason); assertFalse(error.toString().contains("private"))
        }
    }
    @Test fun `transport never forwards bearer through redirects or emits raw error data`() = runTest {
        var forwarded = 0
        val target = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply { createContext("/") { forwarded++; it.sendResponseHeaders(200, -1); it.close() }; start() }
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply { createContext("/") {
            it.responseHeaders.add("Location", "http://127.0.0.1:${target.address.port}/"); it.sendResponseHeaders(302, -1); it.close()
        }; start() }
        try {
            val reply = UrlConnectionPort().request(URI("http://127.0.0.1:${server.address.port}/"), "synthetic", null)
            assertEquals(302, reply.status); assertEquals("", reply.body); assertEquals(0, forwarded)
        } finally { server.stop(0); target.stop(0) }
    }
}
