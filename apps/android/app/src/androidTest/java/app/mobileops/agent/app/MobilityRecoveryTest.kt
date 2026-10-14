package app.mobileops.agent.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.mobileops.agent.app.mobility.VehicleAssistance
import app.mobileops.agent.app.mobility.VehicleHero
import app.mobileops.agent.app.mobility.VehicleHomeActions
import app.mobileops.agent.mobility.*
import java.io.File
import java.time.Instant
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/**
 * Component UI proof with explicit synthetic snapshots; the real native HTTP round-trip lives in
 * core.
 */
class MobilityRecoveryTest {
    @get:Rule val compose = createComposeRule()
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun label(id: Int) = context.getString(id)

    private val vehicleId = "11111111-1111-4111-8111-111111111111"
    private val reportId = "22222222-2222-4222-8222-222222222222"
    private val episode = "33333333-3333-4333-8333-333333333333"
    private val caseId = "44444444-4444-4444-8444-444444444444"

    private fun board(signal: String = "charge_link_timeout"): VehicleBoard {
        val now = Instant.now()
        val vehicle =
            SimulatedVehicle(
                vehicleId,
                3,
                "simulation",
                "Aide EV",
                now.toString(),
                30,
                80,
                28.0,
                156,
                true,
                "interrupted",
                0.0,
                "unknown",
                episode,
                0,
                Coordinate(37.5, 127.0),
                signal,
            )
        val checks =
            listOf("signal", "parked", "temperature", "battery", "attempts").map {
                RecoveryCheck(it, it != "signal" || signal == "charge_link_timeout")
            }
        val report =
            MobilityReport(
                reportId,
                now.toString(),
                "escalated",
                "offline-fixture",
                "Synthetic unfamiliar charging symptom.",
                emptyList(),
                emptyList(),
                "none",
                2,
                "read-only",
                episode,
                guidance =
                    RecoveryGuidance(
                        "review-charge-link-v1",
                        now.plusSeconds(600).toString(),
                        signal == "charge_link_timeout",
                        checks,
                    ),
            )
        return VehicleBoard(
            available = true,
            state =
                MobilityState(
                    vehicle,
                    listOf(report),
                    null,
                    emptyList(),
                    MobilityPolicy(false, null, "charge-reconnect-v1"),
                    false,
                ),
        )
    }

    private fun capture(name: String) {
        val folder = File(context.getExternalFilesDir(null), "verification").apply { mkdirs() }
        File(folder, name).outputStream().use { output ->
            compose
                .onNode(isDialog())
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
        }
    }

    @Test
    fun recoveryAndCasePromotionNeedSeparateVisibleReviewsAndDoNotEnablePolicy() {
        val state = mutableStateOf(board())
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                    VehicleAssistance(
                        state.value,
                        commands::add,
                        context.getString(R.string.agent_request_language),
                    )
                }
            }
        }
        compose.runOnIdle { assertTrue(commands.isEmpty()) }
        compose.onNodeWithText(label(R.string.recovery_review)).performScrollTo().performClick()
        compose.onNodeWithText(label(R.string.recovery_once_boundary)).assertIsDisplayed()
        capture("case-recovery-dialog.png")
        compose.onNodeWithText(label(R.string.recovery_confirm)).performClick()
        compose.runOnIdle {
            assertEquals(1, commands.size)
            assertTrue(commands[0] is MobilityCommand.ResolveUnknown)
        }
        val initial = state.value.state!!
        val before =
            ChargingEvidence("unknown", "charge_link_timeout", "interrupted", true, 28.0, 30, 80, 0)
        val now = Instant.now()
        val learned =
            MobilityCase(
                caseId,
                vehicleId,
                reportId,
                "charge_link_timeout",
                "charge-reconnect-v1",
                "candidate",
                now.toString(),
                now.plusSeconds(7 * 86400L).toString(),
                4,
                CaseVerification(
                    before,
                    before.copy(
                        fault = "none",
                        diagnosticSignal = "none",
                        charging = "charging",
                        attempts = 1,
                    ),
                ),
            )
        compose.runOnIdle {
            state.value =
                state.value.copy(
                    state =
                        initial.copy(
                            vehicle =
                                initial.vehicle!!.copy(
                                    fault = "none",
                                    diagnosticSignal = "none",
                                    attempts = 1,
                                    charging = "charging",
                                ),
                            reports =
                                initial.reports.map {
                                    it.copy(state = "remediated", authorization = "human-decision")
                                },
                            cases = listOf(learned),
                        ),
                )
        }
        compose.onNodeWithText(label(R.string.cases_register)).performScrollTo().performClick()
        compose.onNodeWithText(label(R.string.cases_promotion_review)).assertIsDisplayed()
        capture("case-promotion-dialog.png")
        compose.onNodeWithText(label(R.string.cases_promote)).performClick()
        compose.runOnIdle {
            assertEquals(2, commands.size)
            assertEquals(MobilityCommand.PromoteCase(caseId), commands[1])
            assertFalse(state.value.state!!.policy.enabled)
            assertFalse(commands.any { it is MobilityCommand.Policy })
        }
    }

    @Test
    fun unsafeOrUnclassifiedGuidanceOffersNoReconnectionAction() {
        val commands = mutableListOf<MobilityCommand>()
        compose.setContent {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                    VehicleAssistance(
                        board("unclassified"),
                        commands::add,
                        context.getString(R.string.agent_request_language),
                    )
                }
            }
        }
        compose
            .onNodeWithText(label(R.string.recovery_unavailable))
            .performScrollTo()
            .assertIsDisplayed()
        compose.onAllNodesWithText(label(R.string.recovery_review)).assertCountEquals(0)
        compose.onAllNodesWithText(label(R.string.recovery_confirm)).assertCountEquals(0)
        compose.runOnIdle { assertTrue(commands.isEmpty()) }
    }

    @Test
    fun vehicleHomeNavigationDoesNotSearchOrGrantAuthorityOnRender() {
        val state = board()
        val commands = mutableListOf<MobilityCommand>()
        val destinations = mutableListOf<String>()
        var assistance = 0
        compose.setContent {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(20.dp)) {
                    VehicleHero(state.state!!.vehicle!!)
                    VehicleHomeActions(state, commands::add, destinations::add) { assistance++ }
                }
            }
        }
        compose.runOnIdle { assertTrue(commands.isEmpty()) }
        val folder = File(context.getExternalFilesDir(null), "verification").apply { mkdirs() }
        File(folder, "vehicle-home-components.png").outputStream().use { output ->
            compose
                .onRoot()
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output)
        }
        compose.onNodeWithText(label(R.string.home_find_charger)).performScrollTo().performClick()
        compose.onNodeWithText(label(R.string.home_find_dinner)).performClick()
        compose
            .onNodeWithText(label(R.string.home_review_response))
            .performScrollTo()
            .performClick()
        compose.runOnIdle {
            assertEquals(listOf("charging", "restaurant"), destinations)
            assertEquals(1, assistance)
            assertTrue(commands.isEmpty())
        }
    }
}
