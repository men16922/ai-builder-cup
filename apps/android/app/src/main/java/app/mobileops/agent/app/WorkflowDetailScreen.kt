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

/** Keeps evidence review separate from execution. Capabilities are revalidated by the server. */
@Composable
internal fun DetailScreen(
    state: MobileState,
    onReview: (Boolean) -> Unit,
    canPerform: (Operation) -> Boolean,
    onPerform: (Operation, String) -> Unit,
) {
    val view = state.detail!!
    val plan = view.plan.payload
    var note by remember(plan.planId, state.scope) { mutableStateOf("") }
    Title(plan.target.resourceName.substringAfterLast('/'))
    Text(
        if (plan.dataMode == "synthetic") stringResource(R.string.ui_synthetic_data)
        else stringResource(R.string.ui_live_collection_record),
        color = MaterialTheme.colorScheme.tertiary,
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Metric(
            Modifier.weight(1f),
            stringResource(R.string.ui_review),
            stateText(view.plan.review.status),
        )
        Metric(
            Modifier.weight(1f),
            stringResource(R.string.ui_execution),
            stateText(view.execution?.state ?: "not_started"),
        )
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Title(stringResource(R.string.ui_01_target_and_evidence))
            Text(plan.target.projectId + " / " + plan.target.location)
            Text(stringResource(R.string.ui_revision) + plan.target.revision)
            Text("UID: " + plan.target.resourceUid, style = MaterialTheme.typography.bodySmall)
            Text(
                stringResource(R.string.ui_observed) + plan.evidence.observedAt,
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                stringResource(R.string.ui_expires) + plan.expiresAt,
                style = MaterialTheme.typography.bodySmall,
            )
            Text(
                if (plan.action.id == "gcp.cloudrun.inspect.v1")
                    stringResource(R.string.ui_fixed_read_15_min_up_to_50)
                else stringResource(R.string.ui_fixed_read_service_and_revision_metadata),
                fontWeight = FontWeight.Bold,
            )
            plan.action.completionCriteria.forEach {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
    state.original?.let { EvidencePanel(it) }
    Notice(stringResource(R.string.ui_02_evidence_interpretation), plan.analysis.summary)
    Text(stringResource(R.string.ui_missing_information), fontWeight = FontWeight.Bold)
    plan.analysis.missingInformation.forEach { Text("• $it") }
    if (view.execution == null) {
        Row(Modifier.fillMaxWidth()) {
            Checkbox(
                checked = state.reviewed,
                onCheckedChange = { onReview(it) },
                enabled = !state.busy && !state.uncertain,
            )
            Text(
                stringResource(R.string.ui_i_checked_the_target_evidence_and_expiry),
                Modifier.padding(top = 12.dp),
            )
        }
        OutlinedTextField(
            value = note,
            onValueChange = { if (it.length <= 2000) note = it },
            label = { Text(stringResource(R.string.ui_review_note)) },
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.busy,
        )
        if (view.capabilities.requestReview)
            ActionButton(
                state,
                canPerform,
                onPerform,
                Operation.REVIEW,
                stringResource(R.string.ui_request_review),
                note,
            )
        if (view.capabilities.decide) {
            ActionButton(
                state,
                canPerform,
                onPerform,
                Operation.APPROVE,
                stringResource(R.string.ui_confirm_review),
                note,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(
                    onClick = { onPerform(Operation.REJECT, note) },
                    enabled = canPerform(Operation.REJECT),
                ) {
                    Text(stringResource(R.string.ui_reject))
                }
                TextButton(
                    onClick = { onPerform(Operation.CHANGES, note) },
                    enabled = canPerform(Operation.CHANGES),
                ) {
                    Text(stringResource(R.string.ui_request_changes))
                }
            }
        }
        if (view.capabilities.execute)
            ActionButton(
                state,
                canPerform,
                onPerform,
                Operation.EXECUTE,
                stringResource(R.string.ui_run_fixed_read_explicitly),
                note,
            )
    }
    view.execution?.let { execution ->
        Title(stringResource(R.string.ui_03_execution_result))
        Notice(
            stateText(execution.state),
            stringResource(R.string.ui_query_completion_is_separate_from_service_health),
        )
        execution.result?.let {
            Text(
                stringResource(R.string.ui_evidence_coverage) +
                    stateText(
                        it.coverage,
                    ),
            )
        }
        view.evidence?.let(::inspectionReceipt)?.outcomes?.forEach { outcome ->
            Text(outcome.id + " · " + stateText(outcome.status))
        }
        if (view.capabilities.cancel)
            ActionButton(
                state,
                canPerform,
                onPerform,
                Operation.CANCEL,
                stringResource(R.string.ui_cancel_before_start),
                "",
            )
        Title(stringResource(R.string.ui_04_handoff))
        Text(
            stringResource(R.string.ui_a_handoff_note_does_not_change_the),
            style = MaterialTheme.typography.bodySmall,
        )
        if (view.capabilities.handoff) {
            OutlinedTextField(
                value = note,
                onValueChange = { if (it.length <= 2000) note = it },
                label = { Text(stringResource(R.string.ui_next_checks)) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !state.busy,
            )
            ActionButton(
                state,
                canPerform,
                onPerform,
                Operation.HANDOFF,
                stringResource(R.string.ui_save_handoff),
                note,
            )
        }
        execution.handoffs.forEach { Notice(it.at, it.note) }
    }
}

@Composable
private fun ActionButton(
    state: MobileState,
    canPerform: (Operation) -> Boolean,
    onPerform: (Operation, String) -> Unit,
    operation: Operation,
    label: String,
    note: String,
) {
    Button(
        onClick = { onPerform(operation, note) },
        enabled =
            !state.busy &&
                canPerform(operation) &&
                (operation != Operation.HANDOFF || note.isNotBlank()),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(label)
    }
}
