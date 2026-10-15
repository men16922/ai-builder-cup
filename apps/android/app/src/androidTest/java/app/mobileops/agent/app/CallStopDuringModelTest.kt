package app.mobileops.agent.app

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.mobileops.agent.app.mobility.CallOverlay
import app.mobileops.agent.mobility.*
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Native control affordance under a delayed model; no gateway, model, map or vehicle command. */
class CallStopDuringModelTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun stopRemainsEnabledWhileTheConversationWaits() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val id = "11111111-1111-4111-8111-111111111111"
        val at = "2026-10-15T11:00:00Z"
        val origin = Coordinate(37.5665, 126.978)
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
        val state =
            MobilityState(
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
                emptyList(),
                SimulatedJourney(
                    id,
                    "moving",
                    "poi",
                    origin,
                    listOf(place),
                    .2,
                    origin,
                    "explicit-selection",
                    at,
                    "2026-10-15T12:00:00Z",
                    "simulation",
                    destination = place,
                ),
                emptyList(),
                MobilityPolicy(false, null, "charge-reconnect-v1"),
                true,
                call =
                    VehicleCall(
                        id,
                        "meeting_reschedule",
                        "active",
                        CallParty("Synthetic caller", "Fixture"),
                        emptyList(),
                        at,
                        "en",
                    ),
                callRevision = 2,
            )
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                Column {
                    CallOverlay(
                        VehicleBoard(available = true, state = state, callBusy = true),
                        { commands += it },
                        {},
                    )
                }
            }
        }
        compose.onNodeWithText(context.getString(R.string.call_let_aide_reply)).assertIsNotEnabled()
        compose
            .onNodeWithText(context.getString(R.string.call_stop_drive))
            .assertIsEnabled()
            .performClick()
        assertEquals(listOf(MobilityCommand.Stop(id)), commands)
    }
}
