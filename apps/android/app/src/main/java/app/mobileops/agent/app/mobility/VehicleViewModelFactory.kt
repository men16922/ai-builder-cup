package app.mobileops.agent.app.mobility

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import app.mobileops.agent.mobility.MobilityRepository

/** Inject the session-owned repository; feature screens never construct HTTP clients. */
class VehicleViewModelFactory(private val repository: MobilityRepository) :
    ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        require(modelClass.isAssignableFrom(VehicleViewModel::class.java))
        @Suppress("UNCHECKED_CAST")
        return VehicleViewModel(repository) as T
    }
}
