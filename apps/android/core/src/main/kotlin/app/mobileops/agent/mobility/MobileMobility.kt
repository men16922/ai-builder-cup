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
 * Separate vehicle and conversation jobs keep simulated movement and Stop usable during model
 * latency. Neither lane retries. Session generations fence both after sign-out or permission loss.
 */
class MobileMobility(private val scope: CoroutineScope) : MobilityRepository {
    private val mutableState = MutableStateFlow(VehicleBoard())
    override val state = mutableState.asStateFlow()
    private var api: MobileMobilityApi? = null
    private var generation = 0L
    private var callSequence = 0L
    private var journeyEpoch = 0L
    private var job: Job? = null
    private var callJob: Job? = null

    fun attach(next: MobileMobilityApi?) {
        detach()
        api = next
        mutableState.value = VehicleBoard(available = next != null)
        if (next != null) refresh()
    }

    fun detach() {
        generation++
        callSequence++
        journeyEpoch++
        job?.cancel()
        callJob?.cancel()
        job = null
        callJob = null
        api = null
        mutableState.value = VehicleBoard()
    }

    override fun refresh() {
        val client = api ?: return
        if (state.value.busy) return
        journeyEpoch++
        run(false, false, false) { client.mobility() }
    }

    override fun command(command: MobilityCommand) = dispatch(command, false)

    override fun advanceAutomatically(journeyId: String) {
        if (!state.value.journeyRunning) return
        dispatch(MobilityCommand.Advance(journeyId), true)
    }

    private fun dispatch(command: MobilityCommand, automatic: Boolean) {
        val client = api ?: return
        val conversation =
            command is MobilityCommand.CallAnswer ||
                command is MobilityCommand.CallSay ||
                command is MobilityCommand.CallDelegate ||
                command is MobilityCommand.CallEnd
        if (state.value.busy || conversation && state.value.callBusy) return
        if (command is MobilityCommand.Stop) journeyEpoch++
        val body = command.body(state.value.state?.vehicle?.version)
        val key = UUID.randomUUID().toString()
        if (conversation) {
            runCall { client.mobilityCommand(body, key) }
            return
        }
        val explicitStart =
            !automatic &&
                (command is MobilityCommand.RequestTrip ||
                    command is MobilityCommand.SelectDestination ||
                    command is MobilityCommand.Advance)
        val running =
            command !is MobilityCommand.Stop && (state.value.journeyRunning || explicitStart)
        run(running, explicitStart, true) { client.mobilityCommand(body, key) }
    }

    private fun run(
        running: Boolean,
        explicitStart: Boolean,
        mutation: Boolean,
        action: suspend () -> MobilityState,
    ) {
        val ticket = generation
        val epoch = journeyEpoch
        mutableState.value =
            state.value.copy(
                busy = true,
                failure = null,
                failureCode = null,
                journeyRunning = running,
            )
        job = scope.launch {
            try {
                val result = action().also { it.validate() }
                if (ticket == generation) {
                    val current = state.value
                    val replaced =
                        !mutation &&
                            current.state?.vehicle != null &&
                            current.state.vehicle.id != result.vehicle?.id
                    if (replaced) callSequence++
                    val merged = mergeMobilityState(current.state, result)
                    mutableState.value =
                        current.copy(
                            available = true,
                            busy = false,
                            state = merged,
                            callBusy = if (replaced) false else current.callBusy,
                            journeyRunning =
                                merged.journey?.state == "moving" &&
                                    mutation &&
                                    epoch == journeyEpoch &&
                                    (explicitStart || running && current.journeyRunning),
                        )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (ticket == generation) fail(error, false)
            }
        }
    }

    private fun runCall(action: suspend () -> MobilityState) {
        val ticket = generation
        val sequence = ++callSequence
        mutableState.value = state.value.copy(callBusy = true, failure = null, failureCode = null)
        callJob = scope.launch {
            try {
                val result = action().also { it.validate() }
                if (ticket == generation && sequence == callSequence) {
                    val current = state.value
                    val merged = mergeMobilityState(current.state, result)
                    mutableState.value =
                        current.copy(
                            state = merged,
                            callBusy = false,
                            journeyRunning =
                                current.journeyRunning && merged.journey?.state == "moving",
                        )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (ticket == generation && sequence == callSequence) fail(error, true)
            }
        }
    }

    private fun fail(error: Exception, conversation: Boolean) {
        val failure = (error as? MobileFailure)?.reason ?: Failure.UNAVAILABLE
        val denied = failure in setOf(Failure.SIGN_IN, Failure.DENIED)
        journeyEpoch++
        if (denied) {
            generation++
            callSequence++
        }
        val current = if (denied) VehicleBoard(available = true) else state.value
        mutableState.value =
            current.copy(
                state = if (denied) null else current.state,
                busy = if (conversation) current.busy else false,
                callBusy = if (conversation) false else current.callBusy,
                failure = failure,
                failureCode = (error as? MobileFailure)?.protocolCode,
                journeyRunning = false,
            )
    }
}
