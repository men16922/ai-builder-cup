package app.mobileops.agent

import kotlin.test.*
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import org.junit.Assume.assumeNotNull

class ServerIntegrationTest {
    @Test
    fun `lifecycle retires a real local HTTP registration after its successful response is lost`() =
        runBlocking {
            val origin = System.getenv("MOBILEOPS_MOBILE_TEST_ORIGIN")
            assumeNotNull(origin)
            val scope = FixtureApi.load("organization").scope
            val identity =
                object : IdentityPort {
                    override val actorId = scope.actorId

                    override suspend fun tokenFor(actorId: String) = "synthetic-mobile-token"
                }
            val transport = UrlConnectionPort()
            var lost = false
            var original: DeviceRegistration? = null
            var originalKey: String? = null
            val api =
                GcpMobileClient(
                    origin!!,
                    scope,
                    identity,
                    HttpPort { url, token, post ->
                        val response = transport.request(url, token, post)
                        if (
                            url.path.endsWith("/devices") &&
                                post != null &&
                                !lost &&
                                response.status == 200
                        ) {
                            lost = true
                            original = wireJson.decodeFromString<DeviceRegistration>(post.body)
                            originalKey = post.key
                            throw MobileFailure(Failure.OFFLINE)
                        }
                        response
                    },
                    allowLoopback = true,
                )
            var closed = false
            val notices =
                MobileNotifications(
                    this,
                    {
                        object : PushTokenSource {
                            override suspend fun token() =
                                "synthetic-native-lifecycle-address-123456789"

                            override fun subscribe(changed: () -> Unit) = AutoCloseable {}

                            override fun close() {
                                closed = true
                            }
                        }
                    },
                ) {
                    time("2026-10-10T01:00:00Z").toEpochMilli()
                }
            notices.attach(api, "synthetic-live-session")
            notices.enableOrRetry()
            assertTrue(notices.state.value.uncertain)
            notices.disable()
            assertTrue(closed)
            assertFalse(notices.state.value.cleanupUnknown)
            assertFalse(notices.state.value.enabled)
            assertEquals(
                Failure.STALE,
                assertFailsWith<MobileFailure> { api.registerDevice(original!!, originalKey!!) }
                    .reason,
            )
        }

    @Test
    fun `native notification registration CAS revocation and latest detail use the real local API`() =
        runTest {
            val origin = System.getenv("MOBILEOPS_MOBILE_TEST_ORIGIN")
            val raw = System.getenv("MOBILEOPS_MOBILE_NOTIFICATION_JSON")
            assumeNotNull(origin, raw)
            val scope = FixtureApi.load("organization").scope
            val identity =
                object : IdentityPort {
                    override val actorId = scope.actorId

                    override suspend fun tokenFor(actorId: String) = "synthetic-mobile-token"
                }
            val api = GcpMobileClient(origin!!, scope, identity, allowLoopback = true)
            assertTrue(api.notificationsConfigured())
            val input =
                DeviceRegistration(
                    java.util.UUID.randomUUID().toString(),
                    null,
                    "synthetic-native-extra-address-12345678",
                )
            val key = java.util.UUID.randomUUID().toString()
            val device = api.registerDevice(input, key)
            assertEquals(device, api.registerDevice(input, key))
            assertFalse(api.revokeDevice(device).active)
            assertEquals(
                Failure.STALE,
                assertFailsWith<MobileFailure> { api.registerDevice(input, key) }.reason,
            )
            val data = GcpNotification.parse(raw!!)
            val opened = api.resolveNotification(data)
            assertEquals(api.detail(data.planId), opened)
            val controller = MobileController()
            controller.connect(api)
            controller.openNotification(data)
            assertEquals(data.planId, controller.state.value.selectedId)
            assertNotNull(controller.state.value.original)
            assertFalse(controller.state.value.reviewed)
        }

    @Test
    fun `Firebase derived personal identity matches actual server verifier and ownership`() =
        runTest {
            val origin = System.getenv("MOBILEOPS_MOBILE_TEST_ORIGIN")
            assumeNotNull(origin)
            val config =
                FirebaseConfiguration(
                    "example-mobileops-demo",
                    "synthetic-public-android-key-1234567890",
                    "1:000000000000:android:0000000000000000",
                    "000000000000-synthetic.apps.googleusercontent.com",
                )
            val at = time("2026-10-10T01:00:00Z").toEpochMilli()
            val port =
                object : FirebaseSessionPort {
                    override var user: FirebaseSession? =
                        FirebaseSession("synthetic-native-user", null, "synthetic-session")

                    override fun subscribe(listener: () -> Unit): AutoCloseable {
                        listener()
                        return AutoCloseable {}
                    }

                    override suspend fun tokenFor(user: FirebaseSession) =
                        FirebaseToken(
                            "synthetic-firebase-token",
                            "https://securetoken.google.com/${config.projectId}",
                            config.projectId,
                            user.uid,
                            null,
                            at / 1000 + 3600,
                            at / 1000 - 30,
                            at / 1000 - 60,
                        )

                    override fun close() {
                        user = null
                    }
                }
            val identity = FirebaseIdentity(config, port) { at }
            val scope =
                WorkspaceConfiguration(
                        "my",
                        "personal",
                        "synthetic-firebase-workspace",
                        "My workspace",
                    )
                    .scope(identity.actorId!!)
            val api = GcpMobileClient(origin!!, scope, identity, allowLoopback = true)
            val inbox = api.inbox("pending")
            assertEquals(scope.owner, inbox.owner)
            assertEquals(1, inbox.items.size)
            val view = api.detail(inbox.items.single().id)
            val approved = api.mutate(Mutation.create(Operation.APPROVE, view))
            assertNull(approved.execution)
            val request = Mutation.create(Operation.EXECUTE, approved)
            val result = api.mutate(request)
            assertEquals("succeeded", result.execution!!.state)
            assertEquals(scope.owner, result.execution.binding.owner)
            assertEquals(result.execution.id, api.mutate(request).execution!!.id)
            identity.close()
            assertEquals(
                Failure.SIGN_IN,
                assertFailsWith<MobileFailure> { api.detail(view.plan.payload.planId) }.reason,
            )
        }

    @Test
    fun `Kotlin native client continues actual server workflow and replay through a fresh client`() =
        runTest {
            val origin = System.getenv("MOBILEOPS_MOBILE_TEST_ORIGIN")
            assumeNotNull(origin)
            val scope = FixtureApi.load("organization").scope
            val identity =
                object : IdentityPort {
                    override val actorId = scope.actorId

                    override suspend fun tokenFor(actorId: String) = "synthetic-mobile-token"
                }
            fun client() = GcpMobileClient(origin!!, scope, identity, allowLoopback = true)
            val api = client()
            val inbox = api.inbox("pending")
            assertEquals(1, inbox.items.size)
            val id = inbox.items.single().id
            val view = api.detail(id)
            assertEquals(6, api.original(view.plan.payload).facts.size)
            val decision = Mutation.create(Operation.APPROVE, view, "Native Kotlin review")
            val approved = api.mutate(decision)
            assertNull(approved.execution)
            assertEquals("approved", approved.plan.review.status)
            val request = Mutation.create(Operation.EXECUTE, approved)
            val executed = api.mutate(request)
            assertEquals("succeeded", executed.execution!!.state)
            assertEquals("partial", executed.execution.result!!.coverage)
            assertEquals("unknown", executed.execution.result.serviceAssessment)
            val handoff = Mutation.create(Operation.HANDOFF, executed, "Native Kotlin handoff")
            val handed = api.mutate(handoff)
            assertEquals(1, handed.execution!!.handoffs.size)
            val fresh = client()
            assertEquals(executed.execution.id, fresh.mutate(request).execution!!.id)
            assertEquals(1, fresh.mutate(handoff).execution!!.handoffs.size)
            assertEquals(id, fresh.inbox("results").items.single().id)
            assertEquals(
                "Native Kotlin handoff",
                fresh.detail(id).execution!!.handoffs.single().note,
            )
            val other =
                GcpMobileClient(
                    origin!!,
                    scope.copy(owner = Owner("organization", organizationId = "other-org")),
                    identity,
                    allowLoopback = true,
                )
            assertEquals(Failure.DENIED, assertFailsWith<MobileFailure> { other.detail(id) }.reason)
        }
}
