package app.mobileops.agent

import app.mobileops.agent.mobility.MobileMobilityApi
import app.mobileops.agent.mobility.MobilityState
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.*

enum class Failure {
    OFFLINE,
    SIGN_IN,
    DENIED,
    STALE,
    INVALID_RESPONSE,
    UNAVAILABLE,
}

class MobileFailure(val reason: Failure) : Exception(reason.name)

/** Implemented by Firebase ID-token identity in a configured build. No credentials in DTO/state. */
interface IdentityPort {
    val actorId: String?

    suspend fun tokenFor(actorId: String): String
}

interface MobileApi {
    val scope: Scope

    suspend fun inbox(filter: String, cursor: String? = null): Inbox

    suspend fun detail(id: String): Workflow

    suspend fun original(plan: PlanPayload): OriginalEvidence

    suspend fun mutate(request: Mutation): Workflow
}

enum class Operation(val segment: String) {
    REVIEW("review"),
    APPROVE("decision"),
    REJECT("decision"),
    CHANGES(
        "decision",
    ),
    EXECUTE("execute"),
    HANDOFF("handoff"),
    CANCEL("cancel"),
}

// An ambiguous mutation may ONLY be retried with this exact key/path/body in this session.
interface JsonPost {
    val body: String

    val key: String
}

data class Mutation(
    val operation: Operation,
    val planId: String,
    val recordId: String,
    override val body: String,
    override val key: String,
) : JsonPost {
    val path: String
        get() =
            "/${
            if (operation in setOf(
                    Operation.HANDOFF,
                    Operation.CANCEL,
                )
            ) "executions" else "plans"
        }/$recordId/${operation.segment}"

    init {
        require(uuid(planId) && uuid(recordId) && uuid(key) && body.toByteArray().size <= 32768)
    }

    companion object {
        fun create(
            operation: Operation,
            view: Workflow,
            note: String = "",
            key: String = UUID.randomUUID().toString(),
        ): Mutation {
            require(note.length <= 2000)
            val p = view.plan
            val execution = operation in setOf(Operation.HANDOFF, Operation.CANCEL)
            val body = buildJsonObject {
                if (!execution) {
                    put("expectedVersion", p.payload.version)
                    put("expectedDigest", p.digest)
                }
                if (operation in setOf(Operation.APPROVE, Operation.REJECT, Operation.CHANGES)) {
                    put(
                        "decision",
                        when (operation) {
                            Operation.APPROVE -> "approve"
                            Operation.REJECT -> "reject"
                            else -> "request_changes"
                        },
                    )
                    put("note", note)
                }
                if (operation == Operation.EXECUTE) put("planId", p.payload.planId)
                if (operation == Operation.HANDOFF) {
                    require(note.isNotBlank())
                    put("note", note)
                }
            }
                .toString()
            return Mutation(
                operation,
                p.payload.planId,
                if (execution) requireNotNull(view.execution).id else p.payload.planId,
                body,
                key,
            )
        }
    }
}

data class HttpReply(val status: Int, val contentType: String?, val body: String)

fun interface HttpPort {
    suspend fun request(url: URI, token: String, mutation: JsonPost?): HttpReply
}

/**
 * No redirect, cookie persistence, response logging or automatic retries. Platform TLS verification
 * stays enabled.
 */
class UrlConnectionPort : HttpPort {
    override suspend fun request(url: URI, token: String, mutation: JsonPost?): HttpReply =
        coroutineScope {
            val connection = url.toURL().openConnection() as HttpURLConnection
            val reading =
                async(Dispatchers.IO) {
                    try {
                        connection.instanceFollowRedirects = false
                        connection.useCaches = false
                        connection.connectTimeout = 10_000
                        connection.readTimeout = 35_000
                        connection.requestMethod = if (mutation == null) "GET" else "POST"
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.setRequestProperty("Accept", "application/json")
                        if (mutation != null) {
                            val body = mutation.body.toByteArray(Charsets.UTF_8)
                            connection.setRequestProperty("Content-Type", "application/json")
                            connection.setRequestProperty("Idempotency-Key", mutation.key)
                            connection.setFixedLengthStreamingMode(body.size)
                            connection.doOutput = true
                            connection.outputStream.use { it.write(body) }
                        }
                        val status = connection.responseCode
                        // Do not surface server error bodies (or transport exception strings) to
                        // UI/logs.
                        if (status != 200)
                            return@async HttpReply(status, connection.contentType, "")
                        if (connection.contentLengthLong > 2_097_152)
                            throw MobileFailure(Failure.INVALID_RESPONSE)
                        val buffer = java.io.ByteArrayOutputStream()
                        connection.inputStream.use { input ->
                            val chunk = ByteArray(8192)
                            while (true) {
                                val count = input.read(chunk)
                                if (count < 0) break
                                if (buffer.size() + count > 2_097_152)
                                    throw MobileFailure(Failure.INVALID_RESPONSE)
                                buffer.write(chunk, 0, count)
                            }
                        }
                        HttpReply(status, connection.contentType, buffer.toString("UTF-8"))
                    } catch (_: IOException) {
                        currentCoroutineContext().ensureActive()
                        throw MobileFailure(Failure.OFFLINE)
                    } finally {
                        connection.disconnect()
                    }
                }
            // await is cancellable even while the IO dispatcher is blocked in a socket read.
            // Disconnect before coroutineScope joins that child, so sign-out does not wait 35
            // seconds.
            try {
                reading.await()
            } finally {
                if (!reading.isCompleted) connection.disconnect()
            }
        }
}

class GcpMobileClient(
    origin: String,
    override val scope: Scope,
    private val identity: IdentityPort,
    private val http: HttpPort = UrlConnectionPort(),
    allowLoopback: Boolean = false,
) : MobileApi, MobileNotificationApi, MobileMobilityApi, MobileAgentApi {
    private val origin =
        URI(origin).also {
            require(
                it.rawUserInfo == null &&
                    it.rawQuery == null &&
                    it.rawFragment == null &&
                    it.host != null &&
                    it.rawPath.isNullOrEmpty(),
            )
            require(
                it.scheme == "https" ||
                    allowLoopback &&
                        it.scheme == "http" &&
                        it.host in
                            setOf(
                                "127.0.0.1",
                                "localhost",
                            ),
            )
        }

    private suspend fun request(path: String, mutation: JsonPost? = null): String {
        if (identity.actorId != scope.actorId) throw MobileFailure(Failure.SIGN_IN)
        val token = identity.tokenFor(scope.actorId)
        if (
            identity.actorId != scope.actorId ||
                token.isBlank() ||
                token.any { it == '\r' || it == '\n' }
        )
            throw MobileFailure(
                Failure.SIGN_IN,
            )
        val reply = http.request(URI(origin.toString() + scope.path + path), token, mutation)
        if (identity.actorId != scope.actorId) throw MobileFailure(Failure.SIGN_IN)
        if (reply.status != 200)
            throw MobileFailure(
                when (reply.status) {
                    401 -> Failure.SIGN_IN
                    403,
                    404 -> Failure.DENIED
                    409,
                    410 -> Failure.STALE
                    else -> Failure.UNAVAILABLE
                },
            )
        if (
            reply.contentType?.substringBefore(';')?.trim() != "application/json" ||
                reply.body.toByteArray().size > 2_097_152
        )
            throw MobileFailure(Failure.INVALID_RESPONSE)
        return reply.body
    }

    private inline fun <T> decode(block: () -> T): T =
        try {
            block()
        } catch (_: RuntimeException) {
            throw MobileFailure(Failure.INVALID_RESPONSE)
        }

    override suspend fun mobility(): MobilityState {
        val response = request("/mobility")
        return decode { wireJson.decodeFromString<MobilityState>(response).also { it.validate() } }
    }

    override suspend fun mobilityCommand(body: String, key: String): MobilityState {
        val mutation =
            object : JsonPost {
                override val body = body
                override val key = key
            }
        val response = request("/mobility", mutation)
        return decode { wireJson.decodeFromString<MobilityState>(response).also { it.validate() } }
    }

    override suspend fun inbox(filter: String, cursor: String?): Inbox {
        require(filter in setOf("pending", "results", "all") && (cursor == null || uuid(cursor)))
        val body = request("/inbox?status=$filter&limit=20" + (cursor?.let { "&cursor=$it" } ?: ""))
        return decode { wireJson.decodeFromString<Inbox>(body).also { it.validate(scope, filter) } }
    }

    override suspend fun detail(id: String): Workflow {
        require(uuid(id))
        val body = request("/plans/$id")
        return decode { wireJson.decodeFromString<Workflow>(body).also { it.validate(scope, id) } }
    }

    override suspend fun original(plan: PlanPayload): OriginalEvidence {
        plan.validate(scope)
        val body = request("/observations/${plan.evidence.snapshotId}")
        return decode { originalEvidence(body, plan, scope) }
    }

    override suspend fun mutate(request: Mutation): Workflow {
        val body = request(request.path, request)
        return decode {
            wireJson.decodeFromString<Workflow>(body).also { it.validate(scope, request.planId) }
        }
    }

    override suspend fun notificationsConfigured(): Boolean {
        val body = request("/devices")
        return decode { NotificationConfiguration.parse(body).configured }
    }

    override suspend fun registerDevice(input: DeviceRegistration, key: String): DeviceReceipt {
        input.validate()
        require(uuid(key))
        val encoded = buildJsonObject {
            put("installationId", input.installationId)
            put(
                "expectedGeneration",
                input.expectedGeneration?.let(::JsonPrimitive) ?: JsonNull,
            )
            put("token", input.token)
        }
        val body = request("/devices", NotificationPost(encoded.toString(), key))
        return decode {
            DeviceReceipt.parse(body).also {
                require(it.active && it.installationId == input.installationId)
            }
        }
    }

    override suspend fun revokeDevice(device: DeviceReceipt): DeviceReceipt {
        device.validate()
        val body =
            request(
                "/devices/${device.installationId}/revoke",
                NotificationPost(
                    buildJsonObject {
                        put(
                            "expectedGeneration",
                            device.generation,
                        )
                    }
                        .toString(),
                ),
            )
        return decode {
            DeviceReceipt.parse(body).also {
                require(
                    !it.active &&
                        it.installationId == device.installationId &&
                        it.generation == device.generation,
                )
            }
        }
    }

    override suspend fun resolveNotification(data: GcpNotification): Workflow {
        data.validate()
        val body =
            request(
                "/notifications",
                NotificationPost(wireJson.encodeToString(GcpNotification.serializer(), data)),
            )
        return decode {
            wireJson.decodeFromString<Workflow>(body).also {
                it.validate(
                    scope,
                    data.planId,
                )
                require(it.plan.payload.version.toString() == data.planVersion)
            }
        }
    }

    override suspend fun agentTasks(): List<AgentTask> {
        val body = request("/agent-tasks")
        return decode {
            wireJson.decodeFromString<AgentTaskList>(body).also { it.validate() }.items
        }
    }

    override suspend fun agentTask(id: String): AgentTask {
        require(uuid(id))
        val body = request("/agent-tasks/$id")
        return decode {
            wireJson.decodeFromString<AgentTask>(body).also {
                it.validate()
                require(it.id == id)
            }
        }
    }

    override suspend fun sendInstruction(
        instruction: String,
        language: String,
        key: String,
    ): AgentTask {
        require(
            instruction.isNotBlank() &&
                instruction.length <= 1000 &&
                language in
                    setOf(
                        "ko",
                        "en",
                    ) &&
                uuid(key),
        )
        val body =
            request(
                "/agent-tasks",
                AgentPost(agentInstructionBody(instruction.trim(), language), key),
            )
        return decode { wireJson.decodeFromString<AgentTask>(body).also { it.validate() } }
    }

    override suspend fun decideTask(id: String, approve: Boolean, key: String): AgentTask {
        require(uuid(id) && uuid(key))
        val body = request("/agent-tasks/$id/decision", AgentPost(agentDecisionBody(approve), key))
        return decode {
            wireJson.decodeFromString<AgentTask>(body).also {
                it.validate()
                require(it.id == id)
            }
        }
    }

    override suspend fun retireDevice(installationId: String, registrationKey: String) {
        require(uuid(installationId) && uuid(registrationKey))
        val body =
            request(
                "/devices/$installationId/retire",
                NotificationPost(
                    buildJsonObject { put("registrationKey", registrationKey) }.toString(),
                ),
            )
        decode {
            val value = wireJson.parseToJsonElement(body).jsonObject
            require(value.keys == setOf("retired") && value["retired"] == JsonPrimitive(true))
        }
    }
}
