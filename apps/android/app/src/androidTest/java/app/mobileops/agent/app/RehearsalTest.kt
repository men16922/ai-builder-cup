package app.mobileops.agent.app

import android.content.res.Configuration
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import java.util.Locale
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/**
 * Synthetic data is injected into the retained ViewModel by tests, never launched from product UI.
 */
class RehearsalTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun label(id: Int) = compose.activity.getString(id)

    private fun enter(edition: String) {
        compose.runOnUiThread {
            ViewModelProvider(compose.activity)[OnboardingViewModel::class.java].finish()
            ViewModelProvider(compose.activity)[MobileViewModel::class.java].connect(edition)
        }
        compose.onNodeWithText(label(R.string.operations_tab)).performScrollTo().performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_error_sample_scenario))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    @Test
    fun reviewAndExecuteRequireSeparateConfirmationAndHandoffSurvivesRotation() {
        enter("personal")
        compose
            .onNodeWithText(label(R.string.ui_error_sample_scenario))
            .performScrollTo()
            .performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_confirm_review))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose
            .onNodeWithText(label(R.string.ui_confirm_review))
            .performScrollTo()
            .assertIsNotEnabled()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNodeWithText(label(R.string.ui_confirm_review)).performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_run_fixed_read_explicitly))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose
            .onNodeWithText(label(R.string.ui_run_fixed_read_explicitly))
            .performScrollTo()
            .assertIsNotEnabled()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose
            .onNodeWithText(label(R.string.ui_run_fixed_read_explicitly))
            .performScrollTo()
            .performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_04_handoff))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose
            .onNodeWithText(label(R.string.ui_next_checks))
            .performScrollTo()
            .performTextInput("Follow up incomplete evidence")
        compose.onNodeWithText(label(R.string.ui_save_handoff)).performScrollTo().performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText("Follow up incomplete evidence")
                .fetchSemanticsNodes()
                .size >= 2
        }
        compose.activityRule.scenario.recreate()
        compose.waitUntil {
            compose
                .onAllNodesWithText("Follow up incomplete evidence")
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
    }

    @Test
    fun guideCanReplayAndPreservesPageOnRotation() {
        compose.runOnUiThread {
            ViewModelProvider(compose.activity)[OnboardingViewModel::class.java].replay()
        }
        compose.onNodeWithTag("onboarding_next").performScrollTo().performClick()
        compose
            .onNodeWithTag("onboarding_progress")
            .assertTextEquals(label(R.string.onboarding_progress).format(2, 3))
        compose.activityRule.scenario.recreate()
        compose
            .onNodeWithTag("onboarding_progress")
            .assertTextEquals(label(R.string.onboarding_progress).format(2, 3))
        compose.onNodeWithTag("onboarding_skip").performScrollTo().performClick()
        compose.activityRule.scenario.recreate()
        compose.onAllNodesWithTag("onboarding_progress").assertCountEquals(0)
    }

    @Test
    fun resourcesFollowLanguageRatherThanCountryAndUnsupportedLocalesFallBackToEnglish() {
        fun locale(language: String, country: String) =
            compose.activity.createConfigurationContext(
                Configuration(compose.activity.resources.configuration).apply {
                    setLocale(Locale(language, country))
                },
            )
        assertEquals("ko", locale("ko", "US").getString(R.string.agent_request_language))
        assertEquals("en", locale("en", "KR").getString(R.string.agent_request_language))
        assertEquals("en", locale("ja", "JP").getString(R.string.agent_request_language))
        assertEquals("시작하기", locale("ko", "US").getString(R.string.onboarding_finish))
        assertEquals("Get started", locale("en", "KR").getString(R.string.onboarding_finish))
    }

    @Test
    fun originalEvidenceKeepsEmptySamplesDistinctFromZero() {
        enter("personal")
        compose
            .onNodeWithText(label(R.string.ui_error_sample_scenario))
            .performScrollTo()
            .performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_original_plan_evidence))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose
            .onNodeWithText(label(R.string.ui_returned_request_count))
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText("100").performScrollTo().assertIsDisplayed()
        compose
            .onNodeWithText(label(R.string.ui_show_deployment_details_and_sources))
            .performScrollTo()
            .performClick()
        compose
            .onNodeWithText(
                label(R.string.ui_service_recheck) + " · " + label(R.string.ui_collected),
            )
            .performScrollTo()
            .assertIsDisplayed()
        compose.onNodeWithText(label(R.string.ui_inbox)).performScrollTo().performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_empty_sample_scenario))
                .fetchSemanticsNodes()
                .isNotEmpty()
        }
        compose
            .onNodeWithText(label(R.string.ui_empty_sample_scenario))
            .performScrollTo()
            .performClick()
        compose.waitUntil {
            compose
                .onAllNodesWithText(label(R.string.ui_no_samples_not_zero))
                .fetchSemanticsNodes()
                .size >= 3
        }
        compose
            .onNodeWithText(label(R.string.ui_application_health_unknown))
            .performScrollTo()
            .assertIsDisplayed()
    }
}
