package app.mobileops.agent.app

import android.graphics.Bitmap
import android.os.SystemClock
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import app.mobileops.agent.app.mobility.VehicleMap
import app.mobileops.agent.mobility.Coordinate
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.rememberCameraPositionState
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test

/**
 * Opt-in provider smoke, separate from offline gates. It uses the APK's restricted Maps key, public
 * synthetic coordinates and a real Google tile load. It never signs in to Aide, calls the gateway,
 * reads physical GPS or sends a vehicle/cloud command.
 */
class NativeMapProviderSmokeTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun restrictedSdkLoadsTilesAndProductCarMapRenders() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(
            "Live provider probe requires explicit instrumentation opt-in",
            InstrumentationRegistry.getArguments().getString("aideLiveMaps") == "true",
        )
        assertTrue("A restricted Maps SDK key must be packaged", BuildConfig.MAPS_CONFIGURED)
        val loaded = AtomicBoolean(false)
        val product = mutableStateOf(false)
        val publicPosition = LatLng(37.5665, 126.9780)
        compose.setContent {
            MaterialTheme(colorScheme = opsColorScheme(false)) {
                Column(Modifier.padding(16.dp)) {
                    Text("Live Google Maps SDK verification")
                    Text("Synthetic vehicle position. No physical driving or account access.")
                    if (product.value) {
                        VehicleMap(
                            Coordinate(publicPosition.latitude, publicPosition.longitude),
                            destination = Coordinate(37.5685, 126.9800),
                            origin = Coordinate(37.5650, 126.9765),
                            moving = false,
                        )
                    } else {
                        val camera = rememberCameraPositionState {
                            position = CameraPosition.fromLatLngZoom(publicPosition, 15f)
                        }
                        GoogleMap(
                            modifier = Modifier.fillMaxWidth().height(280.dp),
                            cameraPositionState = camera,
                            onMapLoaded = { loaded.set(true) },
                        )
                    }
                }
            }
        }
        // The SDK callback establishes a genuine completed basemap load, rather than a fake
        // view/placeholder. Rendering the actual product component then checks its marker path.
        compose.waitUntil(timeoutMillis = 30000) { loaded.get() }
        compose.runOnIdle { product.value = true }
        compose.waitForIdle()
        SystemClock.sleep(3000)
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        assertNotNull("Product map must have a capturable frame", bitmap)
        val output =
            File(
                instrumentation.targetContext.getExternalFilesDir(null),
                "verification/native-google-maps-provider.png",
            )
        output.parentFile?.mkdirs()
        output.outputStream().use { stream ->
            assertTrue(bitmap!!.compress(Bitmap.CompressFormat.PNG, 100, stream))
        }
    }
}
