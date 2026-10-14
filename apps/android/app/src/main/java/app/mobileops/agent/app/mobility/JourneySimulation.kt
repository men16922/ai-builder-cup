package app.mobileops.agent.app.mobility

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.BuildConfig
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.SimulatedJourney

/**
 * A clearly labelled straight-line twin trajectory. It is not a road route or physical autonomy.
 */
@Composable
internal fun JourneySimulation(journey: SimulatedJourney) {
    val primary = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outlineVariant
    Card(Modifier.fillMaxWidth()) {
        if (BuildConfig.MAPS_CONFIGURED)
            VehicleMap(journey.position, journey.destination?.location, journey.origin)
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
