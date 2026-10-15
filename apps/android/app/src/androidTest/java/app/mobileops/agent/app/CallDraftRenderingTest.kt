package app.mobileops.agent.app

import android.content.res.Configuration
import android.graphics.Bitmap
import android.util.Base64
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import app.mobileops.agent.app.mobility.CallOverlay
import app.mobileops.agent.mobility.CallFollowup
import app.mobileops.agent.mobility.CallParty
import app.mobileops.agent.mobility.CallSummary
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.MobilityPolicy
import app.mobileops.agent.mobility.MobilityState
import app.mobileops.agent.mobility.VehicleBoard
import app.mobileops.agent.mobility.VehicleCall
import java.io.File
import java.util.Locale
import java.util.TimeZone
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Regression for the observed wrong-time/empty-body call cards. The regular run uses a fixed
 * synthetic Friday fixture; an optional argument replays a separately recorded synthetic-input
 * model summary through the same production DTO and UI. Neither path calls a model or gateway,
 * signs in, sends a message or writes a calendar. Callbacks record commands, not server receipts.
 */
class CallDraftRenderingTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun englishDraftUsesTheAgreedKstTimeAndKeepsTheMessageBody() =
        checkDraft(Locale.US, "Fri 16:30", "en")

    @Test
    fun koreanDraftUsesTheAgreedKstTimeAndResourceLabels() =
        checkDraft(Locale.KOREA, "금 16:30", "ko")

    private fun fixture(): CallSummary {
        val encoded = InstrumentationRegistry.getArguments().getString("aideSummaryFixtureBase64")
        if (encoded != null) {
            // The runner supplies only the summary object, never identity/configuration records.
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            require(bytes.size <= 16_384)
            return Json.decodeFromString<CallSummary>(bytes.toString(Charsets.UTF_8))
        }
        return CallSummary(
            text = "A fictional review is agreed for Friday at 16:30 KST.",
            actionItems = listOf("Review the message and calendar drafts."),
            followups =
                listOf(
                    CallFollowup(
                        id = "77777777-7777-4777-8777-777777777771",
                        kind = "message",
                        title = "Confirm the fictional review",
                        status = "draft",
                        body = "Confirming the fictional review tomorrow at 4:30 PM KST.",
                        to = "Synthetic recipient",
                    ),
                    CallFollowup(
                        id = "77777777-7777-4777-8777-777777777772",
                        kind = "calendar",
                        title = "Fictional review",
                        status = "draft",
                        whenAt = "2026-10-16T07:30:00.000Z",
                    ),
                ),
        )
    }

    private fun checkDraft(locale: Locale, expectedClock: String, capture: String) {
        val previousLocale = Locale.getDefault()
        val previousZone = TimeZone.getDefault()
        try {
            Locale.setDefault(locale)
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Seoul"))
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val config = Configuration(context.resources.configuration).apply { setLocale(locale) }
            val localized = context.createConfigurationContext(config)
            val summary = fixture()
            val message = summary.followups.single { it.kind == "message" }
            val calendar = summary.followups.single { it.kind == "calendar" }
            assertEquals("2026-10-16T07:30:00.000Z", calendar.whenAt)
            assertTrue(!message.body.isNullOrBlank() && !message.to.isNullOrBlank())
            assertTrue(summary.followups.all { it.status == "draft" })
            val id = "55555555-5555-4555-8555-555555555555"
            val call =
                VehicleCall(
                        id = id,
                        scenario = "meeting_reschedule",
                        state = "ended",
                        caller = CallParty("Synthetic caller", "Fixture"),
                        turns = emptyList(),
                        startedAt = "2026-10-15T13:00:00.000Z",
                        language = locale.language,
                        endedAt = "2026-10-15T13:01:00.000Z",
                        summary = summary,
                    )
                    .also { it.validate() }
            val board =
                VehicleBoard(
                    available = true,
                    state =
                        MobilityState(
                            vehicle = null,
                            reports = emptyList(),
                            journey = null,
                            favorites = emptyList(),
                            policy = MobilityPolicy(false, null, "charge-reconnect-v1"),
                            mapsAvailable = false,
                            call = call,
                        ),
                )
            val commands = mutableListOf<MobilityCommand>()
            compose.setContent {
                CompositionLocalProvider(
                    LocalContext provides localized,
                    LocalConfiguration provides config,
                    LocalResources provides localized.resources,
                ) {
                    MaterialTheme(colorScheme = opsColorScheme(false)) {
                        Scaffold(bottomBar = { CallOverlay(board, commands::add, {}) }) { padding ->
                            Text(
                                "Offline summary rendering — no network",
                                Modifier.padding(padding),
                            )
                        }
                    }
                }
            }
            assertTrue(commands.isEmpty())
            compose.onNodeWithText(message.body!!).performScrollTo().assertIsDisplayed()
            compose
                .onNodeWithText(localized.getString(R.string.call_followup_to, message.to))
                .assertIsDisplayed()
            shot("summary-draft-$capture-message.png")
            compose
                .onNodeWithText(localized.getString(R.string.call_send_message))
                .performScrollTo()
                .performClick()
            assertEquals(listOf(MobilityCommand.Followup(id, message.id, true)), commands)
            // A callback is not an acknowledgement: the draft stays actionable until new state
            // arrives.
            compose
                .onNodeWithText(localized.getString(R.string.call_send_message))
                .assertIsDisplayed()
            compose.onNodeWithText(expectedClock).performScrollTo().assertIsDisplayed()
            shot("summary-draft-$capture-calendar.png")
            compose
                .onNodeWithText(localized.getString(R.string.call_add_calendar))
                .performScrollTo()
                .performClick()
            compose.onNodeWithText(localized.getString(R.string.call_save_summary)).performClick()
            assertEquals(
                listOf(
                    MobilityCommand.Followup(id, message.id, true),
                    MobilityCommand.Followup(id, calendar.id, true),
                    MobilityCommand.CallSave(id),
                ),
                commands,
            )
        } finally {
            Locale.setDefault(previousLocale)
            TimeZone.setDefault(previousZone)
        }
    }

    private fun shot(name: String) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val output = File(context.getExternalFilesDir(null), "verification/$name")
        output.parentFile?.mkdirs()
        output.outputStream().use { stream ->
            assertTrue(
                compose
                    .onRoot()
                    .captureToImage()
                    .asAndroidBitmap()
                    .compress(Bitmap.CompressFormat.PNG, 100, stream),
            )
        }
    }
}
