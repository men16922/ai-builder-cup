package app.mobileops.agent

import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

private fun strictNotificationObject(
    json: String,
    strings: Set<String>,
    booleans: Set<String> = emptySet()
): JsonObject {
    require(json.toByteArray().size <= 4096)
    val value = wireJson.parseToJsonElement(json).jsonObject
    require(value.keys == strings + booleans)
    strings.forEach { require(value.getValue(it).jsonPrimitive.isString) }
    booleans.forEach { require(!value.getValue(it).jsonPrimitive.isString && value.getValue(it).jsonPrimitive.booleanOrNull != null) }
    return value
}

/** Untrusted data-only locator. It cannot choose an origin, workspace, identity or action. */
@Serializable
data class GcpNotification(
    val schemaVersion: String,
    val provider: String,
    val notificationId: String,
    val installationId: String,
    val generation: String,
    val planId: String,
    val planVersion: String,
    val expiresAt: String
) {
    fun validate() {
        require(
            schemaVersion == "1" && provider == "gcp" && digest(notificationId) && uuid(
                installationId
            ) && uuid(generation) && uuid(planId)
        )
        require(Regex("^[1-9][0-9]{0,8}$").matches(planVersion)); time(expiresAt)
    }

    companion object {
        fun parse(json: String): GcpNotification {
            val value = strictNotificationObject(
                json,
                setOf(
                    "schemaVersion",
                    "provider",
                    "notificationId",
                    "installationId",
                    "generation",
                    "planId",
                    "planVersion",
                    "expiresAt"
                )
            )
            return wireJson.decodeFromJsonElement<GcpNotification>(value).also { it.validate() }
        }
    }
}

@Serializable
data class NotificationConfiguration(val configured: Boolean) {
    companion object {
        fun parse(json: String) = wireJson.decodeFromJsonElement<NotificationConfiguration>(
            strictNotificationObject(
                json,
                emptySet(),
                setOf("configured")
            )
        )
    }
}

@Serializable
data class DeviceReceipt(
    val installationId: String,
    val generation: String,
    val active: Boolean,
    val expiresAt: String
) {
    fun validate() {
        require(uuid(installationId) && uuid(generation)); time(expiresAt)
    }

    companion object {
        fun parse(json: String) = wireJson.decodeFromJsonElement<DeviceReceipt>(
            strictNotificationObject(
                json,
                setOf("installationId", "generation", "expiresAt"),
                setOf("active")
            )
        ).also { it.validate() }
    }
}

@Serializable
data class DeviceRegistration(
    val installationId: String,
    val expectedGeneration: String?,
    val token: String
) {
    fun validate() {
        require(uuid(installationId) && (expectedGeneration == null || uuid(expectedGeneration))); require(
            token.length in 20..4096 && Regex("^[A-Za-z0-9_:.-]+$").matches(token)
        )
    }

    // Avoid accidentally displaying transport addresses through an exception/debug representation.
    override fun toString() = "DeviceRegistration(redacted)"
}

internal class NotificationPost(
    override val body: String,
    override val key: String = UUID.randomUUID().toString()
) : JsonPost {
    init {
        require(uuid(key) && body.toByteArray().size <= 32768)
    }

    override fun toString() = "NotificationPost(redacted)"
}

/** Real FCM SDK/lifecycle is a separate optional app adapter. Constructing this port does no I/O. */
interface MobileNotificationApi {
    suspend fun notificationsConfigured(): Boolean
    suspend fun registerDevice(input: DeviceRegistration, key: String): DeviceReceipt
    suspend fun revokeDevice(device: DeviceReceipt): DeviceReceipt
    suspend fun retireDevice(installationId: String, registrationKey: String)
    suspend fun resolveNotification(data: GcpNotification): Workflow
}
