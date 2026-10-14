package app.mobileops.agent.app

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: MobileViewModel by viewModels()
    private var notificationPermissionAsked = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState);

        enableEdgeToEdge()
        viewModel.configure(applicationContext)
        consumeNotification(intent)

        val preferences = getSharedPreferences("display", MODE_PRIVATE)

        // A saved choice wins; otherwise Korean devices get Korean and every other device gets English.
        viewModel.language.value = preferences.getString("language", null)
            ?: if (java.util.Locale.getDefault().language == "ko") "ko" else "en"

        // Ask for the system notification permission only after the user enabled work notifications.
        val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

        lifecycleScope.launch {
            viewModel.notifications.state.collect {
                if (it.enabled && android.os.Build.VERSION.SDK_INT >= 33 && !notificationPermissionAsked
                    && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    notificationPermissionAsked =
                        true; permission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
        setContent {
            MobileOpsApp(
                viewModel,
                onSignIn = { key -> viewModel.signIn(this, key) }) { language ->
                viewModel.language.value = language; preferences.edit()
                .putString("language", language).apply()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent); consumeNotification(intent)
    }

    private fun consumeNotification(intent: Intent?) {
        if (intent?.action != "app.mobileops.agent.OPEN_GCP_NOTIFICATION") return
        val raw = try {
            intent.getStringExtra("gcp_notification")
        } catch (_: Exception) {
            null
        }
        intent.removeExtra("gcp_notification")
        if (raw != null) viewModel.receiveNotification(raw)
    }

    override fun onResume() {
        super.onResume(); viewModel.resume()
    }

    override fun onStop() {
        viewModel.controller.hideUntilRevalidated(); super.onStop()
    }
}
