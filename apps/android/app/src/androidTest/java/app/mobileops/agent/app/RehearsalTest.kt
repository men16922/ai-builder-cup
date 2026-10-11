package app.mobileops.agent.app

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test

/** Device evidence only after connectedDebugAndroidTest actually runs. */
class RehearsalTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun reviewExecuteHandoffRotationAndOffline() {
        // Normalize the persisted display preference using a visible language switch.
        if (compose.onAllNodesWithText("English").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("English").performClick()
        compose.onNodeWithText("Start personal rehearsal").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Error sample scenario").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Error sample scenario").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Confirm review").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Confirm review").performScrollTo().assertIsNotEnabled()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNodeWithText("Confirm review").performClick()
        compose.waitUntil { compose.onAllNodesWithText("Run fixed read explicitly").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Run fixed read explicitly").performScrollTo().assertIsNotEnabled()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNodeWithText("Run fixed read explicitly").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("04 · Handoff").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Next checks").performScrollTo().performTextInput("Follow up the incomplete evidence")
        compose.onNodeWithText("Save handoff").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Follow up the incomplete evidence").fetchSemanticsNodes().size >= 2 }
        compose.activityRule.scenario.recreate()
        compose.waitUntil { compose.onAllNodesWithText("Follow up the incomplete evidence").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Simulate offline").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Connection lost. Records are hidden and nothing is submitted automatically.").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Follow up the incomplete evidence").assertCountEquals(0)
        compose.onNodeWithText("Restore demo connection").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Inbox").fetchSemanticsNodes().isNotEmpty() }
    }
    @Test fun koreanOrganizationEntry() {
        if (compose.onAllNodesWithText("한국어").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("한국어").performClick()
        compose.onNodeWithText("조직 시연 시작").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("오류 표본 시나리오").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("조직용 · 합성").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("공간 나가기").performClick()
        compose.onNodeWithText("개인 시연 시작").performScrollTo().assertIsDisplayed()
    }
    @Test fun originalEvidenceShowsBoundedSamplesAndEmptyIsNotZero() {
        if (compose.onAllNodesWithText("English").fetchSemanticsNodes().isNotEmpty()) compose.onNodeWithText("English").performClick()
        compose.onNodeWithText("Start personal rehearsal").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Error sample scenario").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Error sample scenario").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Original plan evidence").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Returned request count").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("100").assertIsDisplayed()
        compose.onNodeWithText("Show deployment details and sources").performScrollTo().performClick()
        compose.onNodeWithText("Service recheck · Collected").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("← Inbox").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("Empty sample scenario").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Empty sample scenario").performScrollTo().performClick()
        compose.waitUntil { compose.onAllNodesWithText("No samples · not zero").fetchSemanticsNodes().size >= 3 }
        compose.onNodeWithText("Application health · Unknown").performScrollTo().assertIsDisplayed()
    }
}
