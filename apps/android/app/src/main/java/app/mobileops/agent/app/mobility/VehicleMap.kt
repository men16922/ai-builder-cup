package app.mobileops.agent.app.mobility

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.toPath
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.BuildConfig
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.Coordinate
import app.mobileops.agent.mobility.MobilityPlace
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.BitmapDescriptorFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.Dash
import com.google.android.gms.maps.model.Gap
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.android.gms.maps.model.MapStyleOptions
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.google.maps.android.compose.rememberUpdatedMarkerState
import kotlin.math.atan2
import kotlin.math.cos

/**
 * Google basemap with a simulated position; the restricted key is supplied only to the APK build.
 * The car glides between server-confirmed positions; the server tick decides where it is.
 */
@Composable
internal fun VehicleMap(
    position: Coordinate,
    destination: Coordinate? = null,
    origin: Coordinate? = null,
    moving: Boolean = false,
    candidates: List<MobilityPlace> = emptyList(),
    onCall: Boolean = false,
) {
    if (!BuildConfig.MAPS_CONFIGURED) return
    val target = LatLng(position.latitude, position.longitude)
    val goal = destination?.let { LatLng(it.latitude, it.longitude) }
    val start = (origin ?: position).let { LatLng(it.latitude, it.longitude) }
    var shown by remember { mutableStateOf(target) }
    var loaded by remember { mutableStateOf(false) }
    val camera = rememberCameraPositionState {
        this.position = CameraPosition.fromLatLngZoom(target, 15f)
    }
    LaunchedEffect(target, moving) {
        val from = shown
        if (!moving || from == target) {
            shown = target
            return@LaunchedEffect
        }
        Animatable(0f).animateTo(1f, tween(1100, easing = LinearEasing)) {
            shown =
                LatLng(
                    from.latitude + (target.latitude - from.latitude) * value,
                    from.longitude + (target.longitude - from.longitude) * value,
                )
        }
    }
    val padding = with(LocalDensity.current) { 56.dp.roundToPx() }
    // Frame the whole trip once per destination; otherwise follow the car.
    LaunchedEffect(goal, loaded) {
        if (!loaded) return@LaunchedEffect
        if (goal == null) camera.animate(CameraUpdateFactory.newLatLng(target))
        else
            camera.animate(
                CameraUpdateFactory.newLatLngBounds(
                    LatLngBounds.builder().include(start).include(goal).build(),
                    padding,
                ),
            )
    }
    LaunchedEffect(shown, loaded) {
        val visible = camera.projection?.visibleRegion?.latLngBounds
        if (loaded && (goal == null || visible?.contains(shown) == false))
            camera.move(CameraUpdateFactory.newLatLng(shown))
    }
    val primary = MaterialTheme.colorScheme.primary
    val dark = isSystemInDarkTheme()
    val density = LocalDensity.current.density
    GoogleMap(
        modifier = Modifier.fillMaxWidth().height(280.dp),
        cameraPositionState = camera,
        onMapLoaded = { loaded = true },
        properties =
            MapProperties(
                isMyLocationEnabled = false,
                mapStyleOptions = MapStyleOptions(if (dark) DARK_STYLE else LIGHT_STYLE),
            ),
        uiSettings =
            MapUiSettings(
                zoomControlsEnabled = false,
                myLocationButtonEnabled = false,
                mapToolbarEnabled = false,
            ),
    ) {
        val car =
            remember(primary, density) {
                BitmapDescriptorFactory.fromBitmap(carBitmap(primary.toArgb(), density))
            }
        val dot =
            remember(primary, density) {
                BitmapDescriptorFactory.fromBitmap(dotBitmap(primary.toArgb(), density))
            }
        if (goal != null) {
            Polyline(points = listOf(start, shown), color = primary, width = 12f, zIndex = 2f)
            if (shown != goal)
                Polyline(
                    points = listOf(shown, goal),
                    color = primary.copy(alpha = .6f),
                    width = 9f,
                    pattern = listOf(Dash(24f), Gap(18f)),
                    zIndex = 1f,
                )
            Marker(
                state = rememberUpdatedMarkerState(position = start),
                icon = dot,
                anchor = Offset(.5f, .5f),
                zIndex = 3f,
            )
            Marker(
                state = rememberUpdatedMarkerState(position = goal),
                title = stringResource(R.string.vehicle_map_destination),
                zIndex = 4f,
            )
        }
        // Numbers match the candidate cards (1-based) while the driver is choosing.
        candidates.forEachIndexed { index, place ->
            val pin =
                remember(index, primary, density) {
                    BitmapDescriptorFactory.fromBitmap(
                        numberBitmap(index + 1, primary.toArgb(), density),
                    )
                }
            Marker(
                state =
                    rememberUpdatedMarkerState(
                        LatLng(place.location.latitude, place.location.longitude),
                    ),
                title = stringResource(R.string.vehicle_map_candidate, index + 1, place.name),
                icon = pin,
                anchor = Offset(.5f, .5f),
                zIndex = 5f,
            )
        }
        if (onCall) {
            val phone =
                remember(density) { BitmapDescriptorFactory.fromBitmap(phoneBitmap(density)) }
            Marker(
                state = rememberUpdatedMarkerState(position = shown),
                title = stringResource(R.string.vehicle_map_on_call),
                icon = phone,
                anchor = Offset(.5f, 1f),
                zIndex = 11f,
            )
        }
        Marker(
            state = rememberUpdatedMarkerState(position = shown),
            title = stringResource(R.string.vehicle_map_position),
            icon = car,
            anchor = Offset(.5f, .5f),
            flat = true,
            rotation = if (goal != null) bearing(start, goal) else 0f,
            zIndex = 10f,
        )
    }
}

/** Screen-space heading for short simulated legs, clockwise from north. */
private fun bearing(from: LatLng, to: LatLng): Float {
    val x = (to.longitude - from.longitude) * cos(Math.toRadians(from.latitude))
    val y = to.latitude - from.latitude
    return if (x == 0.0 && y == 0.0) 0f else ((Math.toDegrees(atan2(x, y)) + 360) % 360).toFloat()
}

/** Top-down car pointing north inside a soft halo; the marker rotates it to the heading. */
private fun carBitmap(color: Int, density: Float): Bitmap {
    val size = (64 * density).toInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val unit = size / 64f
    canvas.scale(unit, unit)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = color
    paint.alpha = 36
    canvas.drawCircle(32f, 32f, 30f, paint)
    paint.alpha = 31
    canvas.drawCircle(32f, 32f, 22f, paint)
    paint.color = android.graphics.Color.BLACK
    paint.alpha = 46
    canvas.drawOval(RectF(20f, 14f, 44f, 54f), paint)
    val body = RectF(21f, 12f, 43f, 52f)
    paint.color = color
    paint.alpha = 255
    canvas.drawRoundRect(body, 9f, 9f, paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 2.5f
    paint.color = android.graphics.Color.WHITE
    canvas.drawRoundRect(body, 9f, 9f, paint)
    paint.style = Paint.Style.FILL
    paint.color = 0xFFE3ECFF.toInt()
    canvas.drawPath(
        Path().apply {
            moveTo(24.5f, 22f)
            quadTo(32f, 17.5f, 39.5f, 22f)
            lineTo(38.2f, 28.5f)
            quadTo(32f, 26.5f, 25.8f, 28.5f)
            close()
        },
        paint,
    )
    paint.alpha = 190
    canvas.drawPath(
        Path().apply {
            moveTo(25.5f, 42.5f)
            quadTo(32f, 44.5f, 38.5f, 42.5f)
            lineTo(39f, 47f)
            quadTo(32f, 49f, 25f, 47f)
            close()
        },
        paint,
    )
    paint.color = 0xFFFFF6C2.toInt()
    canvas.drawCircle(25.5f, 15f, 1.6f, paint)
    canvas.drawCircle(38.5f, 15f, 1.6f, paint)
    return bitmap
}

/** Numbered pin matching the candidate card badge. */
private fun numberBitmap(number: Int, color: Int, density: Float): Bitmap {
    val size = (30 * density).toInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = android.graphics.Color.WHITE
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)
    paint.color = color
    canvas.drawCircle(size / 2f, size / 2f, size / 2f - 2.5f * density, paint)
    paint.color = android.graphics.Color.WHITE
    paint.textAlign = Paint.Align.CENTER
    paint.textSize = 15 * density
    paint.isFakeBoldText = true
    val baseline = size / 2f - (paint.descent() + paint.ascent()) / 2
    canvas.drawText(number.toString(), size / 2f, baseline, paint)
    return bitmap
}

/**
 * Green speech bubble with a handset. The transparent lower part puts the bubble tip just above the
 * car marker when anchored at the bottom centre on the car position.
 */
private fun phoneBitmap(density: Float): Bitmap {
    val width = (40 * density).toInt()
    val height = (74 * density).toInt()
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.scale(density, density)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = 0xFF1E8E3E.toInt()
    canvas.drawRoundRect(RectF(0f, 0f, 40f, 37f), 8f, 8f, paint)
    canvas.drawPath(
        Path().apply {
            moveTo(13f, 36f)
            lineTo(20f, 47f)
            lineTo(27f, 36f)
            close()
        },
        paint,
    )
    paint.color = android.graphics.Color.WHITE
    canvas.save()
    canvas.translate(8f, 6f)
    canvas.drawPath(addPathNodes(AideIcons.PHONE_PATH).toPath().asAndroidPath(), paint)
    canvas.restore()
    return bitmap
}

private fun dotBitmap(color: Int, density: Float): Bitmap {
    val size = (16 * density).toInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = android.graphics.Color.WHITE
    canvas.drawCircle(size / 2f, size / 2f, size / 2f - density, paint)
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = 3 * density
    paint.color = color
    canvas.drawCircle(size / 2f, size / 2f, size / 2f - 2.5f * density, paint)
    return bitmap
}

// Quiet basemap so the route and the car carry the scene.
private const val LIGHT_STYLE =
    """[{"featureType":"poi","stylers":[{"visibility":"off"}]},{"featureType":"transit","stylers":[{"visibility":"off"}]},{"elementType":"geometry","stylers":[{"saturation":-70},{"lightness":8}]},{"featureType":"road","elementType":"geometry","stylers":[{"saturation":-100},{"lightness":40}]},{"featureType":"water","stylers":[{"saturation":-40},{"lightness":20}]},{"elementType":"labels.text.fill","stylers":[{"saturation":-100},{"lightness":20}]}]"""
private const val DARK_STYLE =
    """[{"featureType":"poi","stylers":[{"visibility":"off"}]},{"featureType":"transit","stylers":[{"visibility":"off"}]},{"elementType":"geometry","stylers":[{"color":"#1c2026"}]},{"elementType":"labels.text.fill","stylers":[{"color":"#8b929c"}]},{"elementType":"labels.text.stroke","stylers":[{"color":"#1c2026"}]},{"featureType":"road","elementType":"geometry","stylers":[{"color":"#2b313a"}]},{"featureType":"road.highway","elementType":"geometry","stylers":[{"color":"#39414d"}]},{"featureType":"water","stylers":[{"color":"#0e161f"}]}]"""
