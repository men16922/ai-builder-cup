package app.mobileops.agent

import java.net.URI
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class FirebaseConfiguration(
    val projectId: String,
    val apiKey: String,
    val appId: String,
    val webClientId: String,
    val tenantId: String? = null,
) {
    fun validate() {
        require(Regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$").matches(projectId))
        require(Regex("^[A-Za-z0-9_-]{20,128}$").matches(apiKey))
        require(Regex("^1:[0-9]+:android:[a-f0-9]+$").matches(appId))
        require(Regex("^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$").matches(webClientId))
        require(tenantId == null || validId(tenantId))
    }
}

@Serializable
data class WorkspaceConfiguration(
    val key: String,
    val edition: String,
    val workspaceId: String,
    val label: String,
    val organizationId: String? = null,
) {
    fun validate() {
        require(validId(key) && validId(workspaceId) && label.length in 1..128)
        require(
            when (edition) {
                "personal" -> organizationId == null
                "organization" -> organizationId?.let(::validId) == true
                else -> false
            },
        )
    }

    fun scope(actorId: String): Scope {
        validate()
        return Scope(
            actorId,
            if (edition == "personal")
                Owner(
                    "personal",
                    userId = actorId,
                )
            else Owner("organization", organizationId = organizationId),
            workspaceId,
        )
    }
}

/** Public, build-packaged settings. No credential, role, resource or arbitrary endpoint fields. */
@Serializable
data class MobileConfiguration(
    val schemaVersion: Int,
    val configured: Boolean,
    val origin: String,
    val firebase: FirebaseConfiguration,
    val workspaces: List<WorkspaceConfiguration>,
) {
    fun validate() {
        require(schemaVersion == 1 && configured)
        val url = URI(origin)
        require(
            url.scheme == "https" &&
                url.host != null &&
                url.rawUserInfo == null &&
                url.rawPath.isNullOrEmpty() &&
                url.rawQuery == null &&
                url.rawFragment == null,
        )
        require(url.port == -1 || url.port == 443)
        firebase.validate()
        require(
            workspaces.size in 1..10 &&
                workspaces.map { it.key }.distinct().size == workspaces.size,
        )
        workspaces.forEach { it.validate() }
        require(
            workspaces
                .map { listOf(it.edition, it.organizationId, it.workspaceId) }
                .distinct()
                .size == workspaces.size,
        )
    }
}

fun readMobileConfiguration(raw: String?): MobileConfiguration? {
    if (raw == null) return null
    require(raw.toByteArray().size <= 32768)
    val value = wireJson.parseToJsonElement(raw).jsonObject
    if (value == buildJsonObject { put("configured", false) }) return null
    return wireJson.decodeFromJsonElement<MobileConfiguration>(value).also { it.validate() }
}
