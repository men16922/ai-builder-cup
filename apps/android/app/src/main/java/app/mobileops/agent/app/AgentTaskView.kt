package app.mobileops.agent.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import java.time.Instant

/** Presents one stored investigation and its explicit, expiring human decision. */
@Composable
internal fun TaskView(task: AgentTask, busy: Boolean, onDecide: (String, Boolean) -> Unit) {
    val label = agentStateText(task.state)
    Column(
        Modifier.fillMaxWidth().semantics {
            liveRegion = LiveRegionMode.Polite
            contentDescription = "$label. ${task.instruction.take(80)}"
        },
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            task.instruction,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
        )
        StatePill(task.state, label)
        if (task.state == AgentState.WORKING || task.state == AgentState.DECIDING)
            LinearProgressIndicator(
                Modifier.fillMaxWidth(),
            )
        if (task.steps.isNotEmpty())
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    stringResource(R.string.ui_steps, task.steps.size),
                    style = MaterialTheme.typography.labelLarge,
                )
                for (step in task.steps.takeLast(8)) {
                    val outcome = step.executionState
                    if (outcome == null)
                        Text(
                            "${if (step.kind == "call") "→" else if (step.kind == "result") "✓" else "•"} ${step.agent}: ${step.summary}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    else {
                        val (symbol, words) = executionText(outcome)
                        Text(
                            "$symbol ${step.agent}: $words",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold,
                            color =
                                if (outcome == ExecutionState.APPLIED)
                                    MaterialTheme.colorScheme.primary
                                else if (outcome == ExecutionState.FAILED)
                                    MaterialTheme.colorScheme.error
                                else MaterialTheme.colorScheme.tertiary,
                        )
                    }
                }
            }
        val approval = task.approval
        if (approval != null && task.state == AgentState.AWAITING_APPROVAL) {
            val open = task.decidable(System.currentTimeMillis())
            val minutes =
                ((Instant.parse(approval.expiresAt).toEpochMilli() - System.currentTimeMillis()) /
                        60000)
                    .coerceAtLeast(0) + 1
            Column(
                Modifier.fillMaxWidth()
                    .background(
                        MaterialTheme.colorScheme.tertiaryContainer,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    stringResource(R.string.ui_your_decision_is_needed),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                Text(
                    stringResource(
                        R.string.ui_send_100_of_traffic_back_to_revision,
                        approval.action.service,
                        approval.action.revision,
                    ),
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                Text(
                    approval.reason,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                approval.reviewed?.let { reviewed ->
                    Text(
                        stringResource(R.string.agent_reviewed_at, reviewed.observedAt),
                        style = MaterialTheme.typography.bodySmall,
                    )
                    reviewed.traffic.forEach { split ->
                        Text(
                            stringResource(
                                R.string.agent_reviewed_traffic,
                                split.revision,
                                split.percent,
                            ),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                if (approval.reviewed == null)
                    Text(
                        stringResource(R.string.agent_review_missing),
                        style = MaterialTheme.typography.bodySmall,
                    )
                Text(
                    if (open)
                        stringResource(
                            R.string.ui_risk_reversible_nothing_is_deleted_decide_within,
                            approval.risk,
                            minutes,
                        )
                    else stringResource(R.string.ui_the_approval_window_has_passed_ask_again),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { onDecide(task.id, true) },
                        enabled = open && !busy && approval.reviewed != null,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.ui_approve_and_apply))
                    }
                    OutlinedButton(
                        onClick = { onDecide(task.id, false) },
                        enabled = open && !busy,
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(stringResource(R.string.ui_reject))
                    }
                }
            }
        }
        task.note?.let { Notice(stringResource(R.string.ui_note), it) }
        task.result?.let { Report(it) }
    }
}

@Composable
private fun StatePill(state: AgentState, label: String) {
    val colors = MaterialTheme.colorScheme
    val (container, content) =
        when (state) {
            AgentState.AWAITING_APPROVAL -> colors.tertiaryContainer to colors.onTertiaryContainer
            AgentState.COMPLETED -> colors.primaryContainer to colors.onPrimaryContainer
            AgentState.FAILED,
            AgentState.UNKNOWN -> colors.errorContainer to colors.onErrorContainer
            else -> colors.secondaryContainer to colors.onSecondaryContainer
        }
    Text(
        label,
        color = content,
        style = MaterialTheme.typography.labelLarge,
        modifier =
            Modifier.background(container, RoundedCornerShape(50))
                .padding(horizontal = 14.dp, vertical = 6.dp),
    )
}
