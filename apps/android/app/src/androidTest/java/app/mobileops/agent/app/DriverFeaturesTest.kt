package app.mobileops.agent.app

import android.content.res.Configuration
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.mobileops.agent.Failure
import app.mobileops.agent.app.mobility.AskAide
import app.mobileops.agent.app.mobility.CallOverlay
import app.mobileops.agent.app.mobility.CallsScreen
import app.mobileops.agent.app.mobility.DiagnosisCluster
import app.mobileops.agent.app.mobility.JourneyAutoAdvance
import app.mobileops.agent.app.mobility.JourneyScreen
import app.mobileops.agent.app.mobility.LowBatteryNudge
import app.mobileops.agent.app.mobility.VehicleControls
import app.mobileops.agent.app.mobility.VehicleHero
import app.mobileops.agent.mobility.*
import java.io.File
import java.time.Instant
import java.util.Locale
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/**
 * Driver features rendered from explicit synthetic snapshots. Commands are only recorded; no
 * gateway, model, Maps key, physical vehicle or real caller is involved.
 */
class DriverFeaturesTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun label(id: Int, vararg args: Any) = context.getString(id, *args)

    private val vehicleId = "11111111-1111-4111-8111-111111111111"
    private val episode = "33333333-3333-4333-8333-333333333333"
    private val callId = "55555555-5555-4555-8555-555555555555"
    private val journeyId = "66666666-6666-4666-8666-666666666666"
    private val now = Instant.now()

    private fun vehicle(
        battery: Int = 62,
        fault: String = "none",
        signal: String = "none",
        locked: Boolean = true,
        charging: String = "idle",
        power: Double = 0.0,
        tires: List<Double> = listOf(2.5, 2.5, 2.5, 2.5),
    ) =
        SimulatedVehicle(
            vehicleId,
            4,
            "simulation",
            "Aide EV",
            now.toString(),
            battery,
            80,
            if (fault == "battery_hot") 52.0 else 28.0,
            battery * 4,
            true,
            charging,
            power,
            fault,
            episode,
            0,
            Coordinate(37.5665, 126.978),
            signal,
            locked = locked,
            climate = Climate(on = true, targetCelsius = 21.0, cabinCelsius = 25.5),
            tiresBar = tires,
            odometerKm = 12840,
        )

    private fun board(
        vehicle: SimulatedVehicle = vehicle(),
        journey: SimulatedJourney? = null,
        call: VehicleCall? = null,
        calls: List<VehicleCall> = emptyList(),
        assist: AssistTurn? = null,
        busy: Boolean = false,
        running: Boolean = false,
    ) =
        VehicleBoard(
            available = true,
            busy = busy,
            journeyRunning = running,
            state =
                MobilityState(
                    vehicle,
                    emptyList(),
                    journey,
                    emptyList(),
                    MobilityPolicy(false, null, "charge-reconnect-v1"),
                    true,
                    call = call,
                    calls = calls,
                    assist = assist,
                ),
        )

    private fun place(index: Int, kind: String = "restaurant") =
        MobilityPlace(
            "synthetic_place_$index",
            listOf("Hanok Table", "Riverside Noodles", "Garden Bistro")[index],
            "${index + 1} Synthetic-ro, Jung-gu",
            Coordinate(37.5665 + .01 * (index + 1), 126.978 + .008 * (index + 1)),
            kind,
            "google-places",
            now.toString(),
            rating = 4.3 + index * .1,
            photo =
                PlacePhoto(
                    "https://lh3.googleusercontent.com/synthetic-$index",
                    listOf(PhotoAttribution("Synthetic Author ${index + 1}")),
                ),
        )

    private fun journey(state: String, kind: String = "restaurant", autopilot: Boolean = false) =
        SimulatedJourney(
            journeyId,
            state,
            kind,
            Coordinate(37.5665, 126.978),
            (0..2).map { place(it, kind) },
            if (state == "choosing") 0.0 else if (state == "arrived") 1.0 else .4,
            Coordinate(37.5705, 126.981),
            if (state == "choosing") "selection-required" else "explicit-selection",
            now.toString(),
            now.plusSeconds(1800).toString(),
            "simulation",
            destination = if (state == "choosing") null else place(0, kind),
            autopilot = autopilot,
        )

    private val turns =
        listOf(
            CallTurn(
                "caller",
                "Hi, it's Jisoo. Can we move tomorrow's review to the afternoon?",
                now.toString(),
            ),
            CallTurn(
                "aide",
                "Hi Jisoo, this is My Aide. Minho is driving; 3 pm looks free.",
                now.toString(),
            ),
            CallTurn("caller", "3 pm works. Please send the new invite.", now.toString()),
            CallTurn("driver", "Sounds good.", now.toString()),
        )

    private fun call(state: String, turns: List<CallTurn> = this.turns, saved: Boolean = false) =
        VehicleCall(
            callId,
            "meeting_reschedule",
            state,
            CallParty("Jisoo Park", "Team lead"),
            turns,
            now.minusSeconds(75).toString(),
            "en",
            handledBy = "aide",
            endedAt = if (state == "ended") now.toString() else null,
            summary =
                if (state == "ended")
                    CallSummary(
                        "Jisoo asked to move tomorrow's design review to 3 pm. My Aide agreed on your behalf.",
                        listOf("Move the design review to 3 pm", "Share the slides by noon"),
                        listOf(
                            CallFollowup(
                                "77777777-7777-4777-8777-777777777771",
                                "message",
                                "Reply to Jisoo",
                                "draft",
                                body = "Confirmed for 3 pm tomorrow. Slides by noon.",
                                to = "Jisoo Park",
                            ),
                            CallFollowup(
                                "77777777-7777-4777-8777-777777777772",
                                "calendar",
                                "Design review",
                                "draft",
                                whenAt = now.plusSeconds(86400).toString(),
                            ),
                            CallFollowup(
                                "77777777-7777-4777-8777-777777777773",
                                "reminder",
                                "Share slides",
                                "done",
                            ),
                        ),
                    )
                else null,
            saved = saved,
        )

    @Composable
    private fun Page(korean: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
        val body: @Composable () -> Unit = {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                Column(
                    Modifier.fillMaxSize()
                        .background(MaterialTheme.colorScheme.background)
                        .verticalScroll(rememberScrollState())
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    content = content,
                )
            }
        }
        if (!korean) body()
        else {
            val config =
                Configuration(context.resources.configuration).apply { setLocale(Locale.KOREA) }
            val localized = context.createConfigurationContext(config)
            CompositionLocalProvider(
                LocalContext provides localized,
                LocalConfiguration provides config,
                LocalResources provides localized.resources,
            ) {
                body()
            }
        }
    }

    @Composable
    private fun CallHarness(
        board: VehicleBoard,
        commands: MutableList<MobilityCommand>,
        onRefresh: () -> Unit,
    ) {
        MaterialTheme(colorScheme = opsColorScheme(false)) {
            Scaffold(bottomBar = { CallOverlay(board, commands::add, onRefresh) }) { padding ->
                Column(
                    Modifier.padding(padding).padding(20.dp).verticalScroll(rememberScrollState()),
                ) {
                    VehicleHero(board.state!!.vehicle!!)
                }
            }
        }
    }

    private fun shot(name: String) {
        val folder = File(context.getExternalFilesDir(null), "verification").apply { mkdirs() }
        File(folder, name).outputStream().use { output ->
            compose
                .onRoot()
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    @Test
    fun controlsConfirmOnlyAfterTheServerAcceptsAndNudgeOnlyNavigates() {
        val state = mutableStateOf(board(vehicle(battery = 18)))
        val commands = mutableListOf<MobilityCommand>()
        var chargerNavigation = 0
        compose.setContent {
            Page {
                VehicleControls(state.value, commands::add)
                LowBatteryNudge(state.value.state!!.vehicle!!) { chargerNavigation++ }
            }
        }
        compose.runOnIdle { assertTrue(commands.isEmpty()) }
        val toast = label(R.string.controls_simulated_toast, label(R.string.controls_done_unlocked))
        compose.onNodeWithText(label(R.string.controls_locked)).performClick()
        compose.runOnIdle {
            assertEquals(listOf(MobilityCommand.Control("unlock")), commands)
            state.value = state.value.copy(busy = true)
        }
        compose.onAllNodesWithText(toast).assertCountEquals(0)
        compose.runOnIdle { state.value = board(vehicle(battery = 18, locked = false)) }
        compose.onNodeWithText(toast).assertIsDisplayed()
        shot("driver-controls.png")
        // A failed request never shows a confirmation.
        compose.onNodeWithText(label(R.string.controls_honk)).performClick()
        compose.runOnIdle { state.value = state.value.copy(busy = true) }
        compose.runOnIdle {
            state.value = state.value.copy(busy = false, failure = Failure.UNAVAILABLE)
        }
        compose
            .onAllNodesWithText(
                label(R.string.controls_simulated_toast, label(R.string.controls_done_honk)),
            )
            .assertCountEquals(0)
        compose.onNodeWithText(label(R.string.home_find_charger)).performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(1, chargerNavigation)
            assertEquals(2, commands.size)
            assertEquals(MobilityCommand.Control("honk"), commands[1])
        }
    }

    @Test
    fun koreanControlsFitThePhoneWidth() {
        compose.setContent {
            Page(korean = true) {
                VehicleControls(
                    board(vehicle(battery = 18, charging = "charging", power = 11.0)),
                    {},
                )
            }
        }
        compose.onNodeWithText("잠김").assertIsDisplayed()
        shot("driver-controls-ko.png")
    }

    @Test
    fun askAideRunsNothingUntilAProposalIsTapped() {
        val assist =
            AssistTurn(
                "88888888-8888-4888-8888-888888888888",
                now.toString(),
                "Cool the car to 20 before I leave",
                "I can cool the cabin to 20° and lock the doors. A charger is 2 km away.",
                listOf(
                    AssistProposal("control", action = "set_temperature", value = 20.0),
                    AssistProposal("control", action = "lock"),
                    AssistProposal(
                        "trip",
                        tripKind = "charging",
                        instruction = "Nearby fast charger",
                    ),
                ),
                "en",
                "offline-fixture",
            )
        val state = mutableStateOf(board(assist = assist))
        val commands = mutableListOf<MobilityCommand>()
        val trips = mutableListOf<Pair<String, String>>()
        compose.setContent {
            Page { AskAide(state.value, commands::add) { kind, text -> trips += kind to text } }
        }
        compose.runOnIdle { assertTrue(commands.isEmpty() && trips.isEmpty()) }
        val setCabin = label(R.string.ask_set_temperature, "20")
        compose.onNodeWithText(setCabin).performClick()
        compose.runOnIdle {
            assertEquals(listOf(MobilityCommand.Control("set_temperature", 20.0)), commands)
            state.value = state.value.copy(busy = true)
        }
        compose.runOnIdle { state.value = state.value.copy(busy = false) }
        compose.onNodeWithText(label(R.string.ask_done, setCabin)).assertIsDisplayed()
        compose.onNodeWithText(label(R.string.ask_trip_charging)).performScrollTo().performClick()
        compose.runOnIdle {
            assertEquals(listOf("charging" to "Nearby fast charger"), trips)
            assertEquals(1, commands.size)
        }
        shot("driver-ask-aide.png")
    }

    @Test
    fun diagnosisHighlightsTheRearLeftTireAndOffersAServiceShop() {
        val state =
            mutableStateOf(
                vehicle(
                    fault = "tire_low",
                    signal = "tire_pressure_low",
                    tires = listOf(2.5, 2.5, 1.6, 2.5),
                ),
            )
        var serviceShop = 0
        compose.setContent { Page { DiagnosisCluster(state.value) { serviceShop++ } } }
        val headline = label(R.string.cluster_tire_fault)
        compose.onNodeWithText(headline).assertIsDisplayed()
        compose
            .onNodeWithContentDescription(label(R.string.cluster_diagram, headline))
            .assertExists()
        shot("driver-diagnosis-tire.png")
        compose
            .onNodeWithText(label(R.string.cluster_service_shop))
            .performScrollTo()
            .performClick()
        compose.runOnIdle {
            assertEquals(1, serviceShop)
            state.value = vehicle()
        }
        compose.onNodeWithText(label(R.string.cluster_normal)).assertIsDisplayed()
        compose.onAllNodesWithText(label(R.string.cluster_service_shop)).assertCountEquals(0)
    }

    @Test
    fun ringingCallOffersMyAideAnswerAndDecline() {
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent { CallHarness(board(call = call("ringing", emptyList())), commands) {} }
        compose.onNodeWithText(label(R.string.call_incoming_simulated)).assertIsDisplayed()
        shot("driver-call-ringing.png")
        compose.onNodeWithText(label(R.string.call_let_aide_answer)).performClick()
        compose.onNodeWithContentDescription(label(R.string.call_decline)).performClick()
        compose.runOnIdle {
            assertEquals(
                listOf(
                    MobilityCommand.CallAnswer(callId, "aide"),
                    MobilityCommand.CallDecline(callId),
                ),
                commands,
            )
        }
    }

    @Test
    fun activeCallShowsAutopilotAndStopsOfferingTurnsAtTheLimit() {
        val state =
            mutableStateOf(
                board(
                    call = call("active"),
                    journey = journey("moving", autopilot = true),
                    running = true,
                ),
            )
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent { CallHarness(state.value, commands) {} }
        compose
            .onNodeWithText(label(R.string.call_aide_on_call), substring = true)
            .assertIsDisplayed()
        compose.onNodeWithText(label(R.string.call_autopilot)).assertIsDisplayed()
        // Mute first so the shared emulator stays quiet; driver turns are never voiced anyway.
        compose.onNodeWithContentDescription(label(R.string.call_mute_voice)).performClick()
        compose.onNodeWithContentDescription(label(R.string.call_play_voice)).assertExists()
        shot("driver-call-active.png")
        compose.onNode(hasText(label(R.string.call_quick_good)) and hasClickAction()).performClick()
        compose.onNodeWithText(label(R.string.call_let_aide_reply)).performClick()
        compose.onNodeWithContentDescription(label(R.string.call_end)).performClick()
        compose.runOnIdle {
            assertEquals(
                listOf(
                    MobilityCommand.CallSay(callId, label(R.string.call_quick_good)),
                    MobilityCommand.CallDelegate(callId),
                    MobilityCommand.CallEnd(callId),
                ),
                commands,
            )
            state.value =
                state.value.copy(
                    state =
                        state.value.state!!.copy(
                            call = call("active", (1..14).map { turns[it % 4] }),
                        ),
                )
        }
        compose.onNodeWithText(label(R.string.call_let_aide_reply)).assertIsNotEnabled()
        compose
            .onNode(hasText(label(R.string.call_quick_good)) and hasClickAction())
            .assertIsNotEnabled()
    }

    @Test
    fun summaryFollowupsAreDraftsUntilTappedAndCloseIsLocal() {
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent { CallHarness(board(call = call("ended")), commands) {} }
        compose.onNodeWithText(label(R.string.call_summary_title)).assertIsDisplayed()
        shot("driver-call-summary.png")
        compose
            .onNodeWithText(label(R.string.call_done_simulated))
            .performScrollTo()
            .assertIsDisplayed()
        compose.runOnIdle { assertTrue(commands.isEmpty()) }
        compose.onNodeWithText(label(R.string.call_send_message)).performScrollTo().performClick()
        compose.onAllNodesWithText(label(R.string.call_dismiss))[1].performScrollTo().performClick()
        compose.onNodeWithText(label(R.string.call_save_summary)).performClick()
        compose.runOnIdle {
            assertEquals(
                listOf(
                    MobilityCommand.Followup(callId, "77777777-7777-4777-8777-777777777771", true),
                    MobilityCommand.Followup(callId, "77777777-7777-4777-8777-777777777772", false),
                    MobilityCommand.CallSave(callId),
                ),
                commands,
            )
        }
        compose.onNodeWithText(label(R.string.call_close)).performClick()
        compose.onAllNodesWithText(label(R.string.call_summary_title)).assertCountEquals(0)
        compose.runOnIdle { assertEquals(3, commands.size) }
    }

    @Test
    fun unknownCallOnlyReadsTheLatestRecord() {
        val commands = mutableListOf<MobilityCommand>()
        var refreshes = 0
        compose.setContent { CallHarness(board(call = call("unknown")), commands) { refreshes++ } }
        compose.onNodeWithText(label(R.string.call_unconfirmed_body)).assertIsDisplayed()
        compose.onNodeWithText(label(R.string.call_no_followup)).assertIsDisplayed()
        shot("driver-call-unconfirmed.png")
        compose.onNodeWithText(label(R.string.call_read_latest)).performClick()
        compose.runOnIdle {
            assertEquals(1, refreshes)
            assertTrue(commands.isEmpty())
        }
    }

    @Test
    fun callsTabStartsFictionalScenariosAndListsSavedCalls() {
        val state = mutableStateOf(board(calls = listOf(call("ended", saved = true))))
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent { Page { CallsScreen(state.value, commands::add) } }
        shot("driver-calls-tab.png")
        compose.onNodeWithText(label(R.string.call_scenario_meeting)).performClick()
        compose.runOnIdle {
            assertEquals(
                listOf(
                    MobilityCommand.CallIncoming(
                        "meeting_reschedule",
                        label(R.string.agent_request_language),
                    ),
                ),
                commands,
            )
            state.value =
                state.value.copy(
                    state = state.value.state!!.copy(call = call("ringing", emptyList())),
                )
        }
        compose.onNodeWithText(label(R.string.call_scenario_pickup)).assertIsNotEnabled()
    }

    @Test
    fun journeyCardsShowPhotoAttributionDistanceAndArrivalCharging() {
        val state = mutableStateOf(board(journey = journey("choosing")))
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent { Page { JourneyScreen(state.value, commands::add) } }
        compose
            .onNodeWithText(
                label(R.string.place_photo_attribution, "Synthetic Author 1"),
            )
            .performScrollTo()
            .assertIsDisplayed()
        compose
            .onAllNodesWithText(
                label(
                    R.string.place_distance_arrival,
                    String.format(Locale.getDefault(), "%.1f", Math.hypot(.01 * 111, .008 * 88)),
                    61,
                ),
            )
            .onFirst()
            .assertExists()
        compose.onAllNodesWithText(label(R.string.vehicle_go_here)).onFirst().performScrollTo()
        shot("driver-journey-cards.png")
        compose.runOnIdle {
            assertTrue(commands.isEmpty())
            state.value = board(vehicle(battery = 40), journey = journey("arrived", "charging"))
        }
        compose
            .onNodeWithText(label(R.string.arrival_start_charging))
            .performScrollTo()
            .performClick()
        compose.runOnIdle {
            assertEquals(listOf(MobilityCommand.Control("start_charging")), commands)
        }
    }

    @Test
    fun automaticAdvanceNeedsAnExplicitlyRunningJourney() {
        val state = mutableStateOf(board(journey = journey("moving"), running = false))
        val advanced = mutableListOf<String>()
        compose.mainClock.autoAdvance = false
        compose.setContent { JourneyAutoAdvance(state.value) { advanced += it } }
        compose.mainClock.advanceTimeBy(3000)
        compose.runOnIdle {
            assertTrue("A read or refresh must never arm movement", advanced.isEmpty())
            state.value = board(journey = journey("moving"), running = true)
        }
        compose.mainClock.advanceTimeBy(1500)
        compose.runOnIdle { assertEquals(listOf(journeyId), advanced) }
    }
}
