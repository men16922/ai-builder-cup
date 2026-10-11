package app.mobileops.agent

import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.encodeToString
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class NotificationLifecycleTest {
    private val at = time("2026-10-10T01:00:00Z").toEpochMilli()
    private class Source : PushTokenSource {
        var value = "synthetic-push-address-123456789"; var reads = 0; var closes = 0; var unsubscribe = 0
        var release: CompletableDeferred<Unit>? = null; var badClose = false
        var listener: (() -> Unit)? = null
        override suspend fun token(): String { reads++; release?.await(); return value }
        override fun subscribe(changed: () -> Unit): AutoCloseable { listener = changed; return AutoCloseable { unsubscribe++; listener = null; if (badClose) error("private subscription failure") } }
        override fun close() { closes++; if (badClose) error("private source failure") }
        fun changed() { listener?.invoke() }
    }
    private class Api(val fixture: FixtureApi, val now: () -> Long) : MobileApi by fixture, MobileNotificationApi {
        var configured = true; var configReads = 0; var resolved = 0
        val requests = mutableListOf<Pair<DeviceRegistration, String>>()
        val retired = mutableSetOf<String>(); val history = mutableMapOf<String, Pair<DeviceRegistration, DeviceReceipt>>()
        val devices = mutableMapOf<String, DeviceReceipt>()
        var beforeRegister: suspend () -> Unit = {}; var afterRegister: suspend () -> Unit = {}; var beforeRetire: suspend () -> Unit = {}
        override suspend fun notificationsConfigured(): Boolean { configReads++; return configured }
        override suspend fun registerDevice(input: DeviceRegistration, key: String): DeviceReceipt {
            requests += input to key; beforeRegister()
            if (retired.contains(key)) throw MobileFailure(Failure.STALE)
            history[key]?.let { require(it.first == input); return it.second }
            if (input.expectedGeneration != devices[input.installationId]?.generation) throw MobileFailure(Failure.STALE)
            val result = DeviceReceipt(input.installationId, UUID.randomUUID().toString(), true, java.time.Instant.ofEpochMilli(now() + 3600000).toString())
            devices[input.installationId] = result; history[key] = input to result; afterRegister(); return result
        }
        override suspend fun revokeDevice(device: DeviceReceipt): DeviceReceipt = device.copy(active = false).also { devices[it.installationId] = it }
        override suspend fun retireDevice(installationId: String, registrationKey: String) {
            beforeRetire(); retired += registrationKey
            val record = history[registrationKey]?.second
            if (record != null && record.installationId == installationId && devices[installationId]?.generation == record.generation) devices[installationId] = record.copy(active = false)
        }
        override suspend fun resolveNotification(data: GcpNotification): Workflow { resolved++; return fixture.detail(data.planId) }
    }
    private fun configuration() = MobileConfiguration(1, true, "https://mobile.example",
        FirebaseConfiguration("example-mobileops-demo", "synthetic-public-android-key-1234567890", "1:000000000000:android:0000000000000000", "000000000000-synthetic.apps.googleusercontent.com"),
        listOf(WorkspaceConfiguration("personal", "personal", "synthetic-preview", "Personal")))

    @Test fun `login and foreground are inert until enable then token changes and expiry renew a single installation`() = runTest {
        var now = at; var created = 0; val source = Source(); val api = Api(FixtureApi.load("personal")) { now }
        val notices = MobileNotifications(this, { created++; source }) { now }
        notices.attach(api, "session-one"); notices.refresh()
        assertEquals(0, created); assertEquals(0, api.configReads); assertTrue(api.requests.isEmpty())
        notices.enableOrRetry(); assertTrue(notices.state.value.enabled); assertEquals(1, created); assertEquals(1, api.requests.size)
        source.changed(); source.changed(); runCurrent(); assertEquals(1, api.requests.size)
        source.value += "rotated"; source.changed(); runCurrent(); assertEquals(2, api.requests.size)
        assertEquals(api.requests[0].first.installationId, api.requests[1].first.installationId)
        assertEquals(api.history[api.requests[0].second]!!.second.generation, api.requests[1].first.expectedGeneration)
        now += 3540001; notices.refresh(); assertEquals(3, api.requests.size)
        notices.disable(); assertFalse(notices.state.value.enabled); assertEquals(1, source.closes); assertEquals(1, source.unsubscribe)
        assertFalse(api.devices.values.single().active); assertFalse(notices.state.value.cleanupUnknown)
    }
    @Test fun `lost registration response is not automatically retried and explicit recovery keeps exact body and key`() = runTest {
        val source = Source(); val api = Api(FixtureApi.load("personal")) { at }; var lose = true
        api.afterRegister = { if (lose) { lose = false; throw MobileFailure(Failure.OFFLINE) } }
        val notices = MobileNotifications(this, { source }) { at }; notices.attach(api, "session"); notices.enableOrRetry()
        assertTrue(notices.state.value.uncertain); assertFalse(notices.state.value.enabled)
        source.value += "new"; source.changed(); notices.refresh(); runCurrent(); assertEquals(1, api.requests.size)
        notices.enableOrRetry(); assertTrue(notices.state.value.enabled); assertFalse(notices.state.value.uncertain)
        assertEquals(api.requests[0], api.requests[1]); notices.refresh(); assertEquals(3, api.requests.size)
        assertNotEquals(api.requests[0].second, api.requests[2].second); notices.disable()
    }
    @Test fun `disable retires an in-flight registration before its receipt exists and a late request cannot resurrect it`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val source = Source(); val release = CompletableDeferred<Unit>()
        api.beforeRegister = { release.await() }
        val notices = MobileNotifications(this, { source }) { at }; notices.attach(api, "session")
        val pending = async { notices.enableOrRetry() }; runCurrent(); assertTrue(notices.state.value.busy)
        notices.disable(); assertTrue(api.retired.contains(api.requests.single().second)); assertFalse(notices.state.value.cleanupUnknown)
        release.complete(Unit); pending.await(); assertTrue(api.devices.isEmpty()); assertFalse(notices.state.value.enabled)
        assertNull(notices.state.value.failure); assertEquals(1, source.closes)
    }
    @Test fun `disable retires both the confirmed generation and an uncertain renewal`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val source = Source()
        val notices = MobileNotifications(this, { source }) { at }; notices.attach(api, "session"); notices.enableOrRetry()
        val release = CompletableDeferred<Unit>(); api.beforeRegister = { release.await() }
        source.value += "new"; source.changed(); runCurrent(); assertEquals(2, api.requests.size)
        notices.disable(); assertEquals(api.requests.map { it.second }.toSet(), api.retired)
        release.complete(Unit); runCurrent(); assertFalse(api.devices.values.single().active); assertFalse(notices.state.value.enabled)
    }
    @Test fun `switching session during token lookup stops the old SDK and never registers old account data`() = runTest {
        val old = Api(FixtureApi.load("personal")) { at }; val next = Api(FixtureApi.load("organization")) { at }
        val oldSource = Source().apply { release = CompletableDeferred() }; val nextSource = Source(); var sources = 0
        val notices = MobileNotifications(this, { if (++sources == 1) oldSource else nextSource }) { at }
        notices.attach(old, "old"); val pending = async { notices.enableOrRetry() }; runCurrent()
        val retirement = notices.detach(); notices.attach(next, "new"); assertTrue(retirement.finish()); notices.enableOrRetry()
        oldSource.release!!.complete(Unit); pending.await()
        assertTrue(old.requests.isEmpty()); assertEquals(1, next.requests.size); assertTrue(notices.state.value.enabled)
        assertEquals(1, oldSource.closes); notices.disable()
    }
    @Test fun `source cleanup failure does not skip the other cleanup or server retirement and reports unknown`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val source = Source()
        val notices = MobileNotifications(this, { source }) { at }; notices.attach(api, "session"); notices.enableOrRetry(); source.badClose = true
        notices.disable(); assertEquals(1, source.closes); assertEquals(1, source.unsubscribe); assertEquals(1, api.retired.size)
        assertTrue(notices.state.value.cleanupUnknown); assertFalse(notices.state.value.toString().contains("private"))
    }
    @Test fun `missing server configuration never initializes a token source and forced auth loss only clears local authority`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; var sources = 0
        val notices = MobileNotifications(this, { sources++; Source() }) { at }; notices.attach(api, "session")
        api.configured = false; notices.enableOrRetry(); assertEquals(0, sources); assertTrue(api.requests.isEmpty())
        api.configured = true; notices.enableOrRetry(); assertEquals(1, sources)
        notices.abandon(); assertTrue(notices.state.value.cleanupUnknown); assertFalse(notices.state.value.enabled); assertTrue(api.retired.isEmpty())
    }
    @Test fun `normal live logout hides the view immediately retires registrations then closes the old identity`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val source = Source(); val controller = MobileController()
        val notices = MobileNotifications(this, { source }) { at }; var closed = false
        val identity = object : SessionIdentity {
            override val session get() = if (closed) null else IdentitySession(api.scope.actorId, "session")
            override val actorId get() = session?.actorId
            override suspend fun tokenFor(actorId: String) = "synthetic-token"
            override fun subscribe(listener: () -> Unit) = AutoCloseable {}
            override fun close() { closed = true }
        }
        val access = LiveAccess(configuration(), controller, { identity }, notices) { _, _, _ -> api }
        access.signIn("personal") {}; notices.enableOrRetry(); val release = CompletableDeferred<Unit>()
        api.beforeRetire = { assertFalse(closed); release.await() }
        val logout = async { access.signOut() }; runCurrent()
        assertNull(controller.state.value.scope); assertFalse(notices.state.value.enabled); assertFalse(closed)
        release.complete(Unit); assertTrue(logout.await()); assertTrue(closed); assertEquals(1, api.retired.size)
        assertFalse(access.state.value.cleanupUnknown)
    }
    @Test fun `logout retirement timeout closes identity and distinguishes unconfirmed server cleanup`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val controller = MobileController(); val notices = MobileNotifications(this, { Source() }) { at }; var closed = false
        val identity = object : SessionIdentity {
            override val session get() = if (closed) null else IdentitySession(api.scope.actorId, "session")
            override val actorId get() = session?.actorId
            override suspend fun tokenFor(actorId: String) = "synthetic"
            override fun subscribe(listener: () -> Unit) = AutoCloseable {}
            override fun close() { closed = true }
        }
        val access = LiveAccess(configuration(), controller, { identity }, notices) { _, _, _ -> api }
        access.signIn("personal") {}; notices.enableOrRetry(); api.beforeRetire = { CompletableDeferred<Unit>().await() }
        val logout = async { access.signOut() }; runCurrent(); advanceTimeBy(2001); runCurrent(); logout.await()
        assertTrue(closed); assertTrue(access.state.value.cleanupUnknown); assertNull(controller.state.value.scope)
    }
    @Test fun `cold notification intent is inert until explicit open and navigation never survives logout clear`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val controller = MobileController(); val navigation = NotificationNavigation(controller)
        val planId = api.inbox("pending").items.first().id
        val data = GcpNotification("1", "gcp", "a".repeat(64), UUID.randomUUID().toString(), UUID.randomUUID().toString(), planId, "1", "2026-10-10T02:00:00Z")
        assertTrue(navigation.receive(wireJson.encodeToString(data))); assertTrue(navigation.available.value)
        navigation.open(); assertEquals(0, api.resolved); assertNull(controller.state.value.scope)
        controller.connect(api); controller.refresh(); assertEquals(0, api.resolved)
        navigation.open(); assertEquals(1, api.resolved); assertFalse(navigation.available.value); assertEquals(planId, controller.state.value.selectedId)
        assertFalse(controller.state.value.reviewed); assertEquals(0, api.fixture.executions)
        navigation.receive(wireJson.encodeToString(data)); navigation.clear(); controller.connect(null); navigation.open(); assertFalse(navigation.available.value)
        assertFalse(navigation.receive(wireJson.encodeToString(data).dropLast(1) + ",\"origin\":\"https://other.example\"}"))
    }
    @Test fun `a new login while old retirement is pending retains uncertainty and old cleanup cannot close the new identity`() = runTest {
        val api = Api(FixtureApi.load("personal")) { at }; val controller = MobileController()
        val notices = MobileNotifications(this, { Source() }) { at }; val closed = mutableListOf<Boolean>()
        val access = LiveAccess(configuration(), controller, {
            val index = closed.size; closed += false
            object : SessionIdentity {
                override val session get() = if (closed[index]) null else IdentitySession(api.scope.actorId, "session-$index")
                override val actorId get() = session?.actorId
                override suspend fun tokenFor(actorId: String) = "synthetic"
                override fun subscribe(listener: () -> Unit) = AutoCloseable {}
                override fun close() { closed[index] = true }
            }
        }, notices) { _, _, _ -> api }
        access.signIn("personal") {}; notices.enableOrRetry()
        val release = CompletableDeferred<Unit>(); api.beforeRetire = { release.await(); throw MobileFailure(Failure.OFFLINE) }
        val retiring = async { access.signOut() }; runCurrent()
        access.leave(); access.signIn("personal") {}
        assertNotNull(access.state.value.workspace); assertTrue(access.state.value.cleanupUnknown); assertFalse(closed[1])
        release.complete(Unit); assertFalse(retiring.await())
        assertTrue(closed[0]); assertFalse(closed[1]); assertNotNull(controller.state.value.scope)
        assertTrue(access.state.value.cleanupUnknown); assertNotNull(access.state.value.workspace)
        access.leave()
    }
}
