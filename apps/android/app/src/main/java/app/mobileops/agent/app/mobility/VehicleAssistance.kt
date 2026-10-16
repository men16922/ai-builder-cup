package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Done
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.*
import java.time.Instant

/** The model proposes a runbook. Only the server Guardian and current policy authorize a remedy. */
@Composable
internal fun VehicleAssistance(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    language: String,
) {
    val state = board.state ?: return
    val vehicle = state.vehicle ?: return
    val report = state.reports.firstOrNull()
    var reviewPolicy by remember(vehicle.id) { mutableStateOf(false) }
    val active =
        state.policy.enabled &&
            state.policy.expiresAt?.let {
                Instant.parse(it).toEpochMilli() > System.currentTimeMillis()
            } == true
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                stringResource(R.string.vehicle_aide_help),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            if (report != null) {
                var showEvidence by remember(report.id) { mutableStateOf(false) }
                Text(
                    when (report.state) {
                        "remediated" -> stringResource(R.string.vehicle_remedy_confirmed)
                        "needs_decision" -> stringResource(R.string.vehicle_needs_decision)
                        "investigating" -> stringResource(R.string.vehicle_investigating)
                        else -> stringResource(R.string.vehicle_human_help)
                    },
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                )
                report.remedy?.let { remedy ->
                    Text(
                        stringResource(
                            R.string.recovery_verified_remedy,
                            remedy.attempts,
                            remedy.powerKw.toInt(),
                        ),
                        fontWeight = FontWeight.Bold,
                    )
                    if (report.caseId != null && report.authorization == "standing-policy") {
                        Text(
                            stringResource(R.string.cases_used),
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                if (report.remedy == null) Text(report.summary)
                Text(
                    stringResource(
                        R.string.vehicle_authority,
                        when (report.authorization) {
                            "standing-policy" -> stringResource(R.string.vehicle_standing_policy)
                            "human-decision" -> stringResource(R.string.vehicle_explicit_decision)
                            else -> stringResource(R.string.vehicle_read_only)
                        },
                    ),
                    style = MaterialTheme.typography.bodySmall,
                )
                if (report.remedy != null)
                    TextButton(onClick = { showEvidence = !showEvidence }) {
                        Text(stringResource(R.string.recovery_execution_record))
                    }
                if (report.remedy == null || showEvidence) {
                    if (report.remedy != null) Text(report.summary)
                    report.evidence.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    report.unknowns.forEach {
                        Text(
                            it,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                RecoveryGuide(report, vehicle, board.busy, language, onCommand)
                if (report.state == "needs_decision")
                    Button(
                        onClick = { onCommand(MobilityCommand.Approve(report.id)) },
                        enabled = !board.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        IconLabel(
                            Icons.Filled.Done,
                            stringResource(R.string.vehicle_approve_reconnect),
                        )
                    }
            } else Text(stringResource(R.string.vehicle_no_report))
            OutlinedButton(
                onClick = { onCommand(MobilityCommand.Diagnose(language)) },
                enabled = !board.busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                IconLabel(AideIcons.Sparkle, stringResource(R.string.vehicle_diagnose))
            }
            HorizontalDivider()
            Text(stringResource(R.string.vehicle_policy_title), fontWeight = FontWeight.Bold)
            Text(
                stringResource(R.string.vehicle_policy_boundary),
                style = MaterialTheme.typography.bodySmall,
            )
            if (reviewPolicy) {
                Text(
                    stringResource(R.string.vehicle_policy_review),
                    style = MaterialTheme.typography.bodySmall,
                )
                Button(
                    onClick = {
                        onCommand(MobilityCommand.Policy(true))
                        reviewPolicy = false
                    },
                    enabled = !board.busy,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    IconLabel(Icons.Filled.Done, stringResource(R.string.vehicle_policy_allow))
                }
                TextButton(onClick = { reviewPolicy = false }) {
                    Text(stringResource(R.string.vehicle_cancel))
                }
            } else
                TextButton(
                    onClick = {
                        if (active) onCommand(MobilityCommand.Policy(false))
                        else reviewPolicy = true
                    },
                    enabled = !board.busy,
                ) {
                    Text(
                        stringResource(
                            if (active) R.string.vehicle_policy_disable
                            else R.string.vehicle_policy_configure,
                        ),
                    )
                }
        }
    }
    LearnedCases(state.cases, board.busy, onCommand)
}
