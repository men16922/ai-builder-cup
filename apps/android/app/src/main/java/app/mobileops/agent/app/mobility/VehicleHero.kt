package app.mobileops.agent.app.mobility

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.SimulatedVehicle

/** Calm vehicle-first hierarchy: status, original car image, battery/range and charging. */
@Composable
internal fun VehicleHero(vehicle: SimulatedVehicle) {
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                vehicle.model,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                stringResource(R.string.vehicle_simulated),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Image(
                painterResource(R.drawable.aide_ev),
                stringResource(R.string.vehicle_image),
                Modifier.fillMaxWidth().height(180.dp),
            )
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.vehicle_battery),
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text(
                        stringResource(R.string.vehicle_percent, vehicle.batteryPercent),
                        style = MaterialTheme.typography.displaySmall,
                    )
                    LinearProgressIndicator(
                        progress = { vehicle.batteryPercent / 100f },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                Column(Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.vehicle_estimated_range),
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text(
                        stringResource(R.string.vehicle_range_km, vehicle.rangeKm),
                        style = MaterialTheme.typography.headlineLarge,
                    )
                    Text(
                        stringResource(R.string.vehicle_estimate_caption),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.vehicle_charging), fontWeight = FontWeight.Medium)
                Text(
                    when (vehicle.charging) {
                        "charging" ->
                            stringResource(R.string.vehicle_power_kw, vehicle.powerKw.toString())
                        "interrupted" -> stringResource(R.string.vehicle_interrupted)
                        else -> stringResource(R.string.vehicle_idle)
                    },
                    color = MaterialTheme.colorScheme.primary,
                )
            }
            Text(
                stringResource(R.string.vehicle_target, vehicle.targetPercent),
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                stringResource(
                    R.string.vehicle_location,
                    vehicle.location.latitude.toString(),
                    vehicle.location.longitude.toString(),
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
