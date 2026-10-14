package app.mobileops.agent.mobility

import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Catalog-only commands. No caller-supplied owner, URL, code or physical control action. */
sealed interface MobilityCommand {
    data object Initialize : MobilityCommand

    data class Telemetry(
        val batteryPercent: Int,
        val fault: String,
        val language: String = "en",
        val signal: String? = null,
    ) : MobilityCommand

    data class Policy(val enabled: Boolean) : MobilityCommand

    data class Diagnose(val language: String) : MobilityCommand

    data class Approve(val reportId: String) : MobilityCommand

    data class ResolveUnknown(val reportId: String, val language: String) : MobilityCommand

    data class PromoteCase(val caseId: String) : MobilityCommand

    data class RevokeCase(val caseId: String) : MobilityCommand

    data class RequestTrip(val kind: String, val instruction: String, val language: String = "en") :
        MobilityCommand

    data class SelectDestination(
        val journeyId: String,
        val placeId: String,
        val remember: Boolean,
    ) : MobilityCommand

    data class Advance(val journeyId: String) : MobilityCommand

    data class Stop(val journeyId: String) : MobilityCommand

    data class Favorite(val journeyId: String, val placeId: String) : MobilityCommand

    fun body(version: Int?) = buildJsonObject {
        if (this@MobilityCommand != Initialize) {
            require(version != null && version > 0)
            put("expectedVersion", version)
        }
        when (val command = this@MobilityCommand) {
            Initialize -> put("operation", "initialize")
            is Telemetry -> {
                require(
                    command.batteryPercent in 0..100 &&
                        command.fault in
                            setOf("none", "charge_handshake", "battery_hot", "unknown"),
                )
                put("operation", "telemetry")
                put("batteryPercent", command.batteryPercent)
                put("fault", command.fault)
                require(command.language in setOf("en", "ko"))
                require(
                    command.signal == null ||
                        command.fault == "unknown" &&
                            command.signal in setOf("charge_link_timeout", "unclassified"),
                )
                put("language", command.language)
                command.signal?.let { put("signal", it) }
            }
            is Policy -> {
                put("operation", "policy")
                put("enabled", command.enabled)
            }
            is Diagnose -> {
                require(command.language in setOf("ko", "en"))
                put("operation", "diagnose")
                put("language", command.language)
            }
            is Approve -> {
                put("operation", "approve")
                put("reportId", command.reportId)
            }
            is ResolveUnknown -> {
                require(command.language in setOf("en", "ko"))
                put("operation", "resolve_unknown")
                put("reportId", command.reportId)
                put("runbook", "charge-reconnect-v1")
                put("language", command.language)
            }
            is PromoteCase -> {
                put("operation", "promote_case")
                put("caseId", command.caseId)
            }
            is RevokeCase -> {
                put("operation", "revoke_case")
                put("caseId", command.caseId)
            }
            is RequestTrip -> {
                require(
                    command.kind in setOf("restaurant", "charging", "poi") &&
                        command.instruction.length in 1..300,
                )
                require(command.language in setOf("ko", "en"))
                put("language", command.language)
                put("operation", "trip_request")
                put("kind", command.kind)
                put("instruction", command.instruction)
            }
            is SelectDestination -> {
                put("operation", "select_destination")
                put("journeyId", command.journeyId)
                put("placeId", command.placeId)
                put("remember", command.remember)
            }
            is Advance -> {
                put("operation", "advance")
                put("journeyId", command.journeyId)
            }
            is Stop -> {
                put("operation", "stop")
                put("journeyId", command.journeyId)
            }
            is Favorite -> {
                put("operation", "favorite")
                put("journeyId", command.journeyId)
                put("placeId", command.placeId)
            }
        }
    }
        .toString()
}
