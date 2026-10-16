package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.*
import java.util.Locale
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/**
 * Driver selection creates contextual consent; future matching requests are decided by the server.
 */
@Composable
internal fun JourneyScreen(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    initialKind: String = "restaurant",
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
    Text(stringResource(R.string.vehicle_where_to), style = MaterialTheme.typography.headlineMedium)
    Text(stringResource(R.string.vehicle_trip_intro), style = MaterialTheme.typography.bodyMedium)
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
        IconLabel(AideIcons.Sparkle, stringResource(R.string.vehicle_let_aide))
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
            IconLabel(Icons.Filled.PlayArrow, stringResource(R.string.journey_continue))
        }
    }
    JourneySimulation(journey, state.vehicle?.batteryPercent, state.call?.state == "active")
    ArrivalCharging(board, onCommand)
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
        journey.candidates.forEachIndexed { index, place ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PlacePhoto(place, index = index + 1)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        PlaceBadge(index + 1)
                        Text(
                            place.name,
                            style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    val km = straightKm(journey.origin, place.location)
                    Text(
                        stringResource(
                            R.string.place_distance_arrival,
                            String.format(Locale.getDefault(), "%.1f", km),
                            arrivalBattery(state.vehicle?.batteryPercent ?: 0, km),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
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
                                MobilityCommand.SelectDestination(
                                    journey.id,
                                    place.id,
                                    rememberChoice,
                                ),
                            )
                        },
                        enabled = !board.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        IconLabel(AideIcons.Navigation, stringResource(R.string.vehicle_go_here))
                    }
                    TextButton(
                        onClick = { onCommand(MobilityCommand.Favorite(journey.id, place.id)) },
                        enabled = !board.busy && state.favorites.none { it.id == place.id },
                    ) {
                        val saved = state.favorites.any { it.id == place.id }
                        IconLabel(
                            if (saved) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                            stringResource(
                                if (saved) R.string.vehicle_favorite_saved
                                else R.string.vehicle_save_favorite,
                            ),
                        )
                    }
                }
            }
        }
        Text(
            stringResource(R.string.vehicle_google_maps),
            style = MaterialTheme.typography.labelSmall,
        )
    }
    journey.destination?.let {
        if (it.photo != null) PlacePhoto(it)
        Text(it.name, style = MaterialTheme.typography.titleMedium)
        Text(it.address, style = MaterialTheme.typography.bodySmall)
    }
    if (moving)
        OutlinedButton(
            onClick = { onCommand(MobilityCommand.Stop(journey.id)) },
            enabled = !board.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            IconLabel(AideIcons.Stop, stringResource(R.string.vehicle_cancel_journey))
        }
}

/**
 * The journey keeps moving on any mobility tab once the driver started it. Only the repository's
 * journeyRunning flag, set by an explicit trip, selection or advance, arms this; reads, refreshes
 * and failures never do, and an unknown outcome is never resent.
 */
@Composable
internal fun JourneyAutoAdvance(board: VehicleBoard, onAutomaticAdvance: (String) -> Unit) {
    val journey = board.state?.journey
    val moving = journey?.state == "moving"
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
}

/** Arrived at a charging destination: start or stop the simulated session from here. */
@Composable
private fun ArrivalCharging(board: VehicleBoard, onCommand: (MobilityCommand) -> Unit) {
    val state = board.state ?: return
    val journey = state.journey ?: return
    val vehicle = state.vehicle ?: return
    if (journey.state != "arrived" || journey.kind != "charging") return
    val charging = vehicle.charging == "charging"
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.primaryContainer,
                contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
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
                    if (charging)
                        stringResource(
                            R.string.arrival_charging_now,
                            kilowatts(vehicle.powerKw),
                            vehicle.batteryPercent,
                        )
                    else stringResource(R.string.arrival_at_charger),
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    stringResource(R.string.arrival_charge_limit, vehicle.targetPercent),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            if (charging)
                OutlinedButton(
                    onClick = { onCommand(MobilityCommand.Control("stop_charging")) },
                    enabled = !board.busy,
                ) {
                    IconLabel(AideIcons.Stop, stringResource(R.string.arrival_stop_charging))
                }
            else
                Button(
                    onClick = { onCommand(MobilityCommand.Control("start_charging")) },
                    enabled = !board.busy && vehicle.batteryPercent < vehicle.targetPercent,
                ) {
                    IconLabel(AideIcons.Bolt, stringResource(R.string.arrival_start_charging))
                }
        }
    }
}

/** Planar straight-line estimate used by the cards; it never claims a road distance. */
internal fun straightKm(from: Coordinate, to: Coordinate): Double =
    hypot((to.latitude - from.latitude) * 111, (to.longitude - from.longitude) * 88)

internal fun arrivalBattery(battery: Int, km: Double): Int =
    (battery - maxOf(1, (km / 5.2).roundToInt())).coerceAtLeast(0)
