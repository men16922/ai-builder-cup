package app.mobileops.agent.app.data

import app.mobileops.agent.MobileConfiguration

data class ConfigurationState(
    val configuration: MobileConfiguration? = null,
    val invalid: Boolean = false,
)
