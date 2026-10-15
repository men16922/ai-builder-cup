package app.mobileops.agent.app

import android.graphics.Bitmap
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import app.mobileops.agent.Failure
import app.mobileops.agent.app.mobility.VehicleFailureDialog
import java.io.File
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Offline UI check: a dismissed failure stays dismissed until a new repository request fails. */
class VehicleFailureDialogTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun manualExplainsChangedStateAndNewFailureReopens() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        fun text(id: Int) = context.getString(id)
        val failure = mutableStateOf<Failure?>(Failure.STALE)
        val code = mutableStateOf<String?>("vehicle_changed")
        compose.setContent {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                VehicleFailureDialog(failure.value, code.value)
            }
        }
        compose.onNodeWithText(text(R.string.mobility_error_manual)).performClick()
        compose.onNodeWithText(text(R.string.mobility_error_changed)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.mobility_error_close)).performClick()
        compose.onAllNodesWithText(text(R.string.vehicle_request_attention)).assertCountEquals(0)
        compose.runOnIdle { failure.value = null }
        compose.waitForIdle()
        compose.runOnIdle {
            // HTTP 409 is also used for ambiguous outcomes: it must not show stale-state advice.
            code.value = "mobility_outcome_unknown"
            failure.value = Failure.STALE
        }
        compose.onNodeWithText(text(R.string.mobility_error_manual)).performClick()
        compose.onNodeWithText(text(R.string.mobility_error_unknown)).assertIsDisplayed()
        compose
            .onAllNodesWithText(text(R.string.ui_the_record_changed_or_expired))
            .assertCountEquals(0)
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        assertNotNull(bitmap)
        val output = File(context.getExternalFilesDir(null), "verification/native-error-manual.png")
        output.parentFile?.mkdirs()
        output.outputStream().use { stream ->
            assertTrue(bitmap!!.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
    }
}
