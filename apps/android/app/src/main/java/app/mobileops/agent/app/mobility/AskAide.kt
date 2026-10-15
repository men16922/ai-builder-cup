package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.AssistProposal
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.VehicleBoard
import java.util.Locale

/**
 * Ask your own Aide: My Aide answers and proposes catalog actions. Asking runs nothing; only the
 * driver's tap on a proposal sends a control or starts a trip request, and nothing is resent.
 */
@Composable
internal fun AskAide(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    onTrip: (kind: String, instruction: String) -> Unit,
) {
    val language = stringResource(R.string.agent_request_language)
    val assist = board.state?.assist
    var text by rememberSaveable { mutableStateOf("") }
    var done by rememberSaveable { mutableStateOf(listOf<String>()) }
    // Pending item: "ask" or a proposal key, confirmed only after the server accepted it.
    var pending by remember { mutableStateOf<String?>(null) }
    var sawBusy by remember { mutableStateOf(false) }
    LaunchedEffect(board.busy, board.failure) {
        val key = pending ?: return@LaunchedEffect
        if (board.busy) {
            sawBusy = true
            return@LaunchedEffect
        }
        if (sawBusy) {
            if (board.failure == null) {
                if (key == ASK) text = "" else done = done + key
            }
            pending = null
            sawBusy = false
        }
    }
    val ask = {
        if (text.isNotBlank() && !board.busy) {
            done = emptyList()
            pending = ASK
            sawBusy = false
            onCommand(MobilityCommand.Assist(text.trim().take(300), language))
        }
    }
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    AideIcons.Sparkle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                )
                Text(
                    stringResource(R.string.ask_title),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
            }
            OutlinedTextField(
                value = text,
                onValueChange = { if (it.length <= 300) text = it },
                placeholder = { Text(stringResource(R.string.ask_placeholder)) },
                singleLine = true,
                enabled = !board.busy,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { ask() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = ask,
                enabled = !board.busy && text.isNotBlank() && board.state?.vehicle != null,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.ask_button))
            }
            if (assist != null) {
                Column(
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        stringResource(R.string.call_my_aide),
                        style = MaterialTheme.typography.labelLarge,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Text(assist.reply, style = MaterialTheme.typography.bodyMedium)
                    assist.proposals.forEachIndexed { index, proposal ->
                        val key = "${assist.id}:$index"
                        val label = proposalLabel(proposal)
                        if (key in done)
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
                                    stringResource(R.string.ask_done, label),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        else
                            FilledTonalButton(
                                onClick = {
                                    if (proposal.kind == "trip")
                                        onTrip(
                                            proposal.tripKind ?: "poi",
                                            proposal.instruction.orEmpty(),
                                        )
                                    else {
                                        pending = key
                                        sawBusy = false
                                        onCommand(
                                            MobilityCommand.Control(
                                                proposal.action.orEmpty(),
                                                proposal.value,
                                            ),
                                        )
                                    }
                                },
                                enabled = !board.busy,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(label)
                            }
                    }
                    Text(
                        stringResource(R.string.ask_caption),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

private const val ASK = "ask"

@Composable
private fun proposalLabel(proposal: AssistProposal): String {
    if (proposal.kind == "trip")
        return stringResource(
            when (proposal.tripKind) {
                "charging" -> R.string.ask_trip_charging
                "restaurant" -> R.string.ask_trip_restaurant
                else -> R.string.ask_trip_poi
            },
        )
    val value = proposal.value?.let(::plainNumber).orEmpty()
    return when (proposal.action) {
        "lock" -> stringResource(R.string.ask_lock)
        "unlock" -> stringResource(R.string.ask_unlock)
        "climate_on" -> stringResource(R.string.ask_climate_on)
        "climate_off" -> stringResource(R.string.ask_climate_off)
        "set_temperature" -> stringResource(R.string.ask_set_temperature, value)
        "set_charge_limit" -> stringResource(R.string.ask_charge_limit, value)
        "start_charging" -> stringResource(R.string.ask_start_charging)
        "stop_charging" -> stringResource(R.string.ask_stop_charging)
        "flash" -> stringResource(R.string.ask_flash)
        else -> stringResource(R.string.ask_honk)
    }
}

private fun plainNumber(value: Double): String =
    if (value % 1.0 == 0.0) value.toInt().toString()
    else String.format(Locale.getDefault(), "%.1f", value)
