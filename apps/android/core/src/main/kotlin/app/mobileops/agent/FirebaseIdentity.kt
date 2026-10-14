package app.mobileops.agent

import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*

data class IdentitySession(val actorId: String, val sessionKey: String)

interface SessionIdentity : IdentityPort {
    val session: IdentitySession?

    fun subscribe(listener: () -> Unit): AutoCloseable

    fun close()
}

/** nonce is a local session-generation key, NOT a token or user identifier. */
data class FirebaseSession(val uid: String, val tenantId: String?, val nonce: String)

class FirebaseToken(
    val value: String,
    val issuer: String,
    val audience: String,
    val subject: String,
    val tenantId: String?,
    val expiresAtSeconds: Long,
    val issuedAtSeconds: Long,
    val authenticatedAtSeconds: Long,
) {
    override fun toString() = "FirebaseToken([redacted])"
}

interface FirebaseSessionPort {
    val user: FirebaseSession?

    fun subscribe(listener: () -> Unit): AutoCloseable

    suspend fun tokenFor(user: FirebaseSession): FirebaseToken

    fun close()
}

/**
 * Same UTF-8 JSON tuple and SHA-256 as apps/gateway/src/auth/organization-access.ts identityActor.
 * This is an identifier, not authentication: the server still verifies signature/revocation.
 */
fun firebaseActor(projectId: String, tenantId: String?, uid: String): String {
    require(uid.length in 1..128)
    val tuple = buildJsonArray {
        add("https://securetoken.google.com/$projectId")
        add(tenantId ?: "")
        add(uid)
    }
        .toString()
    return MessageDigest.getInstance("SHA-256")
        .digest(tuple.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

class FirebaseIdentity(
    private val configuration: FirebaseConfiguration,
    private val port: FirebaseSessionPort,
    private val now: () -> Long = System::currentTimeMillis,
) : SessionIdentity {
    private var closed = false

    init {
        configuration.validate()
    }

    private fun current(): FirebaseSession? =
        if (closed) null
        else
            port.user?.takeIf {
                it.uid.length in 1..128 &&
                    it.tenantId == configuration.tenantId &&
                    it.nonce.isNotBlank()
            }

    override val session: IdentitySession?
        get() =
            current()?.let {
                IdentitySession(
                    firebaseActor(
                        configuration.projectId,
                        it.tenantId,
                        it.uid,
                    ),
                    it.nonce,
                )
            }

    override val actorId: String?
        get() = session?.actorId

    override fun subscribe(listener: () -> Unit): AutoCloseable = port.subscribe(listener)

    override suspend fun tokenFor(actorId: String): String {
        try {
            val expected = session ?: throw MobileFailure(Failure.SIGN_IN)
            if (expected.actorId != actorId) throw MobileFailure(Failure.SIGN_IN)
            val user = current() ?: throw MobileFailure(Failure.SIGN_IN)
            val token = port.tokenFor(user)
            val seconds = now() / 1000
            if (
                closed ||
                    session != expected ||
                    current() != user ||
                    token.issuer != "https://securetoken.google.com/${configuration.projectId}" ||
                    token.audience != configuration.projectId ||
                    token.subject != user.uid ||
                    token.tenantId != configuration.tenantId ||
                    token.expiresAtSeconds <= seconds ||
                    token.issuedAtSeconds > seconds + 30 ||
                    token.authenticatedAtSeconds > seconds + 30 ||
                    token.authenticatedAtSeconds > token.issuedAtSeconds ||
                    token.issuedAtSeconds >= token.expiresAtSeconds ||
                    token.value.length !in 1..16384 ||
                    !Regex("^[A-Za-z0-9_.~-]+$").matches(token.value)
            )
                throw MobileFailure(Failure.SIGN_IN)
            return token.value
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw MobileFailure(Failure.SIGN_IN)
        }
    }

    override fun close() {
        if (!closed) {
            closed = true
            port.close()
        }
    }
}
