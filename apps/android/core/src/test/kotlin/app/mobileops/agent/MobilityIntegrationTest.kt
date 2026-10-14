package app.mobileops.agent

import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.MobilityState
import java.util.UUID
import kotlin.test.*
import kotlinx.coroutines.runBlocking
import org.junit.Assume.assumeNotNull
import org.junit.Test

/**
 * Actual Kotlin DTO/command → native HTTP → authenticated gateway/store. Google providers are
 * synthetic.
 */
class MobilityIntegrationTest {
    @Test
    fun `unknown incident is guided then separately promoted and a fresh recurrence responds automatically`() =
        runBlocking {
            val origin = System.getenv("MOBILEOPS_MOBILE_TEST_ORIGIN")
            assumeNotNull(origin)
            val scope = FixtureApi.load("organization").scope
            val identity =
                object : IdentityPort {
                    override val actorId = scope.actorId

                    override suspend fun tokenFor(actorId: String) = "synthetic-mobile-token"
                }
            val api =
                GcpMobileClient(
                    origin!!,
                    scope,
                    identity,
                    UrlConnectionPort(),
                    allowLoopback = true,
                )
            suspend fun send(state: MobilityState, command: MobilityCommand) =
                api.mobilityCommand(
                        command.body(state.vehicle?.version),
                        UUID.randomUUID().toString(),
                    )
                    .also { it.validate() }
            var state =
                api.mobilityCommand(
                    MobilityCommand.Initialize.body(null),
                    UUID.randomUUID().toString(),
                )
            state =
                send(state, MobilityCommand.Telemetry(27, "unknown", "ko", "charge_link_timeout"))
            assertEquals("escalated", state.reports.first().state)
            assertTrue(state.reports.first().guidance!!.canResolve)
            assertEquals(0, state.vehicle!!.attempts)
            state = send(state, MobilityCommand.ResolveUnknown(state.reports.first().id, "ko"))
            assertEquals("remediated", state.reports.first().state)
            assertEquals("human-decision", state.reports.first().authorization)
            assertEquals("candidate", state.cases.first().status)
            assertEquals("none", state.cases.first().verification.after.fault)
            state = send(state, MobilityCommand.PromoteCase(state.cases.first().id))
            assertFalse(state.policy.enabled)
            assertEquals(1, state.vehicle!!.attempts)
            state = send(state, MobilityCommand.Policy(true))
            state =
                send(state, MobilityCommand.Telemetry(32, "unknown", "ko", "charge_link_timeout"))
            assertEquals("standing-policy", state.reports.first().authorization)
            assertEquals(72.0, state.reports.first().remedy!!.powerKw)
            assertEquals("simulation", state.reports.first().remedy!!.source)
            assertEquals("remediated", state.reports.first().state)
            assertEquals(state.cases.first().id, state.reports.first().caseId)
            val version = state.vehicle!!.version
            state = api.mobility()
            assertEquals(
                version,
                state.vehicle!!.version,
            ) // Reading cannot start another investigation/change.
            state = send(state, MobilityCommand.RevokeCase(state.cases.first().id))
            state =
                send(state, MobilityCommand.Telemetry(32, "unknown", "ko", "charge_link_timeout"))
            assertEquals("escalated", state.reports.first().state)
            assertEquals(0, state.vehicle!!.attempts)
        }
}
