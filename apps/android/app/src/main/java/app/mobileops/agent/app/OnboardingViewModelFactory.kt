package app.mobileops.agent.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.mobileops.agent.app.data.OnboardingPreferences

class OnboardingViewModelFactory(private val preferences: OnboardingPreferences) :
    ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(OnboardingViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return OnboardingViewModel(preferences) as T
    }
}
