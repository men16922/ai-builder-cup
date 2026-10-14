package app.mobileops.agent.app.data

import android.app.Activity
import android.content.Context
import app.mobileops.agent.SessionIdentity
import app.mobileops.agent.app.AndroidFirebaseIdentity
import app.mobileops.agent.app.AndroidPushTokenSource
import app.mobileops.agent.data.DefaultMobileRepository
import app.mobileops.agent.data.MobileRepository
import kotlinx.coroutines.CoroutineScope

/** Manual dependency injection keeps Android platform objects in the data layer. */
class AppContainer(context: Context) {
    private val application = context.applicationContext
    val configuration = PackagedConfigurationDataSource(application).load()
    val onboardingPreferences: OnboardingPreferences = AndroidOnboardingPreferences(application)

    fun createMobileRepository(scope: CoroutineScope): MobileRepository {
        val config = configuration.configuration
        return DefaultMobileRepository(
            configuration = config,
            scope = scope,
            createIdentity = config?.let { { AndroidFirebaseIdentity(application, it.firebase) } },
            createPushSource =
                config?.let { { _ -> AndroidPushTokenSource(application, it.firebase) } },
        )
    }

    suspend fun authenticate(identity: SessionIdentity, activity: Activity) {
        (identity as AndroidFirebaseIdentity).signIn(activity)
    }
}
