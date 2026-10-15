package app.mobileops.agent

import app.mobileops.agent.mobility.*
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test

/**
 * A delayed model is independent of vehicle requests; these fixtures make reply ordering explicit.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MobilityCallConcurrencyTest {
    private val id = "11111111-1111-4111-8111-111111111111"
    private val at = "2026-10-15T11:00:00Z"

    private fun moving(): MobilityState {
        val origin = Coordinate(37.5665, 126.9780)
        val place =
            MobilityPlace(
                "synthetic-place",
                "Synthetic destination",
                "",
                Coordinate(37.5685, 126.98),
                "poi",
                "google-places",
                at,
            )
        return MobilityState(
            vehicle =
                SimulatedVehicle(
                    id,
                    1,
                    "simulation",
                    "Aide EV",
                    at,
                    50,
                    80,
                    28.0,
                    260,
                    false,
                    "idle",
                    0.0,
                    "none",
                    id,
                    0,
                    origin,
                ),
            reports = emptyList(),
            journey =
                SimulatedJourney(
                    id,
                    "moving",
                    "poi",
                    origin,
                    listOf(place),
                    0.0,
                    origin,
                    "explicit-selection",
                    at,
                    "2026-10-15T12:00:00Z",
                    "simulation",
                    destination = place,
                ),
            favorites = emptyList(),
            policy = MobilityPolicy(false, null, "charge-reconnect-v1"),
            mapsAvailable = true,
            call =
                VehicleCall(
                    id,
                    "meeting_reschedule",
                    "ringing",
                    CallParty("Synthetic caller", "Fixture"),
                    emptyList(),
                    at,
                    "en",
                ),
            callRevision = 1,
        )
    }

    private inner class DelayedApi : MobileMobilityApi {
        var stored = moving()
        var denied = false
        var holdAdvance = false
        var failCall = false
        val releaseCall = CompletableDeferred<Unit>()
        val releaseAdvance = CompletableDeferred<Unit>()
        val operations = mutableListOf<String>()

        override suspend fun mobility(): MobilityState {
            if (denied) throw MobileFailure(Failure.DENIED)
            return stored
        }

        override suspend fun mobilityCommand(body: String, key: String): MobilityState {
            val operation =
                wireJson
                    .parseToJsonElement(body)
                    .jsonObject
                    .getValue("operation")
                    .jsonPrimitive
                    .content
            operations += operation
            return when (operation) {
                "advance" -> {
                    stored =
                        stored.copy(
                            vehicle = stored.vehicle!!.copy(version = stored.vehicle!!.version + 1),
                            journey =
                                stored.journey!!.copy(progress = stored.journey!!.progress + .1),
                        )
                    val reply = stored
                    if (holdAdvance) releaseAdvance.await()
                    reply
                }
                "stop" -> {
                    stored =
                        stored.copy(
                            vehicle =
                                stored.vehicle!!.copy(
                                    version = stored.vehicle!!.version + 1,
                                    parked = true,
                                ),
                            journey = stored.journey!!.copy(state = "cancelled", autopilot = false),
                        )
                    stored
                }
                "call_answer" -> {
                    releaseCall.await()
                    if (failCall)
                        throw MobileFailure(Failure.UNAVAILABLE, "mobility_outcome_unknown")
                    stored =
                        stored.copy(
                            call =
                                stored.call!!.copy(
                                    state = "active",
                                    turns =
                                        listOf(CallTurn("aide", "Synthetic confirmed reply", at)),
                                ),
                            callRevision = stored.callRevision + 1,
                            journey =
                                stored.journey!!.copy(
                                    autopilot = stored.journey!!.state == "moving",
                                ),
                        )
                    stored
                }
                else -> error("Unexpected fixture operation")
            }
        }
    }

    @Test
    fun delayedAnswerAllowsAdvanceAndStopWithoutRewindingTheVehicle() = runTest {
        val api = DelayedApi()
        val repository = MobileMobility(backgroundScope)
        repository.attach(api)
        runCurrent()
        repository.command(MobilityCommand.Advance(id))
        runCurrent()
        repository.command(MobilityCommand.CallAnswer(id, "aide"))
        runCurrent()
        assertTrue(repository.state.value.callBusy)
        assertFalse(repository.state.value.busy)
        repository.advanceAutomatically(id)
        runCurrent()
        repository.command(MobilityCommand.Stop(id))
        runCurrent()
        val stoppedVersion = repository.state.value.state!!.vehicle!!.version
        api.releaseCall.complete(Unit)
        runCurrent()
        assertEquals(2, api.operations.count { it == "advance" })
        assertEquals(1, api.operations.count { it == "stop" })
        assertEquals("active", repository.state.value.state!!.call!!.state)
        assertEquals("cancelled", repository.state.value.state!!.journey!!.state)
        assertEquals(stoppedVersion, repository.state.value.state!!.vehicle!!.version)
        assertFalse(repository.state.value.journeyRunning)
        assertFalse(repository.state.value.callBusy)
    }

    @Test
    fun permissionLossFencesTheOtherOutstandingLane() = runTest {
        val api = DelayedApi()
        val repository = MobileMobility(backgroundScope)
        repository.attach(api)
        runCurrent()
        repository.command(MobilityCommand.CallAnswer(id, "aide"))
        runCurrent()
        api.denied = true
        repository.refresh()
        runCurrent()
        assertNull(repository.state.value.state)
        api.releaseCall.complete(Unit)
        runCurrent()
        assertNull(repository.state.value.state)
        assertFalse(repository.state.value.callBusy)
    }

    @Test
    fun olderVehicleReplyCannotEraseTheNewerConversation() = runTest {
        val api = DelayedApi()
        val repository = MobileMobility(backgroundScope)
        repository.attach(api)
        runCurrent()
        repository.command(MobilityCommand.Advance(id))
        runCurrent()
        repository.command(MobilityCommand.CallAnswer(id, "aide"))
        runCurrent()
        api.holdAdvance = true
        repository.advanceAutomatically(id)
        runCurrent()
        api.releaseCall.complete(Unit)
        runCurrent()
        api.releaseAdvance.complete(Unit)
        runCurrent()
        assertEquals("active", repository.state.value.state!!.call!!.state)
        assertEquals(2, repository.state.value.state!!.callRevision)
        assertEquals(.2, repository.state.value.state!!.journey!!.progress)
        assertTrue(repository.state.value.state!!.journey!!.autopilot)
    }

    @Test
    fun refreshDuringTheModelWaitCannotRearmMovement() = runTest {
        val api = DelayedApi()
        val repository = MobileMobility(backgroundScope)
        repository.attach(api)
        runCurrent()
        repository.command(MobilityCommand.Advance(id))
        runCurrent()
        repository.command(MobilityCommand.CallAnswer(id, "aide"))
        runCurrent()
        repository.refresh()
        runCurrent()
        api.releaseCall.complete(Unit)
        runCurrent()
        assertEquals("active", repository.state.value.state!!.call!!.state)
        assertFalse(repository.state.value.journeyRunning)
    }

    @Test
    fun anUnknownCallDisarmsEvenAnOutstandingVehicleReply() = runTest {
        val api = DelayedApi()
        val repository = MobileMobility(backgroundScope)
        repository.attach(api)
        runCurrent()
        repository.command(MobilityCommand.Advance(id))
        runCurrent()
        repository.command(MobilityCommand.CallAnswer(id, "aide"))
        runCurrent()
        api.holdAdvance = true
        repository.advanceAutomatically(id)
        runCurrent()
        api.failCall = true
        api.releaseCall.complete(Unit)
        runCurrent()
        api.releaseAdvance.complete(Unit)
        runCurrent()
        assertFalse(repository.state.value.journeyRunning)
        assertEquals(Failure.UNAVAILABLE, repository.state.value.failure)
        assertEquals(1, api.operations.count { it == "call_answer" })
    }
}
