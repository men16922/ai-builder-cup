package app.mobileops.agent

import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class IdentityTest {
    private val config =
        FirebaseConfiguration(
            "example-mobileops-demo",
            "synthetic-public-android-key-1234567890",
            "1:000000000000:android:0000000000000000",
            "000000000000-synthetic.apps.googleusercontent.com",
        )

    private fun configuration() =
        MobileConfiguration(
            1,
            true,
            "https://mobile.example",
            config,
            listOf(
                WorkspaceConfiguration("personal", "personal", "synthetic-preview", "Personal"),
                WorkspaceConfiguration(
                    "team",
                    "organization",
                    "synthetic-preview",
                    "Team",
                    "synthetic-example",
                ),
            ),
        )

    private class Port : FirebaseSessionPort {
        override var user: FirebaseSession? = FirebaseSession("synthetic-user", null, "session-1")
        var token =
            FirebaseToken(
                "synthetic-firebase-token",
                "https://securetoken.google.com/example-mobileops-demo",
                "example-mobileops-demo",
                "synthetic-user",
                null,
                2000,
                900,
                800,
            )
        var calls = 0
        var closed = false
        var release: CompletableDeferred<Unit>? = null
        private val listeners = mutableListOf<() -> Unit>()

        override fun subscribe(listener: () -> Unit): AutoCloseable {
            listeners += listener
            listener()
            return AutoCloseable { listeners -= listener }
        }

        override suspend fun tokenFor(user: FirebaseSession): FirebaseToken {
            calls++
            release?.await()
            return token
        }

        fun change(value: FirebaseSession?) {
            user = value
            listeners.toList().forEach { it() }
        }

        override fun close() {
            closed = true
            change(null)
        }
    }

    @Serializable
    private data class ActorVector(
        val projectId: String,
        val tenantId: String?,
        val uid: String,
        val actorId: String,
    )

    @Test
    fun `actor mapping matches server generated UTF8 JSON SHA256 vectors`() {
        val vectors =
            wireJson.decodeFromString<List<ActorVector>>(
                javaClass
                    .getResourceAsStream("/firebase-actors.json")!!
                    .bufferedReader()
                    .readText(),
            )
        vectors.forEach {
            assertEquals(it.actorId, firebaseActor(it.projectId, it.tenantId, it.uid))
        }
        assertEquals(vectors.size, vectors.map { it.actorId }.distinct().size)
    }

    @Test
    fun `configuration is explicit fixed HTTPS and rejects authority credential and role overrides`() {
        assertNull(readMobileConfiguration(null))
        assertNull(readMobileConfiguration("{\"configured\":false}"))
        val valid =
            wireJson
                .encodeToJsonElement(MobileConfiguration.serializer(), configuration())
                .jsonObject
        assertEquals(configuration(), readMobileConfiguration(valid.toString()))
        for (origin in
            listOf(
                "http://localhost",
                "https://user:pass@mobile.example",
                "https://mobile.example/path",
                "https://mobile.example/?token=x",
                "https://mobile.example#frag",
                "https://mobile.example:8443",
            )) assertFailsWith<IllegalArgumentException> {
            readMobileConfiguration(
                JsonObject(valid + ("origin" to JsonPrimitive(origin))).toString(),
            )
        }
        for (field in
            listOf("credentials", "role", "provider", "endpoint", "token")) assertFailsWith<
            IllegalArgumentException,
        > {
            readMobileConfiguration(
                JsonObject(valid + (field to JsonPrimitive("forbidden"))).toString(),
            )
        }
        assertFailsWith<IllegalArgumentException> {
            readMobileConfiguration("{\"configured\":false,\"origin\":\"https://mobile.example\"}")
        }
        assertFailsWith<IllegalArgumentException> {
            configuration()
                .copy(workspaces = configuration().workspaces + configuration().workspaces.first())
                .validate()
        }
        assertFailsWith<IllegalArgumentException> { config.copy(appId = "1:1:web:abcd").validate() }
        assertFailsWith<IllegalArgumentException> {
            WorkspaceConfiguration("x", "personal", "work", "Label", "injected-org").validate()
        }
    }

    @Test
    fun `Firebase token checks issuer audience tenant subject time and redacts its string`() =
        runTest {
            val port = Port()
            val identity = FirebaseIdentity(config, port) { 1000000 }
            val actor = identity.actorId!!
            assertEquals("synthetic-firebase-token", identity.tokenFor(actor))
            assertFalse(port.token.toString().contains(port.token.value))
            val invalid =
                listOf(
                    FirebaseToken(
                        "x",
                        "https://evil.example",
                        config.projectId,
                        "synthetic-user",
                        null,
                        2000,
                        900,
                        800,
                    ),
                    FirebaseToken(
                        "x",
                        "https://securetoken.google.com/${config.projectId}",
                        "other-project",
                        "synthetic-user",
                        null,
                        2000,
                        900,
                        800,
                    ),
                    FirebaseToken(
                        "x",
                        "https://securetoken.google.com/${config.projectId}",
                        config.projectId,
                        "other-user",
                        null,
                        2000,
                        900,
                        800,
                    ),
                    FirebaseToken(
                        "x",
                        "https://securetoken.google.com/${config.projectId}",
                        config.projectId,
                        "synthetic-user",
                        "tenant-a",
                        2000,
                        900,
                        800,
                    ),
                    FirebaseToken(
                        "x",
                        "https://securetoken.google.com/${config.projectId}",
                        config.projectId,
                        "synthetic-user",
                        null,
                        999,
                        900,
                        800,
                    ),
                    FirebaseToken(
                        "x",
                        "https://securetoken.google.com/${config.projectId}",
                        config.projectId,
                        "synthetic-user",
                        null,
                        2000,
                        1100,
                        800,
                    ),
                    FirebaseToken(
                        "x",
                        "https://securetoken.google.com/${config.projectId}",
                        config.projectId,
                        "synthetic-user",
                        null,
                        2000,
                        900,
                        901,
                    ),
                    FirebaseToken(
                        "x\r\nprivate",
                        "https://securetoken.google.com/${config.projectId}",
                        config.projectId,
                        "synthetic-user",
                        null,
                        2000,
                        900,
                        800,
                    ),
                )
            for (token in invalid) {
                port.token = token
                assertEquals(
                    Failure.SIGN_IN,
                    assertFailsWith<MobileFailure> { identity.tokenFor(actor) }.reason,
                )
            }
            port.change(FirebaseSession("synthetic-user", "wrong-tenant", "other"))
            assertNull(identity.actorId)
            identity.close()
            assertTrue(port.closed)
            assertNull(identity.session)
        }

    @Test
    fun `a logout login with the same UID cannot release a stale token`() = runTest {
        val port = Port()
        port.release = CompletableDeferred()
        val identity = FirebaseIdentity(config, port) { 1000000 }
        val actor = identity.actorId!!
        val result = async { runCatching { identity.tokenFor(actor) } }
        runCurrent()
        port.change(FirebaseSession("synthetic-user", null, "session-2"))
        port.release!!.complete(Unit)
        assertEquals(Failure.SIGN_IN, (result.await().exceptionOrNull() as MobileFailure).reason)
    }

    @Test
    fun `live setup does not create SDK or client until explicit login and membership remains server owned`() =
        runTest {
            var identities = 0
            var clients = 0
            val port = Port()
            val controller = MobileController()
            val access =
                LiveAccess(
                    configuration(),
                    controller,
                    {
                        identities++
                        FirebaseIdentity(config, port) { 1000000 }
                    },
                ) { origin, scope, _ ->
                    clients++
                    assertEquals("https://mobile.example", origin)
                    assertEquals("organization", scope.owner.kind)
                    object : MobileApi by FixtureApi.load("organization") {
                        override val scope = scope

                        override suspend fun inbox(filter: String, cursor: String?): Inbox =
                            throw MobileFailure(Failure.DENIED)
                    }
                }
            assertEquals(0, identities)
            assertEquals(0, clients)
            assertNull(controller.state.value.scope)
            access.signIn("team") { assertNotNull(it.session) }
            assertEquals(1, identities)
            assertEquals(1, clients)
            assertEquals(Failure.DENIED, controller.state.value.failure)
            assertNull(controller.state.value.inbox)
            access.leave()
            assertNull(controller.state.value.scope)
            assertTrue(port.closed)
        }

    @Test
    fun `late login after leave cannot reconnect and fresh login has an independent session`() =
        runTest {
            val controller = MobileController()
            val ports = mutableListOf<Port>()
            val release = CompletableDeferred<Unit>()
            var clients = 0
            val access =
                LiveAccess(
                    configuration(),
                    controller,
                    {
                        Port().also { ports += it }.let { FirebaseIdentity(config, it) { 1000000 } }
                    },
                ) { _, _, _ ->
                    clients++
                    FixtureApi.load("organization")
                }
            val first = async { access.signIn("team") { release.await() } }
            runCurrent()
            assertTrue(access.state.value.busy)
            access.leave()
            access.signIn("team") {}
            assertEquals(1, clients)
            assertNotNull(controller.state.value.inbox)
            release.complete(Unit)
            first.await()
            assertEquals(1, clients)
            assertTrue(ports[0].closed)
            assertFalse(ports[1].closed)
            ports[1].change(FirebaseSession("other-user", null, "replacement"))
            assertNull(controller.state.value.scope)
            assertEquals(Failure.SIGN_IN, access.state.value.failure)
        }

    @Test
    fun `login failure and token rejection hide previous data without fallback to a fixture`() =
        runTest {
            val controller = MobileController()
            controller.connect(FixtureApi.load("personal"))
            controller.refresh()
            val port = Port()
            val access =
                LiveAccess(
                    configuration(),
                    controller,
                    { FirebaseIdentity(config, port) { 1000000 } },
                ) { _, scope, _ ->
                    object : MobileApi by FixtureApi.load("personal") {
                        override val scope = scope

                        override suspend fun inbox(filter: String, cursor: String?): Inbox =
                            throw MobileFailure(Failure.SIGN_IN)
                    }
                }
            access.signIn("personal") {}
            assertTrue(port.closed)
            assertNull(controller.state.value.scope)
            assertNull(controller.state.value.inbox)
            val another =
                LiveAccess(configuration(), controller, { FirebaseIdentity(config, Port()) })
            another.signIn("personal") { throw IllegalStateException("private SDK error") }
            assertEquals(Failure.SIGN_IN, another.state.value.failure)
            assertFalse(another.state.value.toString().contains("private"))
        }

    @Test
    fun `failed listener cleanup still closes identity and clears the whole workspace`() = runTest {
        val controller = MobileController()
        val port = Port()
        var closeCalls = 0
        val bridge = FirebaseIdentity(config, port) { 1000000 }
        val identity =
            object : SessionIdentity by bridge {
                override fun subscribe(listener: () -> Unit): AutoCloseable {
                    val subscription = bridge.subscribe(listener)
                    return AutoCloseable {
                        subscription.close()
                        throw IllegalStateException("private cleanup failure")
                    }
                }

                override fun close() {
                    closeCalls++
                    bridge.close()
                    throw IllegalStateException("private SDK failure")
                }
            }
        val access =
            LiveAccess(configuration(), controller, { identity }) { _, _, _ ->
                FixtureApi.load("personal")
            }
        access.signIn("personal") {}
        assertNotNull(controller.state.value.inbox)
        access.leave()
        assertEquals(1, closeCalls)
        assertTrue(port.closed)
        assertNull(controller.state.value.scope)
        assertNull(controller.state.value.inbox)
        assertEquals(LiveAccessState(), access.state.value)
        access.leave()
        assertEquals(1, closeCalls)
    }

    @Test
    fun `cancelling the login job closes its session and cannot bind HTTP`() = runTest {
        val controller = MobileController()
        val port = Port()
        var clients = 0
        val access =
            LiveAccess(
                configuration(),
                controller,
                { FirebaseIdentity(config, port) { 1000000 } },
            ) { _, _, _ ->
                clients++
                FixtureApi.load("personal")
            }
        val pending = async { access.signIn("personal") { CompletableDeferred<Unit>().await() } }
        runCurrent()
        assertTrue(access.state.value.busy)
        pending.cancel()
        pending.join()
        assertTrue(port.closed)
        assertEquals(0, clients)
        assertNull(controller.state.value.scope)
        assertEquals(LiveAccessState(), access.state.value)
    }
}
