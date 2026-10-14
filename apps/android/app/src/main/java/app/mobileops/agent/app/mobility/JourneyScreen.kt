package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.Notice
import app.mobileops.agent.app.R
import app.mobileops.agent.app.failureText
import app.mobileops.agent.mobility.*
import kotlinx.coroutines.delay

/**
 * Driver selection creates contextual consent; future matching requests are decided by the server.
 */
@Composable
internal fun JourneyScreen(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    initialKind: String = "restaurant",
    onAutomaticAdvance: (String) -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    val language = stringResource(R.string.agent_request_language)
    val state = board.state
    val journey = state?.journey
    var kind by remember(initialKind) { mutableStateOf(initialKind) }
    var draft by remember { mutableStateOf("") }
    var rememberChoice by remember { mutableStateOf(true) }
    val example =
        stringResource(
            when (kind) {
                "charging" -> R.string.vehicle_trip_charging
                "poi" -> R.string.vehicle_trip_poi
                else -> R.string.vehicle_trip_dinner
            },
        )
    val moving = journey?.state == "moving"
    // Only the visible simulation advances. Leaving the view cancels this effect, never a real
    // drive.
    LaunchedEffect(
        journey?.id,
        journey?.progress,
        board.busy,
        board.failure,
        board.journeyRunning,
    ) {
        if (moving && board.journeyRunning && !board.busy && board.failure == null) {
            delay(1200)
            onAutomaticAdvance(journey!!.id)
        }
    }
    Text(stringResource(R.string.vehicle_where_to), style = MaterialTheme.typography.headlineMedium)
    Text(stringResource(R.string.vehicle_trip_intro), style = MaterialTheme.typography.bodyMedium)
    board.failure?.let {
        Notice(stringResource(R.string.vehicle_request_attention), failureText(it))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((value, label) in
            listOf(
                "restaurant" to R.string.vehicle_dinner,
                "charging" to R.string.vehicle_chargers,
                "poi" to R.string.vehicle_explore,
            )) FilterChip(
            selected = kind == value,
            onClick = { kind = value },
            enabled = !moving,
            label = { Text(stringResource(label)) },
        )
    }
    OutlinedTextField(
        value = draft,
        onValueChange = { if (it.length <= 300) draft = it },
        label = { Text(stringResource(R.string.vehicle_trip_ask)) },
        placeholder = { Text(example) },
        modifier = Modifier.fillMaxWidth(),
        enabled = !moving,
        minLines = 2,
        maxLines = 4,
    )
    Button(
        onClick = {
            onCommand(MobilityCommand.RequestTrip(kind, draft.trim().ifBlank { example }, language))
        },
        enabled = !moving && !board.busy && state?.vehicle != null && state.mapsAvailable,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(stringResource(R.string.vehicle_let_aide))
    }
    if (state?.mapsAvailable != true)
        Text(
            stringResource(R.string.vehicle_maps_pending),
            style = MaterialTheme.typography.bodySmall,
        )
    if (board.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (journey == null) return
    Text(
        stringResource(
            when (journey.state) {
                "moving" -> R.string.vehicle_journey_moving
                "arrived" -> R.string.vehicle_journey_arrived
                "cancelled" -> R.string.vehicle_journey_cancelled
                else -> R.string.vehicle_choose_destination
            },
        ),
        style = MaterialTheme.typography.titleLarge,
    )
    if (journey.consent == "remembered-context" || journey.consent == "favorite")
        Text(
            stringResource(
                if (journey.consent == "favorite") R.string.vehicle_using_favorite
                else R.string.vehicle_using_memory,
            ),
            style = MaterialTheme.typography.bodySmall,
        )
    if (moving && !board.journeyRunning) {
        Text(
            stringResource(R.string.journey_pause_boundary),
            style = MaterialTheme.typography.bodySmall,
        )
        Button(
            onClick = { onCommand(MobilityCommand.Advance(journey!!.id)) },
            enabled = !board.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.journey_continue))
        }
    }
    JourneySimulation(journey)
    journey.searchSummary?.let { summary ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                GroundedText(summary)
                // Keep every returned Google Maps source one tap from the complete grounded output.
                journey.candidates.forEachIndexed { index, place ->
                    place.mapsUrl?.let { url ->
                        TextButton(onClick = { uriHandler.openUri(url) }) {
                            Text(stringResource(R.string.vehicle_maps_source, index, place.name))
                        }
                    }
                }
            }
        }
    }
    if (journey.state == "choosing") {
        Row(Modifier.fillMaxWidth()) {
            Checkbox(checked = rememberChoice, onCheckedChange = { rememberChoice = it })
            Text(stringResource(R.string.vehicle_remember_context), Modifier.padding(top = 12.dp))
        }
        for (place in journey.candidates) Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(place.name, style = MaterialTheme.typography.titleMedium)
                if (place.address.isNotBlank())
                    Text(place.address, style = MaterialTheme.typography.bodySmall)
                if (place.rating != null)
                    Text(
                        stringResource(R.string.vehicle_place_rating, place.rating.toString()),
                        style = MaterialTheme.typography.bodySmall,
                    )
                if (place.kind == "charging")
                    Text(
                        if (place.availablePorts == null)
                            stringResource(R.string.vehicle_ports_unknown)
                        else
                            stringResource(
                                R.string.vehicle_ports_available,
                                requireNotNull(place.availablePorts),
                            ),
                        style = MaterialTheme.typography.bodySmall,
                    )
                Button(
                    onClick = {
                        onCommand(
                            MobilityCommand.SelectDestination(journey.id, place.id, rememberChoice),
                        )
                    },
                    enabled = !board.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(R.string.vehicle_go_here))
                }
                TextButton(
                    onClick = { onCommand(MobilityCommand.Favorite(journey.id, place.id)) },
                    enabled = !board.busy && state.favorites.none { it.id == place.id },
                ) {
                    Text(
                        stringResource(
                            if (state.favorites.any { it.id == place.id })
                                R.string.vehicle_favorite_saved
                            else R.string.vehicle_save_favorite,
                        ),
                    )
                }
            }
        }
        Text(
            stringResource(R.string.vehicle_google_maps),
            style = MaterialTheme.typography.labelSmall,
        )
    }
    journey.destination?.let {
        Text(it.name, style = MaterialTheme.typography.titleMedium)
        Text(it.address, style = MaterialTheme.typography.bodySmall)
    }
    if (moving)
        OutlinedButton(
            onClick = { onCommand(MobilityCommand.Stop(journey.id)) },
            enabled = !board.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(stringResource(R.string.vehicle_cancel_journey))
        }
}
