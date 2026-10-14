package app.mobileops.agent.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*

/**
 * The crew assistant. The phone only asks and decides; every investigation step and the one allowed
 * change run on the server.
 */
@Composable
internal fun AgentScreen(
    board: AgentBoard,
    onSend: (String) -> Unit,
    onSelect: (String) -> Unit,
    onDecide: (String, Boolean) -> Unit,
) {
    if (!board.available) return
    var draft by remember { mutableStateOf("") }
    val task = board.selected
    Card(
        Modifier.fillMaxWidth(),
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Title(stringResource(R.string.ui_agent_crew))
            Text(
                stringResource(R.string.ui_say_it_in_one_sentence_the_crew),
                style = MaterialTheme.typography.bodyMedium,
            )
            OutlinedTextField(
                draft,
                { if (it.length <= 1000) draft = it },
                Modifier.fillMaxWidth(),
                label = { Text(stringResource(R.string.ui_ask_the_crew)) },
                placeholder = {
                    Text(
                        stringResource(R.string.ui_check_shop_api_and_summarize_its_health),
                    )
                },
                minLines = 2,
                maxLines = 5,
                enabled = !board.busy,
            )
            Button(
                onClick = {
                    onSend(draft)
                    draft = ""
                },
                enabled = draft.isNotBlank() && !board.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(stringResource(R.string.ui_send))
            }
            if (board.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            board.failure?.let {
                Notice(
                    stringResource(R.string.ui_needs_a_look),
                    agentFailure(it),
                )
            }
            if (board.items.size > 1)
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    for (item in board.items.take(3)) FilterChip(
                        selected = item.id == board.selectedId,
                        onClick = { onSelect(item.id) },
                        label = {
                            Text(
                                item.instruction.take(14) +
                                    if (item.instruction.length > 14) "…" else "",
                                maxLines = 1,
                            )
                        },
                    )
                }
            if (task != null) TaskView(task, board.busy, onDecide)
        }
    }
}
