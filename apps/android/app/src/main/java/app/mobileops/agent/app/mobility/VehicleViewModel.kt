package app.mobileops.agent.app.mobility

import androidx.lifecycle.ViewModel
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.MobilityRepository

/**
 * Vehicle feature state and intents. No Context, Activity, credentials, Maps SDK or mutable UI
 * state.
 */
class VehicleViewModel(private val repository: MobilityRepository) : ViewModel() {
    val state = repository.state

    fun refresh() = repository.refresh()

    fun command(command: MobilityCommand) = repository.command(command)

    fun advanceAutomatically(journeyId: String) = repository.advanceAutomatically(journeyId)

    fun diagnose(language: String) = command(MobilityCommand.Diagnose(language))
}
