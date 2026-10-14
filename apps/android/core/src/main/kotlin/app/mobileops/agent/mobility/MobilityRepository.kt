package app.mobileops.agent.mobility

import app.mobileops.agent.Failure
import kotlinx.coroutines.flow.StateFlow

/** UI data boundary; authentication and session ownership remain with the main repository. */
data class VehicleBoard(
    val available: Boolean = false,
    val busy: Boolean = false,
    val state: MobilityState? = null,
    val failure: Failure? = null,
    val journeyRunning: Boolean = false,
)

interface MobilityRepository {
    val state: StateFlow<VehicleBoard>

    fun refresh()

    fun command(command: MobilityCommand)

    /** Only a confirmed local journey intent may continue automatically; reads never arm it. */
    fun advanceAutomatically(journeyId: String)
}

interface MobileMobilityApi {
    suspend fun mobility(): MobilityState

    suspend fun mobilityCommand(body: String, key: String): MobilityState
}
