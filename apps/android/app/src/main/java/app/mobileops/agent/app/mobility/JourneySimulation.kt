package app.mobileops.agent.app.mobility

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.BuildConfig
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.Coordinate
import app.mobileops.agent.mobility.SimulatedJourney
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * A clearly labelled straight-line twin trajectory. It is not a road route or physical autonomy.
 */
@Composable
internal fun JourneySimulation(
    journey: SimulatedJourney,
    batteryPercent: Int? = null,
    onCall: Boolean = false,
) {
    val primary = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Card(Modifier.fillMaxWidth()) {
        if (BuildConfig.MAPS_CONFIGURED)
            VehicleMap(
                journey.position,
                journey.destination?.location,
                journey.origin,
                moving = journey.state == "moving",
                candidates = if (journey.state == "choosing") journey.candidates else emptyList(),
                onCall = onCall,
            )
        else
            Canvas(Modifier.fillMaxWidth().height(200.dp).padding(20.dp)) {
                for (i in 0..7) drawLine(
                    grid,
                    Offset(size.width * i / 7, 0f),
                    Offset(size.width * i / 7, size.height),
                )
                for (i in 0..4) drawLine(
                    grid,
                    Offset(0f, size.height * i / 4),
                    Offset(size.width, size.height * i / 4),
                )
                val from = Offset(size.width * .12f, size.height * .8f)
                val to = Offset(size.width * .88f, size.height * .2f)
                drawLine(primary, from, to, 4.dp.toPx())
                drawCircle(primary, 7.dp.toPx(), to)
                val progress = journey.progress.toFloat()
                drawCircle(
                    primary,
                    12.dp.toPx(),
                    Offset(
                        from.x + (to.x - from.x) * progress,
                        from.y + (to.y - from.y) * progress,
                    ),
                )
            }
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            journey.destination?.let { DriveStatus(journey, it.location, batteryPercent) }
            Text(
                stringResource(R.string.vehicle_journey_progress, (journey.progress * 100).toInt()),
                style = MaterialTheme.typography.labelLarge,
            )
            Text(
                stringResource(R.string.vehicle_simulation_route),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

/** Cluster-style strip: status, destination, progress and straight-line distances. */
@Composable
private fun DriveStatus(journey: SimulatedJourney, destination: Coordinate, batteryPercent: Int?) {
    val moving = journey.state == "moving"
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            stringResource(
                if (moving) R.string.vehicle_drive_live else R.string.vehicle_drive_done,
            ),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            journey.destination?.name.orEmpty(),
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
    LinearProgressIndicator(
        progress = { journey.progress.toFloat() },
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
    )
    Row(Modifier.fillMaxWidth()) {
        DriveFigure(R.string.vehicle_drive_remaining, kilometres(journey.position, destination))
        DriveFigure(R.string.vehicle_drive_straight, kilometres(journey.origin, destination))
        if (moving && batteryPercent != null)
            Column(Modifier.weight(1f)) {
                Text(
                    stringResource(R.string.vehicle_drive_arrival),
                    style = MaterialTheme.typography.labelSmall,
                )
                Text(
                    stringResource(
                        R.string.vehicle_percent,
                        arrivalBattery(batteryPercent, kilometres(journey.origin, destination)),
                    ),
                    style = MaterialTheme.typography.titleMedium,
                )
            }
    }
    if (moving && journey.autopilot)
        Text(
            stringResource(R.string.vehicle_drive_autopilot),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.tertiary,
        )
}

@Composable
private fun RowScope.DriveFigure(label: Int, km: Double) {
    Column(Modifier.weight(1f)) {
        Text(stringResource(label), style = MaterialTheme.typography.labelSmall)
        Text(
            stringResource(
                R.string.vehicle_drive_km,
                String.format(Locale.getDefault(), if (km < 10) "%.1f" else "%.0f", km),
            ),
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

/** Straight-line kilometres; the simulation never claims a road distance. */
private fun kilometres(from: Coordinate, to: Coordinate): Double {
    val rad = Math.PI / 180
    val a =
        sin((to.latitude - from.latitude) * rad / 2).let { it * it } +
            cos(from.latitude * rad) *
                cos(to.latitude * rad) *
                sin((to.longitude - from.longitude) * rad / 2).let { it * it }
    return 12742 * asin(sqrt(a))
}
