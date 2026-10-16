package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.*

/** Home navigation and bounded cancellation UI; no HTTP, credentials, Maps SDK or model calls. */
@Composable
internal fun VehicleHomeActions(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    onJourney: (String) -> Unit,
    onAssistance: () -> Unit,
) {
    val state = board.state ?: return
    val vehicle = state.vehicle ?: return
    // Navigation changes presentation only. Searches and authority remain explicit server intents.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(onClick = { onJourney("charging") }, modifier = Modifier.weight(1f)) {
            IconLabel(AideIcons.Bolt, stringResource(R.string.home_find_charger))
        }
        OutlinedButton(onClick = { onJourney("restaurant") }, modifier = Modifier.weight(1f)) {
            IconLabel(AideIcons.Restaurant, stringResource(R.string.home_find_dinner))
        }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                stringResource(R.string.vehicle_aide_help),
                style = MaterialTheme.typography.titleLarge,
            )
            val report = state.reports.firstOrNull()
            val remedy = report?.remedy
            if (remedy != null) {
                Text(
                    stringResource(
                        R.string.recovery_verified_remedy,
                        remedy.attempts,
                        remedy.powerKw.toInt(),
                    ),
                )
            } else
                Text(
                    stringResource(
                        if (vehicle.fault != "none") R.string.home_needs_attention
                        else R.string.home_no_response,
                    ),
                )
            OutlinedButton(onClick = onAssistance, modifier = Modifier.fillMaxWidth()) {
                IconLabel(Icons.Filled.Info, stringResource(R.string.home_review_response))
            }
        }
    }
    state.journey
        ?.takeIf { it.state == "moving" }
        ?.let { journey ->
            OutlinedButton(
                onClick = { onCommand(MobilityCommand.Stop(journey.id)) },
                enabled = !board.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                IconLabel(AideIcons.Stop, stringResource(R.string.vehicle_cancel_journey))
            }
        }
}
