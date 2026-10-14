package app.mobileops.agent.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import kotlinx.serialization.json.*

/** Server-scoped work list; selecting a record requests its latest detail without executing it. */
@Composable
internal fun InboxScreen(
    state: MobileState,
    onRefresh: (String, Boolean) -> Unit,
    onOpen: (String) -> Unit,
) {
    Title(stringResource(R.string.ui_inbox_2))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (filter in listOf("pending", "results", "all")) FilterChip(
            selected = state.filter == filter,
            onClick = { onRefresh(filter, false) },
            enabled = !state.busy,
            label = {
                Text(
                    when (filter) {
                        "pending" -> stringResource(R.string.ui_pending)
                        "results" -> stringResource(R.string.ui_results)
                        else -> stringResource(R.string.ui_all)
                    },
                )
            },
        )
    }
    Text(
        stringResource(R.string.ui_latest_50_plans_up_to_20_per),
        style = MaterialTheme.typography.bodySmall,
    )
    state.inbox?.let { inbox ->
        Text(
            stringResource(R.string.ui_server_time) + inbox.serverTime,
            style = MaterialTheme.typography.labelSmall,
        )
        if (inbox.items.isEmpty()) Text(stringResource(R.string.ui_no_work_in_this_range))
        inbox.items.forEach { item ->
            Card(
                onClick = { onOpen(item.id) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
            ) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        item.binding.target.resourceName.substringAfterLast('/'),
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(scenarioText(item.label), color = MaterialTheme.colorScheme.tertiary)
                    Text(
                        if (item.dataMode == "synthetic") stringResource(R.string.ui_synthetic_data)
                        else stringResource(R.string.ui_live_collection_record),
                        style = MaterialTheme.typography.labelSmall,
                    )
                    Text(
                        item.binding.target.projectId + " · " + item.binding.target.location,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(
                        stateText(item.executionState ?: item.reviewStatus),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        stringResource(R.string.ui_evidence) + item.evidenceObservedAt,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    if (item.expired)
                        Text(
                            stringResource(R.string.ui_expired_execution_unavailable),
                            color = MaterialTheme.colorScheme.error,
                        )
                }
            }
        }
        if (inbox.nextCursor != null)
            OutlinedButton(
                onClick = { onRefresh(state.filter, true) },
                enabled = !state.busy,
            ) {
                Text(stringResource(R.string.ui_next_page))
            }
    }
    OutlinedButton(onClick = { onRefresh(state.filter, false) }, enabled = !state.busy) {
        Text(
            stringResource(R.string.ui_refresh_inbox),
        )
    }
}
