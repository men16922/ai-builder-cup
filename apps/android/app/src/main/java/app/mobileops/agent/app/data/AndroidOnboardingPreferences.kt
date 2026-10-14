package app.mobileops.agent.app.data

import android.content.Context

class AndroidOnboardingPreferences(context: Context) : OnboardingPreferences {
    private val preferences =
        context.applicationContext.getSharedPreferences("display", Context.MODE_PRIVATE)

    override fun isCompleted() = preferences.getBoolean(COMPLETED, false)

    override fun markCompleted() {
        preferences.edit().putBoolean(COMPLETED, true).apply()
    }

    private companion object {
        const val COMPLETED = "onboarding_completed_v1"
    }
}
