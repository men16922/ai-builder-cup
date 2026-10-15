package app.mobileops.agent.mobility

/**
 * Vehicle progress and conversation progress are independent. A slow reply from either stream must
 * retain the newest confirmed version of the other, including an explicit stop or unknown call.
 */
internal fun mergeMobilityState(current: MobilityState?, incoming: MobilityState): MobilityState {
    if (
        current?.vehicle == null ||
            incoming.vehicle == null ||
            current.vehicle.id != incoming.vehicle.id
    )
        return incoming
    val base = if (incoming.vehicle.version < current.vehicle.version) current else incoming
    val conversation = if (incoming.callRevision < current.callRevision) current else incoming
    val journey =
        base.journey?.let {
            if (conversation.journey?.id == it.id)
                it.copy(autopilot = it.state == "moving" && conversation.journey.autopilot)
            else it
        }
    return base.copy(
        journey = journey,
        call = conversation.call,
        calls = conversation.calls,
        callRevision = conversation.callRevision,
    )
}
