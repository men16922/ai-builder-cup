package app.mobileops.agent.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.lifecycle.lifecycleScope
import app.mobileops.agent.app.data.AppContainer
import app.mobileops.agent.app.mobility.VehicleViewModel
import app.mobileops.agent.app.mobility.VehicleViewModelFactory
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val container by lazy { AppContainer(applicationContext) }
    private val viewModel: MobileViewModel by viewModels { MobileViewModelFactory(container) }
    private val onboarding: OnboardingViewModel by viewModels {
        OnboardingViewModelFactory(container.onboardingPreferences)
    }
    private val vehicleModel: VehicleViewModel by viewModels {
        VehicleViewModelFactory(viewModel.mobilityRepository)
    }
    private var notificationPermissionAsked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        consumeNotification(intent)
        val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}
        lifecycleScope.launch {
            viewModel.notificationState.collect {
                if (
                    it.enabled &&
                        Build.VERSION.SDK_INT >= 33 &&
                        !notificationPermissionAsked &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                            PackageManager.PERMISSION_GRANTED
                ) {
                    notificationPermissionAsked = true
                    permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
        setContent {
            MobileOpsApp(
                viewModel,
                onSignIn = { key ->
                    // Credential UI belongs to the Activity lifetime, never to a retained
                    // ViewModel.
                    lifecycleScope.launch {
                        viewModel.signIn(key) { container.authenticate(it, this@MainActivity) }
                    }
                },
                onboarding = onboarding,
                vehicleModel = vehicleModel,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeNotification(intent)
    }

    private fun consumeNotification(intent: Intent?) {
        if (intent?.action != "app.mobileops.agent.OPEN_GCP_NOTIFICATION") return
        val raw =
            try {
                intent.getStringExtra("gcp_notification")
            } catch (_: Exception) {
                null
            }
        intent.removeExtra("gcp_notification")
        if (raw != null) viewModel.receiveNotification(raw)
    }

    // Re-entry requires a fresh read. Screens hidden in the background lose review confirmation.
    override fun onResume() {
        super.onResume()
        viewModel.resume()
    }

    override fun onStop() {
        viewModel.hideUntilRevalidated()
        super.onStop()
    }
}
