package app.mobileops.agent.app.data

import android.content.Context
import app.mobileops.agent.readMobileConfiguration
import java.io.ByteArrayOutputStream

/** Reads only the bounded packaged asset. It does not initialize Firebase or an HTTP client. */
class PackagedConfigurationDataSource(context: Context) {
    private val assets = context.applicationContext.assets

    fun load(): ConfigurationState =
        try {
            val raw =
                if (assets.list("")?.contains(FILE_NAME) == true) {
                    assets.open(FILE_NAME).use { input ->
                        val bytes = ByteArrayOutputStream()
                        val chunk = ByteArray(4096)
                        while (true) {
                            val count = input.read(chunk)
                            if (count < 0) break
                            require(bytes.size() + count <= MAX_BYTES)
                            bytes.write(chunk, 0, count)
                        }
                        bytes.toString("UTF-8")
                    }
                } else {
                    null
                }
            ConfigurationState(configuration = readMobileConfiguration(raw))
        } catch (_: Exception) {
            ConfigurationState(invalid = true)
        }

    private companion object {
        const val FILE_NAME = "mobileops-agent.json"
        const val MAX_BYTES = 32768
    }
}
