package app.mobileops.agent.app.data

/** Display-only preference. It never selects an identity, workspace, role, or execution. */
interface OnboardingPreferences {
    fun isCompleted(): Boolean

    fun markCompleted()
}
