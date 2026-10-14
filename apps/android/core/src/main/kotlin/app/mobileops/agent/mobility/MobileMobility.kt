package app.mobileops.agent.mobility

import app.mobileops.agent.Failure
import app.mobileops.agent.MobileFailure
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Session generations fence late replies. Unknown commands are never resent, even after rotation.
 */
class MobileMobility(private val scope: CoroutineScope) : MobilityRepository {
    private val mutableState = MutableStateFlow(VehicleBoard())
    override val state = mutableState.asStateFlow()
    private var api: MobileMobilityApi? = null
    private var generation = 0L
    private var job: Job? = null

    fun attach(next: MobileMobilityApi?) {
        detach()
        api = next
        mutableState.value = VehicleBoard(available = next != null)
        if (next != null) refresh()
    }

    fun detach() {
        generation++
        job?.cancel()
        job = null
        api = null
        mutableState.value = VehicleBoard()
    }

    override fun refresh() {
        val client = api ?: return
        if (state.value.busy) return
        run(false) { client.mobility() }
    }

    override fun command(command: MobilityCommand) {
        val client = api ?: return
        if (state.value.busy) return
        val body = command.body(state.value.state?.vehicle?.version)
        val key = UUID.randomUUID().toString()
        val running =
            state.value.journeyRunning ||
                command is MobilityCommand.RequestTrip ||
                command is MobilityCommand.SelectDestination ||
                command is MobilityCommand.Advance
        run(running) { client.mobilityCommand(body, key) }
    }

    override fun advanceAutomatically(journeyId: String) {
        if (!state.value.journeyRunning) return
        command(MobilityCommand.Advance(journeyId))
    }

    private fun run(running: Boolean, action: suspend () -> MobilityState) {
        val ticket = generation
        mutableState.value = state.value.copy(busy = true, failure = null, journeyRunning = running)
        job = scope.launch {
            try {
                val result = action().also { it.validate() }
                if (ticket == generation)
                    mutableState.value =
                        VehicleBoard(
                            available = true,
                            state = result,
                            journeyRunning = running && result.journey?.state == "moving",
                        )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (ticket == generation) {
                    val failure = (error as? MobileFailure)?.reason ?: Failure.UNAVAILABLE
                    // Authentication/permission failures clear previous vehicle and location data.
                    mutableState.value =
                        VehicleBoard(
                            available = true,
                            state =
                                if (failure in setOf(Failure.SIGN_IN, Failure.DENIED)) null
                                else state.value.state,
                            failure = failure,
                        )
                }
            }
        }
    }
}
