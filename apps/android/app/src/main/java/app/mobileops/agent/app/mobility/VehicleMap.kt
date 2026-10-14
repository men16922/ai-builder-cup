package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.BuildConfig
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.Coordinate
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState

/**
 * Google basemap with a simulated position; the restricted key is supplied only to the APK build.
 */
@Composable
internal fun VehicleMap(
    position: Coordinate,
    destination: Coordinate? = null,
    origin: Coordinate? = null,
) {
    if (!BuildConfig.MAPS_CONFIGURED) return
    val coordinate = LatLng(position.latitude, position.longitude)
    val camera = rememberCameraPositionState {
        this.position = CameraPosition.fromLatLngZoom(coordinate, 14f)
    }
    LaunchedEffect(coordinate) {
        camera.position = CameraPosition.fromLatLngZoom(coordinate, camera.position.zoom)
    }
    val primary = MaterialTheme.colorScheme.primary
    GoogleMap(
        modifier = Modifier.fillMaxWidth().height(240.dp),
        cameraPositionState = camera,
        properties = MapProperties(isMyLocationEnabled = false),
        uiSettings =
            MapUiSettings(
                zoomControlsEnabled = false,
                myLocationButtonEnabled = false,
                mapToolbarEnabled = false,
            ),
    ) {
        Marker(
            state = rememberUpdatedMarkerState(position = coordinate),
            title = stringResource(R.string.vehicle_map_position),
        )
        if (destination != null) {
            val target = LatLng(destination.latitude, destination.longitude)
            Marker(
                state = rememberUpdatedMarkerState(position = target),
                title = stringResource(R.string.vehicle_map_destination),
            )
            val from = origin ?: position
            Polyline(
                points = listOf(LatLng(from.latitude, from.longitude), target),
                color = primary,
                width = 5f,
            )
        }
    }
}
