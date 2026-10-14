package app.mobileops.agent

import app.mobileops.agent.mobility.*
import kotlin.test.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class MobilityTest {
    private fun empty() =
        MobilityState(
            null,
            emptyList(),
            null,
            emptyList(),
            MobilityPolicy(false, null, "charge-reconnect-v1"),
            true,
        )

    @Test
    fun detachedSessionCannotRestoreLocationFromAnUncancellableLateRead() = runTest {
        val reply = CompletableDeferred<MobilityState>()
        val source =
            object : MobileMobilityApi {
                override suspend fun mobility() = withContext(NonCancellable) { reply.await() }

                override suspend fun mobilityCommand(body: String, key: String): MobilityState =
                    error("No command requested")
            }
        val repository = MobileMobility(backgroundScope)
        repository.attach(source)
        runCurrent()
        assertTrue(repository.state.value.busy)
        repository.detach()
        reply.complete(empty())
        runCurrent()
        assertFalse(repository.state.value.available)
        assertNull(repository.state.value.state)
    }

    @Test
    fun readingAfterAnUnknownCommandNeverResendsIt() = runTest {
        var reads = 0
        var changes = 0
        val source =
            object : MobileMobilityApi {
                override suspend fun mobility(): MobilityState {
                    reads++
                    return empty()
                }

                override suspend fun mobilityCommand(body: String, key: String): MobilityState {
                    changes++
                    assertEquals("{\"operation\":\"initialize\"}", body)
                    throw MobileFailure(Failure.UNAVAILABLE)
                }
            }
        val repository = MobileMobility(backgroundScope)
        repository.attach(source)
        runCurrent()
        repository.command(MobilityCommand.Initialize)
        runCurrent()
        assertEquals(Failure.UNAVAILABLE, repository.state.value.failure)
        repository.refresh()
        runCurrent()
        assertEquals(1, changes)
        assertEquals(2, reads)
    }

    @Test
    fun mapsSourcesAreStrictAndLanguageCannotCreateExecutionAuthority() {
        val place =
            MobilityPlace(
                "fixture",
                "Synthetic source",
                "",
                Coordinate(37.0, 127.0),
                "poi",
                "google-maps-mcp",
                "2026-10-15T00:00:00Z",
                mapsUrl = "https://www.google.com/maps/place/fixture",
            )
        place.validate()
        assertFails { place.copy(mapsUrl = "https://attacker.invalid").validate() }
        assertFails { place.copy(mapsUrl = "javascript:alert(1)").validate() }
        assertFails { place.copy(location = Coordinate(Double.NaN, 127.0)).validate() }
        val request = MobilityCommand.RequestTrip("restaurant", "Dinner nearby", "ko").body(7)
        assertTrue(request.contains("\"language\":\"ko\""))
        assertFalse(request.contains("approval"))
        assertFalse(request.contains("actor"))
    }

    @Test
    fun readingMovingJourneyAndUnknownStepNeverArmAutomaticContinuation() = runTest {
        val id = "11111111-1111-4111-8111-111111111111"
        val now = java.time.Instant.now()
        val point = Coordinate(37.5, 127.0)
        val place =
            MobilityPlace(
                "fixture",
                "Synthetic destination",
                "",
                point,
                "poi",
                "google-places",
                now.toString(),
            )
        val vehicle =
            SimulatedVehicle(
                id,
                1,
                "simulation",
                "Aide EV",
                now.toString(),
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
                point,
            )
        val journey =
            SimulatedJourney(
                id,
                "moving",
                "poi",
                point,
                listOf(place),
                0.0,
                point,
                "explicit-selection",
                now.toString(),
                now.plusSeconds(600).toString(),
                "simulation",
                place,
            )
        val moving = empty().copy(vehicle = vehicle, journey = journey)
        var changes = 0
        var unknown = false
        val source =
            object : MobileMobilityApi {
                override suspend fun mobility() = moving

                override suspend fun mobilityCommand(body: String, key: String): MobilityState {
                    changes++
                    if (unknown) throw MobileFailure(Failure.UNAVAILABLE)
                    return moving
                }
            }
        val repository = MobileMobility(backgroundScope)
        repository.attach(source)
        runCurrent()
        assertFalse(repository.state.value.journeyRunning)
        repository.advanceAutomatically(id)
        runCurrent()
        assertEquals(0, changes)
        repository.command(MobilityCommand.Advance(id))
        runCurrent()
        assertTrue(repository.state.value.journeyRunning)
        assertEquals(1, changes)
        unknown = true
        repository.advanceAutomatically(id)
        runCurrent()
        assertFalse(repository.state.value.journeyRunning)
        assertEquals(2, changes)
        repository.refresh()
        runCurrent()
        repository.advanceAutomatically(id)
        runCurrent()
        assertFalse(repository.state.value.journeyRunning)
        assertEquals(2, changes)
    }
}
