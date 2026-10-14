package app.mobileops.agent.app.mobility

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.Notice
import app.mobileops.agent.app.R
import app.mobileops.agent.app.failureText
import app.mobileops.agent.mobility.*

/** Driver home. All vehicle values are server-persisted simulation, never physical readings. */
@Composable
internal fun VehicleScreen(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    onRefresh: () -> Unit,
    onJourney: (String) -> Unit,
    onAssistance: () -> Unit,
) {
    val state = board.state
    val vehicle = state?.vehicle
    if (board.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    board.failure?.let {
        Notice(stringResource(R.string.vehicle_request_attention), failureText(it))
    }
    if (vehicle == null) {
        Image(
            painterResource(R.drawable.aide_ev),
            stringResource(R.string.vehicle_image),
            Modifier.fillMaxWidth().height(220.dp),
        )
        Text(
            stringResource(R.string.vehicle_connect_title),
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(R.string.vehicle_connect_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        Button(
            onClick = { onCommand(MobilityCommand.Initialize) },
            enabled = state != null && !board.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.vehicle_connect))
        }
        if (state == null)
            OutlinedButton(
                onClick = onRefresh,
                enabled = board.available && !board.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.vehicle_refresh))
            }
        return
    }
    VehicleHero(vehicle)
    VehicleMap(vehicle.location)
    VehicleHomeActions(board, onCommand, onJourney, onAssistance)
}
