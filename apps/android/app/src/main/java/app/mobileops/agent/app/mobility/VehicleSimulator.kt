package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.SimulatedVehicle

/** Test telemetry controls operate the server-side twin; no physical vehicle endpoint exists. */
@Composable
internal fun VehicleSimulator(
    vehicle: SimulatedVehicle,
    busy: Boolean,
    onCommand: (MobilityCommand) -> Unit,
) {
    val language = stringResource(R.string.agent_request_language)
    var expanded by remember(vehicle.id) { mutableStateOf(false) }
    var battery by
        remember(vehicle.batteryPercent) { mutableFloatStateOf(vehicle.batteryPercent.toFloat()) }
    OutlinedButton(onClick = { expanded = !expanded }, modifier = Modifier.fillMaxWidth()) {
        IconLabel(Icons.Filled.Settings, stringResource(R.string.vehicle_simulator))
    }
    if (!expanded) return
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.vehicle_simulated_battery, battery.toInt()))
            Slider(
                value = battery,
                onValueChange = { battery = it },
                valueRange = 0f..100f,
                enabled = vehicle.parked && !busy,
            )
            for ((fault, label) in
                listOf(
                    "none" to R.string.vehicle_apply_state,
                    "charge_handshake" to R.string.vehicle_charge_fault,
                    "battery_hot" to R.string.vehicle_hot_fault,
                    "tire_low" to R.string.vehicle_tire_fault,
                    "unknown" to R.string.vehicle_unknown_fault,
                )) {
                OutlinedButton(
                    onClick = {
                        onCommand(
                            MobilityCommand.Telemetry(
                                battery.toInt(),
                                fault,
                                language,
                                if (fault == "unknown") "charge_link_timeout" else null,
                            ),
                        )
                    },
                    enabled = vehicle.parked && !busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(label))
                }
            }
        }
    }
}
