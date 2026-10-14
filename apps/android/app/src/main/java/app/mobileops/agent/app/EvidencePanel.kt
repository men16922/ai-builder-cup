package app.mobileops.agent.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Displays the original plan observation. It is never relabelled as a later execution result. */
@Composable
fun EvidencePanel(evidence: OriginalEvidence) {
    val locale = LocalConfiguration.current.locales[0]
    val numbers =
        remember(locale) {
            NumberFormat.getNumberInstance(locale).apply {
                maximumFractionDigits = 1
                roundingMode = RoundingMode.HALF_UP
            }
        }

    fun number(value: Number?) = value?.let { numbers.format(it) } ?: "—"
    @Composable
    fun readiness(value: String?) =
        when (value) {
            "succeeded" -> stringResource(R.string.ui_ready)
            "failed" -> stringResource(R.string.ui_readiness_failed)
            "pending" -> stringResource(R.string.ui_pending_2)
            "reconciling" -> stringResource(R.string.ui_reconciling)
            else -> stringResource(R.string.ui_unknown)
        }

    var detailsOpen by remember(evidence.id) { mutableStateOf(false) }
    var allTraffic by remember(evidence.id) { mutableStateOf(false) }
    var allLogs by remember(evidence.id) { mutableStateOf(false) }
    Title(stringResource(R.string.ui_original_plan_evidence))
    Text(evidenceTime(evidence.observedAt), style = MaterialTheme.typography.labelSmall)
    Notice(
        stringResource(R.string.ui_application_health_unknown),
        stringResource(R.string.ui_deployment_readiness_does_not_establish_application_health),
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Metric(
            Modifier.weight(1f),
            stringResource(R.string.ui_service_readiness),
            readiness(evidence.service?.readiness),
        )
        Metric(
            Modifier.weight(1f),
            stringResource(R.string.ui_pinned_revision_readiness),
            readiness(evidence.revision?.readiness),
        )
    }
    Text(
        stringResource(R.string.ui_before_after_comparison) +
            when (evidence.consistency) {
                "stable" -> stringResource(R.string.ui_no_change_observed)
                "changed" -> stringResource(R.string.ui_changed_during_collection)
                else -> stringResource(R.string.ui_recheck_incomplete)
            },
        fontWeight = FontWeight.SemiBold,
    )
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Title(stringResource(R.string.ui_observed_traffic_allocation))
            if (evidence.service?.traffic.isNullOrEmpty())
                Text(
                    stringResource(R.string.ui_allocation_is_unavailable_this_does_not_mean),
                )
            else
                (if (allTraffic) evidence.service!!.traffic!!
                    else
                        evidence.service!!
                            .traffic!!
                            .take(
                                5,
                            ))
                    .forEach { row ->
                        Text(
                            row.revision ?: stringResource(R.string.ui_unknown_revision),
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(row.percent?.let { "$it%" } ?: "—", fontWeight = FontWeight.Bold)
                        row.percent?.let { EvidenceBar(it / 100f) }
                    }
            if ((evidence.service?.traffic?.size ?: 0) > 5)
                TextButton(
                    onClick = {
                        allTraffic = !allTraffic
                    },
                ) {
                    Text(
                        if (allTraffic) stringResource(R.string.ui_show_fewer_allocations)
                        else
                            stringResource(
                                R.string.ui_show_all_allocations,
                                evidence.service!!.traffic!!.size,
                            ),
                    )
                }
            Text(
                stringResource(R.string.ui_routing_configuration_not_request_volume_or_error),
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
    val telemetry = evidence.telemetry
    if (telemetry == null)
        Notice(
            stringResource(R.string.ui_logs_and_metrics_not_collected),
            stringResource(R.string.ui_this_plan_was_prepared_from_service_and),
        )
    else {
        val summary = telemetry.summary()
        Title(stringResource(R.string.ui_logs_and_request_metrics))
        Text(
            evidenceTime(telemetry.window.start) + " — " + evidenceTime(telemetry.window.end),
            style = MaterialTheme.typography.labelSmall,
        )
        Text(
            stringResource(R.string.ui_pinned_revision_15_minutes_ending_two_minutes),
            style = MaterialTheme.typography.bodySmall,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric(
                Modifier.weight(1f),
                stringResource(R.string.ui_returned_request_count),
                number(summary.total),
            )
            Metric(
                Modifier.weight(1f),
                stringResource(R.string.ui_returned_5xx_count),
                number(summary.errorCount),
            )
        }
        Text(
            sourceStatus(telemetry.requests.status),
            style = MaterialTheme.typography.bodySmall,
        )
        Metric(
            Modifier.fillMaxWidth(),
            stringResource(R.string.ui_highest_per_minute_per_code_p95),
            summary.highestP95Ms?.let { number(it) + " ms" } ?: "—",
        )
        Text(sourceStatus(telemetry.latency.status), style = MaterialTheme.typography.bodySmall)
        if (summary.counts.isNotEmpty())
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Title(stringResource(R.string.ui_returned_requests_by_response_code))
                    summary.counts.forEach { row ->
                        Text(
                            "HTTP ${row.code} · ${number(row.count)}",
                            fontWeight = FontWeight.SemiBold,
                        )
                        EvidenceBar(
                            if ((summary.total ?: 0) > 0)
                                row.count.toFloat() / summary.total!!.toFloat()
                            else 0f,
                        )
                    }
                }
            }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Title(stringResource(R.string.ui_recent_log_samples))
                Text(sourceStatus(telemetry.logs.status))
                if (telemetry.logs.truncated == true)
                    Text(
                        stringResource(R.string.ui_more_pages_exist_partial_results),
                        style = MaterialTheme.typography.bodySmall,
                    )
                val visible = if (allLogs) summary.logs else summary.logs.take(5)
                visible.forEach { sample ->
                    HorizontalDivider()
                    Text(
                        evidenceTime(sample.timestamp),
                        style = MaterialTheme.typography.labelSmall,
                    )
                    Text("${sample.severity} · ${sample.stream}", fontWeight = FontWeight.SemiBold)
                    Text(
                        "HTTP ${sample.responseCode ?: "—"} · " +
                            (sample.latencyMs?.let {
                                number(
                                    it,
                                ) + " ms"
                            } ?: "—"),
                    )
                }
                if (summary.logs.size > 5)
                    TextButton(onClick = { allLogs = !allLogs }) {
                        Text(
                            if (allLogs) stringResource(R.string.ui_show_fewer_log_samples)
                            else stringResource(R.string.ui_show_all_samples, summary.logs.size),
                        )
                    }
            }
        }
        Notice(
            stringResource(R.string.ui_sample_limits),
            stringResource(R.string.ui_these_are_not_complete_request_totals_error),
        )
    }
    OutlinedButton(onClick = { detailsOpen = !detailsOpen }, modifier = Modifier.fillMaxWidth()) {
        Text(
            if (detailsOpen) stringResource(R.string.ui_hide_deployment_details_and_sources)
            else stringResource(R.string.ui_show_deployment_details_and_sources),
        )
    }
    if (detailsOpen)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Title(stringResource(R.string.ui_deployment_details))
                val service = evidence.service
                Text(
                    stringResource(R.string.ui_latest_created_revision) +
                        (service?.latestCreatedRevision ?: "—"),
                )
                Text(
                    stringResource(R.string.ui_latest_ready_revision) +
                        (service?.latestReadyRevision ?: "—"),
                )
                Text(
                    stringResource(R.string.ui_requested_observed_generation) +
                        (service?.generation ?: "—") +
                        " / " +
                        (service?.observedGeneration ?: "—"),
                )
                Text(
                    stringResource(R.string.ui_reconciling_2) +
                        when (service?.reconciling) {
                            true -> stringResource(R.string.ui_yes)
                            false -> stringResource(R.string.ui_no)
                            null -> stringResource(R.string.ui_unknown)
                        },
                )
                evidence.facts.forEach { fact ->
                    HorizontalDivider()
                    Text(
                        sourceName(fact.id) + " · " + sourceStatus(fact.status),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(evidenceTime(fact.observedAt), style = MaterialTheme.typography.labelSmall)
                    Text(fact.source, style = MaterialTheme.typography.bodySmall)
                    fact.code?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    if (fact.truncated == true)
                        Text(
                            stringResource(R.string.ui_more_pages_exist_partial_results),
                        )
                    if (fact.missingFields.isNotEmpty())
                        Text(
                            stringResource(R.string.ui_missing_needs_review) +
                                fact.missingFields.joinToString(", "),
                        )
                }
            }
        }
}

@Composable
private fun EvidenceBar(fraction: Float) {
    Box(
        Modifier.fillMaxWidth()
            .height(8.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
            .clearAndSetSemantics {},
    ) {
        Box(
            Modifier.fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(4.dp)),
        )
    }
}

private fun evidenceTime(value: String) =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'", Locale.ROOT)
        .withZone(ZoneOffset.UTC)
        .format(Instant.parse(value))

@Composable
internal fun sourceName(id: String) =
    when (id) {
        "service" -> stringResource(R.string.ui_service_read)
        "revision" -> stringResource(R.string.ui_pinned_revision_read)

        "recheck" -> stringResource(R.string.ui_service_recheck)
        "logs" -> stringResource(R.string.ui_logs)
        "requests" -> stringResource(R.string.ui_requests)
        "latency" -> stringResource(R.string.ui_latency)
        else -> id
    }

@Composable
internal fun sourceStatus(status: String) =
    when (status) {
        "collected" -> stringResource(R.string.ui_collected)
        "no_data" -> stringResource(R.string.ui_no_samples_not_zero)

        "denied" -> stringResource(R.string.ui_access_denied)
        "missing" -> stringResource(R.string.ui_not_found)
        "skipped" -> stringResource(R.string.ui_target_unverified_not_queried)
        else -> stringResource(R.string.ui_collection_unavailable)
    }
