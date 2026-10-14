package app.mobileops.agent.app

import app.mobileops.agent.app.data.OnboardingPreferences
import org.junit.Assert.*
import org.junit.Test

class OnboardingViewModelTest {
    private class Preferences : OnboardingPreferences {
        var completed = false
        var writes = 0

        override fun isCompleted() = completed

        override fun markCompleted() {
            completed = true
            writes++
        }
    }

    @Test
    fun firstLaunchCompletesOnlyAtTheLastStepAndPersistsAcrossRestart() {
        val prefs = Preferences()
        val model = OnboardingViewModel(prefs)
        assertTrue(model.state.value.visible)
        model.next()
        model.back()
        assertEquals(0, model.state.value.page)
        model.next()
        model.next()
        assertTrue(model.state.value.lastPage)
        assertFalse(prefs.completed)
        model.next()
        assertFalse(model.state.value.visible)
        assertFalse(OnboardingViewModel(prefs).state.value.visible)
        model.next()
        assertEquals(1, prefs.writes)
    }

    @Test
    fun skipPersistsButReplayDoesNotResetTheCompletionFlag() {
        val prefs = Preferences()
        val model = OnboardingViewModel(prefs)
        model.finish()
        model.replay()
        assertTrue(model.state.value.visible)
        assertEquals(0, model.state.value.page)
        assertTrue(prefs.completed)
        assertFalse(OnboardingViewModel(prefs).state.value.visible)
    }

    @Test
    fun incompleteTutorialAppearsAgainAfterProcessRestart() {
        val prefs = Preferences()
        OnboardingViewModel(prefs).next()
        assertTrue(OnboardingViewModel(prefs).state.value.visible)
        assertEquals(0, OnboardingViewModel(prefs).state.value.page)
        assertEquals(0, prefs.writes)
    }
}
