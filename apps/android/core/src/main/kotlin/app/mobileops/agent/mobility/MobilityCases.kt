package app.mobileops.agent.mobility

import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable

internal val DIAGNOSTIC_SIGNALS =
    setOf(
        "none",
        "charge_handshake_timeout",
        "charge_link_timeout",
        "battery_thermal_limit",
        "unclassified",
    )

/** Server-owned safety checks are presentation evidence, never client execution authority. */
@Serializable data class RecoveryCheck(val id: String, val passed: Boolean)

@Serializable
data class RecoveryGuidance(
    val id: String,
    val expiresAt: String,
    val canResolve: Boolean,
    val checks: List<RecoveryCheck>,
) {
    fun validate() {
        require(id == "review-charge-link-v1")
        Instant.parse(expiresAt)
        require(checks.size == 5)
        require(
            checks.map { it.id }.toSet() ==
                setOf("signal", "parked", "temperature", "battery", "attempts"),
        )
    }
}

/** Only simulated charging evidence; no physical vehicle address or executable action. */
@Serializable
data class ChargingEvidence(
    val fault: String,
    val diagnosticSignal: String,
    val charging: String,
    val parked: Boolean,
    val batteryCelsius: Double,
    val batteryPercent: Int,
    val targetPercent: Int,
    val attempts: Int,
) {
    fun validate() {
        require(fault in setOf("none", "charge_handshake", "battery_hot", "unknown"))
        require(diagnosticSignal in DIAGNOSTIC_SIGNALS)
        require(charging in setOf("idle", "charging", "interrupted"))
        require(batteryCelsius.isFinite() && batteryCelsius in -20.0..80.0)
        require(batteryPercent in 0..100 && targetPercent in 50..100 && attempts in 0..1)
    }
}

@Serializable data class CaseVerification(val before: ChargingEvidence, val after: ChargingEvidence)

/** A verified recovery can become a candidate. Promotion and standing policy stay separate. */
@Serializable
data class MobilityCase(
    val id: String,
    val vehicleId: String,
    val sourceReportId: String,
    val signal: String,
    val runbook: String,
    val status: String,
    val createdAt: String,
    val expiresAt: String,
    val verifiedVersion: Int,
    val verification: CaseVerification,
    val activatedAt: String? = null,
) {
    fun validate() {
        listOf(id, vehicleId, sourceReportId).forEach(UUID::fromString)
        val duration = Duration.between(Instant.parse(createdAt), Instant.parse(expiresAt))
        require(!duration.isNegative && !duration.isZero && duration <= Duration.ofDays(7))
        activatedAt?.let(Instant::parse)
        require(
            signal == "charge_link_timeout" &&
                runbook == "charge-reconnect-v1" &&
                verifiedVersion > 0,
        )
        require(status in setOf("candidate", "active", "revoked"))
        val before = verification.before
        val after = verification.after
        before.validate()
        after.validate()
        // Reject a malformed response rather than painting a failed remedy as a verified
        // experience.
        require(
            before.fault == "unknown" &&
                before.diagnosticSignal == signal &&
                before.charging == "interrupted",
        )
        require(
            before.parked &&
                before.batteryCelsius in 0.0..40.0 &&
                before.batteryPercent < before.targetPercent &&
                before.attempts == 0,
        )
        require(
            after.fault == "none" &&
                after.diagnosticSignal == "none" &&
                after.charging == "charging" &&
                after.attempts == 1,
        )
        require(
            after.parked &&
                after.batteryCelsius == before.batteryCelsius &&
                after.batteryPercent == before.batteryPercent &&
                after.targetPercent == before.targetPercent,
        )
    }
}

/** Verified simulator execution facts, separate from an earlier model hypothesis. */
@Serializable
data class VerifiedChargingRemedy(
    val source: String,
    val before: String,
    val after: String,
    val attempts: Int,
    val powerKw: Double,
    val verifiedAt: String,
) {
    fun validate() {
        require(
            source == "simulation" &&
                before == "interrupted" &&
                after == "charging" &&
                attempts == 1,
        )
        require(powerKw.isFinite() && powerKw > 0.0 && powerKw <= 350.0)
        Instant.parse(verifiedAt)
    }
}
