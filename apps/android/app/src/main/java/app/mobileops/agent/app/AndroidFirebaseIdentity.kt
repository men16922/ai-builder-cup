package app.mobileops.agent.app

import android.app.Activity
import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import app.mobileops.agent.*
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/** Created only from the packaged configuration after an explicit sign-in button.
 * Every attempt owns a named Firebase app; a cancelled attempt cannot sign out a newer one. */
class AndroidFirebaseIdentity(context: Context, private val configuration: FirebaseConfiguration) :
    SessionIdentity {
    private val sdk = SdkSession(context.applicationContext, configuration)
    private val bridge = FirebaseIdentity(configuration, sdk)
    override val session get() = bridge.session
    override val actorId get() = bridge.actorId
    override fun subscribe(listener: () -> Unit) = bridge.subscribe(listener)
    override suspend fun tokenFor(actorId: String) = bridge.tokenFor(actorId)
    override fun close() = bridge.close()
    suspend fun signIn(activity: Activity) = sdk.signIn(activity)
}

private class SdkSession(context: Context, private val configuration: FirebaseConfiguration) :
    FirebaseSessionPort {
    private val app = FirebaseApp.initializeApp(
        context, FirebaseOptions.Builder()
            .setProjectId(configuration.projectId).setApiKey(configuration.apiKey)
            .setApplicationId(configuration.appId).build(),
        "mobileops-mobile-${UUID.randomUUID()}"
    ).also { it.setDataCollectionDefaultEnabled(false) }

    // A new named app has no tenant by default; setTenantId requires a non-null ID.
    private val auth = FirebaseAuth.getInstance(app)
        .also { auth -> configuration.tenantId?.let { auth.setTenantId(it) } }
    private val credentials = CredentialManager.create(context)
    private var sdkUser: FirebaseUser? = null
    override var user: FirebaseSession? = null; private set
    private val listeners = mutableSetOf<() -> Unit>()
    private var closed = false
    private var signingIn = false
    private var disposed = false
    private val authListener = FirebaseAuth.AuthStateListener { publish(it.currentUser) }

    init {
        auth.addAuthStateListener(authListener)
    }

    private fun publish(value: FirebaseUser?) {
        if (closed || value === sdkUser) return
        sdkUser = value
        user = value?.let { FirebaseSession(it.uid, it.tenantId, UUID.randomUUID().toString()) }
        listeners.toList().forEach { it() }
    }

    override fun subscribe(listener: () -> Unit): AutoCloseable {
        listeners += listener; listener()
        return AutoCloseable { listeners -= listener }
    }

    suspend fun signIn(activity: Activity) {
        if (closed || signingIn) throw MobileFailure(Failure.SIGN_IN)
        signingIn = true
        try {
            // Clear provider selection state before an explicit account choice. No auto sign-in.
            credentials.clearCredentialState(ClearCredentialStateRequest())
            if (closed) throw MobileFailure(Failure.SIGN_IN)
            val option = GetSignInWithGoogleOption.Builder(configuration.webClientId).build()
            val result = credentials.getCredential(
                activity,
                GetCredentialRequest.Builder().addCredentialOption(option).build()
            )
            if (closed) throw MobileFailure(Failure.SIGN_IN)
            val custom =
                result.credential as? CustomCredential ?: throw MobileFailure(Failure.SIGN_IN)
            if (custom.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) throw MobileFailure(
                Failure.SIGN_IN
            )
            val google = GoogleIdTokenCredential.createFrom(custom.data)
            // Firebase Tasks may complete after coroutine cancellation. Finish cleanup before disposing
            // this attempt's SDK instance, and never bind a retired result to the UI.
            withContext(NonCancellable) {
                val signed = auth.signInWithCredential(
                    GoogleAuthProvider.getCredential(
                        google.idToken,
                        null
                    )
                ).await()
                if (closed) auth.signOut() else publish(signed.user)
            }
            if (closed || user == null) throw MobileFailure(Failure.SIGN_IN)
        } catch (error: CancellationException) {
            close(); throw error
        } catch (_: Exception) {
            close(); throw MobileFailure(Failure.SIGN_IN)
        } finally {
            signingIn = false; if (closed) dispose()
        }
    }

    override suspend fun tokenFor(user: FirebaseSession): FirebaseToken {
        val current = sdkUser
        if (closed || current == null || this.user != user) throw MobileFailure(Failure.SIGN_IN)
        val result = current.getIdToken(false).await()
        if (closed || current !== sdkUser || this.user != user) throw MobileFailure(Failure.SIGN_IN)
        val claims = result.claims
        val firebase = claims["firebase"] as? Map<*, *>
        return FirebaseToken(
            result.token ?: throw MobileFailure(Failure.SIGN_IN),
            claims["iss"] as? String ?: "",
            claims["aud"] as? String ?: "",
            claims["sub"] as? String ?: "",
            firebase?.get("tenant") as? String,
            result.expirationTimestamp,
            result.issuedAtTimestamp,
            result.authTimestamp
        )
    }

    override fun close() {
        if (closed) return
        closed = true; sdkUser = null; user = null
        auth.removeAuthStateListener(authListener)
        listeners.toList().forEach { it() }; listeners.clear()
        auth.signOut()
        // Provider cleanup contains no bearer/record data. Its failure never restores this session.
        CoroutineScope(Dispatchers.Main.immediate).launch {
            try {
                credentials.clearCredentialState(ClearCredentialStateRequest())
            } catch (_: Exception) { /* Local session is already closed. */
            }
        }
        if (!signingIn) dispose()
    }

    private fun dispose() {
        if (!disposed) {
            disposed = true; app.delete()
        }
    }
}
