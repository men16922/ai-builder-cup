package app.mobileops.agent.mobility

import java.time.Instant
import java.util.UUID
import kotlinx.serialization.Serializable

@Serializable
data class Coordinate(val latitude: Double, val longitude: Double) {
    fun validate() {
        require(
            latitude.isFinite() &&
                longitude.isFinite() &&
                latitude in -85.0..85.0 &&
                longitude in -180.0..180.0,
        )
    }
}

/** Simulated telemetry is explicitly labelled; this DTO cannot address a physical vehicle. */
@Serializable
data class SimulatedVehicle(
    val id: String,
    val version: Int,
    val source: String,
    val model: String,
    val observedAt: String,
    val batteryPercent: Int,
    val targetPercent: Int,
    val batteryCelsius: Double,
    val rangeKm: Int,
    val parked: Boolean,
    val charging: String,
    val powerKw: Double,
    val fault: String,
    val episode: String,
    val attempts: Int,
    val location: Coordinate,
    val diagnosticSignal: String = "unclassified",
) {
    fun validate() {
        require(diagnosticSignal in DIAGNOSTIC_SIGNALS)
        UUID.fromString(id)
        UUID.fromString(episode)
        Instant.parse(observedAt)
        location.validate()
        require(
            version > 0 &&
                source == "simulation" &&
                model == "Aide EV" &&
                batteryPercent in 0..100 &&
                targetPercent in 50..100,
        )
        require(
            batteryCelsius.isFinite() &&
                batteryCelsius in -20.0..80.0 &&
                rangeKm >= 0 &&
                powerKw.isFinite() &&
                powerKw in 0.0..350.0,
        )
        require(
            charging in setOf("idle", "charging", "interrupted") &&
                fault in setOf("none", "charge_handshake", "battery_hot", "unknown") &&
                attempts in 0..1,
        )
    }
}

@Serializable
data class MobilityPlace(
    val id: String,
    val name: String,
    val address: String,
    val location: Coordinate,
    val kind: String,
    val source: String,
    val fetchedAt: String,
    val rating: Double? = null,
    val chargingPorts: Int? = null,
    val availablePorts: Int? = null,
    val mapsUrl: String? = null,
) {
    fun validate() {
        require(
            Regex("^[A-Za-z0-9_-]{1,200}$").matches(id) &&
                name.length in 1..160 &&
                address.length <= 240,
        )
        require(
            kind in setOf("restaurant", "charging", "poi") &&
                source in setOf("google-places", "google-maps-mcp"),
        )
        require(rating == null || rating.isFinite() && rating in 0.0..5.0)
        require(chargingPorts == null || chargingPorts >= 0)
        require(availablePorts == null || availablePorts >= 0)
        mapsUrl?.let {
            val uri = java.net.URI(it)
            require(
                uri.scheme == "https" &&
                    uri.host in setOf("www.google.com", "maps.google.com", "maps.app.goo.gl") &&
                    uri.userInfo == null &&
                    (uri.port == -1 || uri.port == 443) &&
                    (uri.host != "www.google.com" ||
                        Regex("^/maps(?:/|$)").containsMatchIn(uri.path)) &&
                    it.length <= 2048,
            )
        }
        Instant.parse(fetchedAt)
        location.validate()
    }
}

@Serializable
data class MobilityReport(
    val id: String,
    val at: String,
    val state: String,
    val engine: String,
    val summary: String,
    val evidence: List<String>,
    val unknowns: List<String>,
    val runbook: String,
    val beforeVersion: Int,
    val authorization: String,
    val episode: String,
    val afterVersion: Int? = null,
    val guidance: RecoveryGuidance? = null,
    val caseId: String? = null,
    val language: String = "en",
    val remedy: VerifiedChargingRemedy? = null,
) {
    fun validate() {
        UUID.fromString(id)
        UUID.fromString(episode)
        Instant.parse(at)
        require(
            state in setOf("investigating", "remediated", "needs_decision", "escalated", "unknown"),
        )
        require(
            engine in setOf("gemini", "offline-fixture", "guardian") && summary.length in 1..1000,
        )
        require(
            evidence.size <= 8 &&
                evidence.all { it.length <= 160 } &&
                unknowns.size <= 8 &&
                unknowns.all { it.length <= 240 },
        )
        require(
            runbook in setOf("charge-reconnect-v1", "none") &&
                beforeVersion > 0 &&
                (afterVersion == null || afterVersion > 0),
        )
        require(authorization in setOf("standing-policy", "human-decision", "read-only"))
        require(language in setOf("en", "ko"))
        remedy?.validate()
        guidance?.validate()
        caseId?.let(UUID::fromString)
    }
}

@Serializable
data class SimulatedJourney(
    val id: String,
    val state: String,
    val kind: String,
    val origin: Coordinate,
    val candidates: List<MobilityPlace>,
    val progress: Double,
    val position: Coordinate,
    val consent: String,
    val createdAt: String,
    val expiresAt: String,
    val source: String,
    val destination: MobilityPlace? = null,
    val searchSummary: String? = null,
) {
    fun validate() {
        require(searchSummary == null || searchSummary.length <= 8000)
        UUID.fromString(id)
        Instant.parse(createdAt)
        Instant.parse(expiresAt)
        origin.validate()
        position.validate()
        require(
            state in setOf("choosing", "moving", "arrived", "cancelled") &&
                kind in setOf("restaurant", "charging", "poi"),
        )
        require(
            consent in
                setOf(
                    "selection-required",
                    "explicit-selection",
                    "remembered-context",
                    "favorite",
                ) && source == "simulation",
        )
        require(progress.isFinite() && progress in 0.0..1.0 && candidates.size <= 6)
        candidates.forEach { it.validate() }
        destination?.validate()
        require(
            destination == null ||
                candidates.any { it.id == destination.id && it.location == destination.location },
        )
    }
}

/** Favorites keep a Place ID/category only; provider summaries remain with their source bundle. */
@Serializable
data class FavoritePlace(val id: String, val kind: String) {
    fun validate() {
        require(Regex("^[A-Za-z0-9_-]{1,200}$").matches(id))
        require(kind in setOf("restaurant", "charging", "poi"))
    }
}

@Serializable
data class MobilityPolicy(val enabled: Boolean, val expiresAt: String?, val runbook: String) {
    fun validate() {
        expiresAt?.let(Instant::parse)
        require(runbook == "charge-reconnect-v1")
    }
}

@Serializable
data class MobilityState(
    val vehicle: SimulatedVehicle?,
    val reports: List<MobilityReport>,
    val journey: SimulatedJourney?,
    val favorites: List<FavoritePlace>,
    val policy: MobilityPolicy,
    val mapsAvailable: Boolean,
    val mapsBrowserKey: String? = null,
    val cases: List<MobilityCase> = emptyList(),
) {
    fun validate() {
        vehicle?.validate()
        journey?.validate()
        policy.validate()
        require(reports.size <= 20 && favorites.size <= 10 && cases.size <= 10)
        cases.forEach { it.validate() }
        reports.forEach { it.validate() }
        favorites.forEach { it.validate() }
    }
}
