package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.SimulatedVehicle
import app.mobileops.agent.mobility.VehicleBoard
import java.util.Locale
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/**
 * Remote controls for the server-side twin, laid out like a phone key: one tap per action, state on
 * the tile. A confirmation appears only after the server accepted the request; nothing is retried.
 */
@Composable
internal fun VehicleControls(board: VehicleBoard, onCommand: (MobilityCommand) -> Unit) {
    val vehicle = board.state?.vehicle ?: return
    var pending by remember { mutableStateOf<String?>(null) }
    var sawBusy by remember { mutableStateOf(false) }
    var toast by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(board.busy, board.failure) {
        if (pending == null) return@LaunchedEffect
        if (board.busy) {
            sawBusy = true
            return@LaunchedEffect
        }
        if (sawBusy) {
            if (board.failure == null) toast = pending
            pending = null
            sawBusy = false
        }
    }
    LaunchedEffect(toast) {
        if (toast != null) {
            delay(2600)
            toast = null
        }
    }
    val run: (String, String, Double?) -> Unit = { action, done, value ->
        pending = done
        sawBusy = false
        onCommand(MobilityCommand.Control(action, value))
    }
    val charging = vehicle.charging == "charging"
    val climate = vehicle.climate
    Column(
        Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            stringResource(R.string.controls_title),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        val lockDone =
            stringResource(
                if (vehicle.locked) R.string.controls_done_unlocked
                else R.string.controls_done_locked,
            )
        val climateDone =
            stringResource(
                if (climate.on) R.string.controls_done_climate_off
                else R.string.controls_done_climate_on,
            )
        val chargeDone =
            stringResource(
                if (charging) R.string.controls_done_charge_stop
                else R.string.controls_done_charge_start,
            )
        val flashDone = stringResource(R.string.controls_done_flash)
        val honkDone = stringResource(R.string.controls_done_honk)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ControlTile(
                if (vehicle.locked) Icons.Filled.Lock else AideIcons.LockOpen,
                stringResource(
                    if (vehicle.locked) R.string.controls_locked else R.string.controls_unlocked,
                ),
                stringResource(
                    if (vehicle.locked) R.string.controls_tap_unlock
                    else R.string.controls_tap_lock,
                ),
                active = vehicle.locked,
                enabled = !board.busy,
            ) {
                run(if (vehicle.locked) "unlock" else "lock", lockDone, null)
            }
            ControlTile(
                AideIcons.Climate,
                stringResource(R.string.controls_climate),
                if (climate.on)
                    stringResource(
                        R.string.controls_climate_on,
                        degrees(climate.cabinCelsius),
                        degrees(climate.targetCelsius),
                    )
                else stringResource(R.string.controls_climate_off, degrees(climate.cabinCelsius)),
                active = climate.on,
                enabled = !board.busy,
            ) {
                run(if (climate.on) "climate_off" else "climate_on", climateDone, null)
            }
            ControlTile(
                AideIcons.Bolt,
                stringResource(
                    if (charging) R.string.controls_charging else R.string.controls_charge,
                ),
                if (charging)
                    stringResource(
                        R.string.controls_charging_status,
                        kilowatts(vehicle.powerKw),
                        vehicle.batteryPercent,
                    )
                else stringResource(R.string.controls_limit_status, vehicle.targetPercent),
                active = charging,
                enabled =
                    !board.busy &&
                        (charging ||
                            vehicle.parked && vehicle.batteryPercent < vehicle.targetPercent),
            ) {
                run(if (charging) "stop_charging" else "start_charging", chargeDone, null)
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            ControlTile(
                AideIcons.Flash,
                stringResource(R.string.controls_flash),
                stringResource(R.string.controls_flash_status),
                active = false,
                enabled = !board.busy,
            ) {
                run("flash", flashDone, null)
            }
            ControlTile(
                AideIcons.VolumeUp,
                stringResource(R.string.controls_honk),
                stringResource(R.string.controls_honk_status),
                active = false,
                enabled = !board.busy,
            ) {
                run("honk", honkDone, null)
            }
            Spacer(Modifier.weight(1f))
        }
        ControlSettings(vehicle, board.busy, run)
        toast?.let {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    stringResource(R.string.controls_simulated_toast, it),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}

@Composable
private fun RowScope.ControlTile(
    icon: ImageVector,
    label: String,
    status: String,
    active: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val container =
        if (active) MaterialTheme.colorScheme.primaryContainer
        else MaterialTheme.colorScheme.surfaceContainerHigh
    val content =
        if (active) MaterialTheme.colorScheme.onPrimaryContainer
        else MaterialTheme.colorScheme.onSurface
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(20.dp),
        color = container,
        contentColor = content,
        modifier =
            Modifier.weight(1f).heightIn(min = 112.dp).semantics {
                stateDescription = status
            },
    ) {
        Column(
            Modifier.padding(12.dp).alpha(if (enabled) 1f else .5f),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Surface(
                shape = CircleShape,
                color =
                    if (active) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.surfaceContainerHighest,
                contentColor =
                    if (active) MaterialTheme.colorScheme.onPrimary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
            ) {
                Icon(icon, contentDescription = null, modifier = Modifier.padding(8.dp).size(20.dp))
            }
            Text(
                label,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(status, style = MaterialTheme.typography.labelSmall, maxLines = 2)
        }
    }
}

/** Stepper for the cabin target and a slider for the charge limit, sent on release only. */
@Composable
private fun ControlSettings(
    vehicle: SimulatedVehicle,
    busy: Boolean,
    run: (String, String, Double?) -> Unit,
) {
    val target = vehicle.climate.targetCelsius
    var limit by
        remember(vehicle.targetPercent) { mutableFloatStateOf(vehicle.targetPercent.toFloat()) }
    val lower = target - .5
    val raise = target + .5
    val lowerDone = stringResource(R.string.controls_done_target, degrees(lower))
    val raiseDone = stringResource(R.string.controls_done_target, degrees(raise))
    val limitValue = (limit / 5).roundToInt() * 5
    val limitDone = stringResource(R.string.controls_done_limit, limitValue)
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.controls_cabin_target), Modifier.weight(1f))
                FilledTonalIconButton(
                    onClick = { run("set_temperature", lowerDone, lower) },
                    enabled = !busy && target > 16.0,
                ) {
                    Icon(
                        AideIcons.Minus,
                        contentDescription = stringResource(R.string.controls_lower_temperature),
                    )
                }
                Text(
                    stringResource(R.string.controls_degrees, degrees(target)),
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
                FilledTonalIconButton(
                    onClick = { run("set_temperature", raiseDone, raise) },
                    enabled = !busy && target < 28.0,
                ) {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = stringResource(R.string.controls_raise_temperature),
                    )
                }
            }
            HorizontalDivider()
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.controls_charge_limit), Modifier.weight(1f))
                Text(
                    stringResource(R.string.vehicle_percent, limitValue),
                    fontWeight = FontWeight.Bold,
                )
            }
            Slider(
                value = limit,
                onValueChange = { limit = it },
                onValueChangeFinished = {
                    if (limitValue != vehicle.targetPercent)
                        run("set_charge_limit", limitDone, limitValue.toDouble())
                },
                valueRange = 50f..100f,
                steps = 9,
                enabled = !busy,
            )
        }
    }
}

/** Shown only below 25 % while not charging; navigation only, no search starts here. */
@Composable
internal fun LowBatteryNudge(vehicle: SimulatedVehicle, onFindCharger: () -> Unit) {
    if (vehicle.batteryPercent >= 25 || vehicle.charging == "charging") return
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.tertiaryContainer,
                contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
            ),
    ) {
        Row(
            Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(AideIcons.Bolt, contentDescription = null)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    stringResource(R.string.nudge_low_battery, vehicle.batteryPercent),
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    stringResource(R.string.nudge_low_battery_body),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Button(onClick = onFindCharger) {
                IconLabel(AideIcons.Bolt, stringResource(R.string.home_find_charger))
            }
        }
    }
}

internal fun degrees(value: Double): String = String.format(Locale.getDefault(), "%.1f", value)

internal fun kilowatts(value: Double): String =
    if (value % 1.0 == 0.0) value.toInt().toString()
    else String.format(Locale.getDefault(), "%.1f", value)
