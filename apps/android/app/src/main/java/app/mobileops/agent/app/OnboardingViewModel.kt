package app.mobileops.agent.app

import androidx.lifecycle.ViewModel
import app.mobileops.agent.app.data.OnboardingPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Display-only tutorial. It cannot sign in, review a task or execute an operation. */
class OnboardingViewModel(private val preferences: OnboardingPreferences) : ViewModel() {
    private val mutableState = MutableStateFlow(OnboardingUiState(!preferences.isCompleted()))
    val state = mutableState.asStateFlow()

    fun next() {
        if (!state.value.visible) return
        if (state.value.lastPage) finish()
        else mutableState.value = state.value.copy(page = state.value.page + 1)
    }

    fun back() {
        mutableState.value = state.value.copy(page = (state.value.page - 1).coerceAtLeast(0))
    }

    fun finish() {
        preferences.markCompleted()
        mutableState.value = state.value.copy(visible = false)
    }

    fun replay() {
        mutableState.value = OnboardingUiState(visible = true)
    }
}
