package app.mobileops.agent

import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class AgentTest {
    private val id = "4d1ff454-d70d-484f-b506-fbf5230b0626"
    private fun task(state: String, extra: String = "") = """{"id":"$id","state":"$state","instruction":"Fix it","language":"en","createdAt":"2026-10-10T01:00:00.000Z","updatedAt":"2026-10-10T01:00:05.000Z",
        "steps":[{"at":"2026-10-10T01:00:02.000Z","agent":"ops","kind":"call","name":"ops","summary":"Read shop-api"}]$extra}"""
    private fun approval(expires: String) = ""","approval":{"action":{"action":"rollback_traffic","service":"shop-api","revision":"shop-api-good"},"risk":"medium","reason":"bad fails","requestedAt":"2026-10-10T01:00:05.000Z","expiresAt":"$expires"}"""

    @Test fun `a task parses strictly and an unknown field or malformed action is rejected`() {
        val parsed = wireJson.decodeFromString<AgentTask>(task("awaiting_approval", approval("2026-10-10T01:08:00.000Z"))).also { it.validate() }
        assertEquals(AgentState.AWAITING_APPROVAL, parsed.state); assertEquals("shop-api-good", parsed.approval?.action?.revision)
        assertFailsWith<Exception> { wireJson.decodeFromString<AgentTask>(task("working", ""","extra":"x"""")) }
        assertFailsWith<IllegalArgumentException> { wireJson.decodeFromString<AgentTask>(task("awaiting_approval", approval("2026-10-10T01:08:00.000Z").replace("rollback_traffic", "delete_service"))).validate() }
        assertFailsWith<Exception> { wireJson.decodeFromString<AgentTask>(task("exploded")) }
    }
    @Test fun `an approval is decidable only while the server says so and the window is open`() {
        val open = wireJson.decodeFromString<AgentTask>(task("awaiting_approval", approval("2026-10-10T01:08:00.000Z")))
        assertTrue(open.decidable(time("2026-10-10T01:05:00Z").toEpochMilli())); assertFalse(open.decidable(time("2026-10-10T01:09:00Z").toEpochMilli()))
        assertFalse(wireJson.decodeFromString<AgentTask>(task("working")).decidable(0)); assertTrue(AgentState.COMPLETED.terminal); assertFalse(AgentState.DECIDING.terminal)
    }

    private class Api(var current: String) : MobileAgentApi {
        val sent = mutableListOf<Triple<String, String, String>>(); val decisions = mutableListOf<Triple<String, Boolean, String>>(); var fail: MobileFailure? = null; var reads = 0
        private fun parse(json: String) = wireJson.decodeFromString<AgentTask>(json).also { it.validate() }
        override suspend fun agentTasks() = listOf(parse(current))
        override suspend fun agentTask(id: String): AgentTask { reads++; return parse(current) }
        override suspend fun sendInstruction(instruction: String, language: String, key: String): AgentTask { sent += Triple(instruction, language, key); fail?.let { throw it }; return parse(current) }
        override suspend fun decideTask(id: String, approve: Boolean, key: String): AgentTask { decisions += Triple(id, approve, key); fail?.let { throw it }; return parse(current) }
    }

    @Test fun `the coordinator loads, polls until the task is terminal and then stops`() = runTest {
        val api = Api(task("working")); val agent = MobileAgent(this, 1000)
        agent.attach(api, "session"); runCurrent()
        assertTrue(agent.state.value.available); assertEquals(AgentState.WORKING, agent.state.value.selected?.state)
        api.current = task("completed", ""","result":"Rolled back."""")
        advanceTimeBy(1100); runCurrent()
        assertEquals(AgentState.COMPLETED, agent.state.value.selected?.state); assertEquals("Rolled back.", agent.state.value.selected?.result)
        val reads = api.reads; advanceTimeBy(10_000); runCurrent(); assertEquals(reads, api.reads)
        agent.detach(); assertFalse(agent.state.value.available)
    }
    @Test fun `a decision is sent once with one key and an expired or unrelated task is never decided`() = runTest {
        val api = Api(task("awaiting_approval", approval("2099-10-10T01:08:00.000Z"))); val agent = MobileAgent(this, 1000)
        agent.attach(api, "session"); runCurrent()
        api.current = task("deciding", approval("2099-10-10T01:08:00.000Z")); agent.decide(id, true); runCurrent()
        assertEquals(1, api.decisions.size); assertTrue(api.decisions[0].second); assertTrue(uuid(api.decisions[0].third))
        agent.decide("00000000-0000-4000-8000-000000000000", true); runCurrent(); assertEquals(1, api.decisions.size)
        val stale = Api(task("awaiting_approval", approval("2026-10-10T01:08:00.000Z"))); val late = MobileAgent(this, 1000); late.attach(stale, "s"); runCurrent()
        late.decide(id, true); runCurrent(); assertEquals(0, stale.decisions.size)
        agent.detach(); late.detach()
    }
    @Test fun `a failed send is shown and never resent automatically`() = runTest {
        val api = Api(task("working")); api.fail = MobileFailure(Failure.OFFLINE); val agent = MobileAgent(this, 1000)
        agent.attach(api, "session"); runCurrent(); agent.send("  Fix it  ", "en"); runCurrent()
        assertEquals(1, api.sent.size); assertEquals("Fix it", api.sent[0].first); assertEquals(Failure.OFFLINE, agent.state.value.failure); assertFalse(agent.state.value.busy)
        advanceTimeBy(10_000); runCurrent(); assertEquals(1, api.sent.size)
        agent.send("   ", "en"); runCurrent(); assertEquals(1, api.sent.size); agent.detach()
    }
    @Test fun `a server without the crew hides the feature instead of showing an error`() = runTest {
        val api = object : MobileAgentApi { override suspend fun agentTasks(): List<AgentTask> = throw MobileFailure(Failure.UNAVAILABLE)
            override suspend fun agentTask(id: String) = error("unused"); override suspend fun sendInstruction(instruction: String, language: String, key: String) = error("unused"); override suspend fun decideTask(id: String, approve: Boolean, key: String) = error("unused") }
        val agent = MobileAgent(this, 1000); agent.attach(api, "session"); runCurrent(); assertFalse(agent.state.value.available); agent.detach()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class FixtureAgentTest {
    private val key = "4d1ff454-d70d-484f-b506-fbf5230b0626"
    @Test fun `the synthetic crew walks from working to a decision and a report, only after approval`() = runTest {
        val api = FixtureAgentApi { time("2026-10-10T01:00:00Z").toEpochMilli() }
        val first = api.sendInstruction("Fix it", "en", key); first.validate()
        assertEquals(AgentState.WORKING, first.state); assertNull(first.approval)
        var task = first; repeat(6) { task = api.agentTask(first.id).also { it.validate() } }
        assertEquals(AgentState.AWAITING_APPROVAL, task.state); assertNull(task.result)
        val deciding = api.decideTask(first.id, true, key); assertEquals(AgentState.DECIDING, deciding.state); assertNull(deciding.result)
        repeat(3) { task = api.agentTask(first.id) }
        assertEquals(AgentState.COMPLETED, task.state); assertTrue(task.result!!.contains("shop-api-good")); assertTrue(task.state.terminal)
    }
    @Test fun `a rejection changes nothing and an unknown or already decided task is refused`() = runTest {
        val api = FixtureAgentApi { time("2026-10-10T01:00:00Z").toEpochMilli() }
        val task = api.sendInstruction("Fix it", "ko", key); repeat(6) { api.agentTask(task.id) }
        assertEquals(AgentState.REJECTED, api.decideTask(task.id, false, key).state)
        assertFailsWith<MobileFailure> { api.decideTask(task.id, true, key) }
        assertFailsWith<MobileFailure> { api.agentTask("00000000-0000-4000-8000-000000000000") }
    }
    @Test fun `deciding before the crew asks is refused`() = runTest {
        val api = FixtureAgentApi { time("2026-10-10T01:00:00Z").toEpochMilli() }
        val task = api.sendInstruction("Fix it", "en", key)
        assertFailsWith<MobileFailure> { api.decideTask(task.id, true, key) }
    }
}
