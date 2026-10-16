package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.MobilityCase
import app.mobileops.agent.mobility.MobilityCommand
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Promotion activates evidence only; it neither runs a remedy nor enables the standing policy. */
@Composable
internal fun LearnedCases(
    cases: List<MobilityCase>,
    busy: Boolean,
    onCommand: (MobilityCommand) -> Unit,
) {
    if (cases.isEmpty()) return
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                stringResource(R.string.cases_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                stringResource(R.string.cases_boundary),
                style = MaterialTheme.typography.bodySmall,
            )
            cases.forEach { learned -> LearnedCase(learned, busy, onCommand) }
        }
    }
}

@Composable
private fun LearnedCase(
    learned: MobilityCase,
    busy: Boolean,
    onCommand: (MobilityCommand) -> Unit,
) {
    var review by remember(learned.id) { mutableStateOf(false) }
    val expired = Instant.parse(learned.expiresAt).toEpochMilli() <= System.currentTimeMillis()
    val locale = LocalConfiguration.current.locales[0]
    val deadline =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(learned.expiresAt))
    HorizontalDivider()
    Text(stringResource(R.string.cases_signal_title), fontWeight = FontWeight.Bold)
    Text(
        stringResource(
            when {
                expired -> R.string.cases_expired
                learned.status == "active" -> R.string.cases_active
                learned.status == "candidate" -> R.string.cases_candidate
                else -> R.string.cases_revoked
            },
        ),
        color = MaterialTheme.colorScheme.primary,
    )
    Text(stringResource(R.string.cases_pattern), style = MaterialTheme.typography.bodySmall)
    Text(stringResource(R.string.cases_verified_change), style = MaterialTheme.typography.bodySmall)
    Text(
        stringResource(R.string.cases_valid_until, deadline),
        style = MaterialTheme.typography.bodySmall,
    )
    Text(stringResource(R.string.cases_simulation), style = MaterialTheme.typography.bodySmall)
    if (learned.status == "candidate" && !expired) {
        OutlinedButton(
            onClick = { review = true },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            IconLabel(Icons.Filled.Add, stringResource(R.string.cases_register))
        }
    }
    if (learned.status != "revoked" && !expired) {
        TextButton(
            onClick = { onCommand(MobilityCommand.RevokeCase(learned.id)) },
            enabled = !busy,
        ) {
            IconLabel(Icons.Filled.Delete, stringResource(R.string.cases_revoke))
        }
    }
    if (review && learned.status == "candidate") {
        AlertDialog(
            onDismissRequest = { review = false },
            title = { Text(stringResource(R.string.cases_register)) },
            text = {
                Text(
                    stringResource(R.string.cases_promotion_review),
                    Modifier.verticalScroll(rememberScrollState()),
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onCommand(MobilityCommand.PromoteCase(learned.id))
                        review = false
                    },
                    enabled = !busy && !expired,
                ) {
                    Text(stringResource(R.string.cases_promote))
                }
            },
            dismissButton = {
                TextButton(onClick = { review = false }) {
                    Text(stringResource(R.string.vehicle_cancel))
                }
            },
        )
    }
}
