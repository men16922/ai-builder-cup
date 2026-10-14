package app.mobileops.agent.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.mobileops.agent.app.data.AppContainer

class MobileViewModelFactory(private val container: AppContainer) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(MobileViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return MobileViewModel(container::createMobileRepository, container.configuration) as T
    }
}
