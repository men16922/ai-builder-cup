package app.mobileops.agent

import java.util.UUID
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NotificationTest {
    private fun data(id: String) =
        GcpNotification(
            "1",
            "gcp",
            "a".repeat(64),
            UUID.randomUUID().toString(),
            UUID.randomUUID().toString(),
            id,
            "1",
            "2026-10-10T02:00:00Z",
        )

    private class Api(
        val fixture: FixtureApi,
        var resolve: suspend (GcpNotification) -> Workflow = { fixture.detail(it.planId) },
    ) : MobileApi by fixture, MobileNotificationApi {
        override suspend fun notificationsConfigured() = true

        override suspend fun registerDevice(input: DeviceRegistration, key: String): DeviceReceipt =
            error("No implicit registration")

        override suspend fun revokeDevice(device: DeviceReceipt): DeviceReceipt =
            error("No implicit revocation")

        override suspend fun retireDevice(installationId: String, registrationKey: String) =
            error("No implicit retirement")

        override suspend fun resolveNotification(data: GcpNotification) = resolve(data)
    }

    @Test
    fun `notification data is strict string-only GCP locator and never includes an action`() =
        runTest {
            val fixture = FixtureApi.load("personal")
            val data = data(fixture.inbox("pending").items.first().id)
            val raw = wireJson.encodeToString(data)
            assertEquals(data, GcpNotification.parse(raw))
            for (invalid in
                listOf(
                    raw.replace("\"gcp\"", "\"aws\""),
                    raw.replace("\"schemaVersion\":\"1\"", "\"schemaVersion\":1"),
                    raw.replace("\"planVersion\":\"1\"", "\"planVersion\":1"),
                    raw.dropLast(1) + ",\"command\":\"execute\"}",
                    raw.replace(data.planId, "not-an-id"),
                )) assertFails { GcpNotification.parse(invalid) }
            assertFails { GcpNotification.parse(" ".repeat(4097)) }
            val registration =
                DeviceRegistration(
                    UUID.randomUUID().toString(),
                    null,
                    "synthetic-transport-address-12345",
                )
            assertFalse(registration.toString().contains(registration.token))
            assertFalse(NotificationPost("private body").toString().contains("private"))
            assertFails { NotificationConfiguration.parse("{\"configured\":\"true\"}") }
        }

    @Test
    fun `duplicate and out-of-order notifications fetch latest state and reset human confirmation without execution`() =
        runTest {
            val fixture = FixtureApi.load("personal")
            val api = Api(fixture)
            var reads = 0
            api.resolve = {
                reads++
                fixture.detail(it.planId)
            }
            val controller = MobileController()
            controller.connect(api)
            val payload = data(fixture.inbox("pending").items.first().id)
            controller.openNotification(payload)
            assertEquals("pending", controller.state.value.detail!!.plan.review.status)
            controller.reviewed(true)
            fixture.mutate(Mutation.create(Operation.APPROVE, fixture.detail(payload.planId)))
            controller.openNotification(payload)
            assertEquals("approved", controller.state.value.detail!!.plan.review.status)
            assertFalse(controller.state.value.reviewed)
            assertFalse(controller.can(Operation.EXECUTE))
            assertEquals(0, fixture.executions)
            assertEquals(2, reads)
            controller.refresh("all")
            assertTrue(controller.state.value.inbox!!.items.any { it.id == payload.planId })
        }

    @Test
    fun `late notification lookup after account or workspace switch never paints old evidence`() =
        runTest {
            val fixture = FixtureApi.load("personal")
            val release = CompletableDeferred<Workflow>()
            val api = Api(fixture) { release.await() }
            val controller = MobileController()
            controller.connect(api)
            val payload = data(fixture.inbox("pending").items.first().id)
            val pending = async { controller.openNotification(payload) }
            runCurrent()
            val next = FixtureApi.load("organization")
            controller.connect(next)
            controller.refresh()
            release.complete(fixture.detail(payload.planId))
            pending.await()
            assertEquals(next.scope, controller.state.value.scope)
            assertNull(controller.state.value.detail)
            assertNull(controller.state.value.original)
            assertEquals(next.scope.owner, controller.state.value.inbox!!.owner)
        }

    @Test
    fun `failed or revoked notification hides previous view and retains inbox as a manual fallback`() =
        runTest {
            val fixture = FixtureApi.load("personal")
            val api = Api(fixture)
            val controller = MobileController()
            controller.connect(api)
            val payload = data(fixture.inbox("pending").items.first().id)
            controller.openNotification(payload)
            controller.reviewed(true)
            for (failure in
                listOf(Failure.OFFLINE, Failure.DENIED, Failure.STALE, Failure.SIGN_IN)) {
                api.resolve = { throw MobileFailure(failure) }
                controller.openNotification(payload)
                assertEquals(failure, controller.state.value.failure)
                assertNull(controller.state.value.detail)
                assertNull(controller.state.value.original)
                assertFalse(controller.state.value.reviewed)
            }
            controller.refresh()
            assertNotNull(controller.state.value.inbox)
            assertEquals(0, fixture.executions)
        }

    @Test
    fun `notification HTTP keeps identity scope explicit null CAS and exact retry key and validates receipt types`() =
        runTest {
            val fixture = FixtureApi.load("personal")
            val installation = UUID.randomUUID().toString()
            val generation = UUID.randomUUID().toString()
            val input = DeviceRegistration(installation, null, "synthetic-transport-address-12345")
            val key = UUID.randomUUID().toString()
            var receipt =
                wireJson.encodeToString(
                    DeviceReceipt(installation, generation, true, "2026-10-10T02:00:00Z"),
                )
            var requests = 0
            val identity =
                object : IdentityPort {
                    override val actorId = fixture.scope.actorId

                    override suspend fun tokenFor(actorId: String) = "synthetic-id-token"
                }
            val client =
                GcpMobileClient(
                    "https://mobile.example",
                    fixture.scope,
                    identity,
                    HttpPort { url, token, post ->
                        requests++
                        assertEquals(fixture.scope.path + "/devices", url.path)
                        assertEquals("synthetic-id-token", token)
                        assertEquals(key, post!!.key)
                        val body = wireJson.parseToJsonElement(post.body).jsonObject
                        assertEquals(
                            setOf("installationId", "expectedGeneration", "token"),
                            body.keys,
                        )
                        assertEquals(JsonNull, body["expectedGeneration"])
                        HttpReply(200, "application/json", receipt)
                    },
                )
            assertEquals(generation, client.registerDevice(input, key).generation)
            assertEquals(generation, client.registerDevice(input, key).generation)
            receipt = receipt.replace("\"active\":true", "\"active\":\"true\"")
            assertEquals(
                Failure.INVALID_RESPONSE,
                assertFailsWith<MobileFailure> { client.registerDevice(input, key) }.reason,
            )
            assertEquals(3, requests)
        }
}
