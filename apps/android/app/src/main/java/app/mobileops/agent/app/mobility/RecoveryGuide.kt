package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.MobilityReport
import app.mobileops.agent.mobility.SimulatedVehicle
import java.time.Instant

/**
 * Review is local presentation state. The server rechecks role, guide, episode and safety on
 * confirm.
 */
@Composable
internal fun RecoveryGuide(
    report: MobilityReport,
    vehicle: SimulatedVehicle,
    busy: Boolean,
    language: String,
    onCommand: (MobilityCommand) -> Unit,
) {
    val guide = report.guidance ?: return
    if (report.state !in setOf("escalated", "unknown") || report.episode != vehicle.episode) return
    var review by remember(report.id, vehicle.id) { mutableStateOf(false) }
    val available =
        guide.canResolve &&
            Instant.parse(guide.expiresAt).toEpochMilli() > System.currentTimeMillis()
    HorizontalDivider()
    Text(stringResource(R.string.recovery_title), fontWeight = FontWeight.Bold)
    guide.checks.forEach { check ->
        val label =
            when (check.id) {
                "signal" -> R.string.recovery_check_signal
                "parked" -> R.string.recovery_check_parked
                "temperature" -> R.string.recovery_check_temperature
                "battery" -> R.string.recovery_check_battery
                else -> R.string.recovery_check_attempts
            }
        Text(
            stringResource(
                if (check.passed) R.string.recovery_check_met else R.string.recovery_check_unmet,
                stringResource(label),
            ),
            style = MaterialTheme.typography.bodySmall,
        )
    }
    if (available) {
        OutlinedButton(
            onClick = { review = true },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            IconLabel(Icons.Filled.Build, stringResource(R.string.recovery_review))
        }
    } else
        Text(
            stringResource(R.string.recovery_unavailable),
            style = MaterialTheme.typography.bodySmall,
        )
    if (review) {
        AlertDialog(
            onDismissRequest = { review = false },
            title = { Text(stringResource(R.string.recovery_title)) },
            text = {
                Column(
                    Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text(stringResource(R.string.recovery_step_checks))
                    Text(stringResource(R.string.recovery_step_reconnect))
                    Text(stringResource(R.string.recovery_step_verify))
                    Text(stringResource(R.string.recovery_once_boundary))
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onCommand(MobilityCommand.ResolveUnknown(report.id, language))
                        review = false
                    },
                    enabled = !busy && available,
                ) {
                    Text(stringResource(R.string.recovery_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { review = false }) {
                    Text(stringResource(R.string.vehicle_cancel))
                }
            },
        )
    }
}
