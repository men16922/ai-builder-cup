package app.mobileops.agent.app.mobility

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.Failure
import app.mobileops.agent.app.R
import app.mobileops.agent.app.failureText

/**
 * Presentation of an already-recorded repository failure. This component has no API or command
 * callback: opening, reading and dismissing it cannot retry an uncertain operation. The repository
 * clears failure when a new explicit request starts, so a later failure opens a fresh dialog.
 */
@Composable
internal fun VehicleFailureDialog(failure: Failure?, code: String? = null) {
    if (failure == null) return
    var visible by remember(failure, code) { mutableStateOf(true) }
    var manual by remember(failure, code) { mutableStateOf(false) }
    if (!visible) return
    val knownGuide =
        when (code) {
            "mobility_outcome_unknown",
            "mobility_request_changed" ->
                R.string.mobility_error_unknown_summary to R.string.mobility_error_unknown
            "maps_not_configured",
            "vehicle_ai_not_configured" ->
                R.string.mobility_error_config_summary to R.string.mobility_error_config
            "mobility_in_progress" ->
                R.string.mobility_error_busy_summary to R.string.mobility_error_busy
            "mobility_budget_exceeded",
            "rate_limited" -> R.string.mobility_error_quota_summary to R.string.mobility_error_quota
            "vehicle_moving",
            "runbook_guard_refused",
            "recovery_not_verified",
            "case_not_promotable" ->
                R.string.mobility_error_safety_summary to R.string.mobility_error_safety
            "places_empty" -> R.string.mobility_error_empty_summary to R.string.mobility_error_empty
            "places_out_of_range" ->
                R.string.mobility_error_range_summary to R.string.mobility_error_range
            "mobility_provider_busy" ->
                R.string.mobility_error_provider_busy_summary to
                    R.string.mobility_error_provider_busy
            "vehicle_changed",
            "report_changed",
            "journey_changed",
            "case_changed",
            "recovery_guide_changed",
            "investigation_expired",
            "destination_not_offered" ->
                R.string.ui_the_record_changed_or_expired to R.string.mobility_error_changed
            "mobility_not_entitled",
            "operator_required",
            "reviewer_required",
            "forbidden" ->
                R.string.ui_the_current_user_cannot_access_this_record to
                    R.string.mobility_error_access
            "unauthorized" ->
                R.string.ui_sign_in_again_to_continue to R.string.mobility_error_sign_in
            else ->
                if (code == null && failure != Failure.STALE) null
                else R.string.mobility_error_unknown_summary to R.string.mobility_error_unknown
        }
    val nextStep =
        knownGuide?.second
            ?: when (failure) {
                Failure.SIGN_IN -> R.string.mobility_error_sign_in
                Failure.DENIED -> R.string.mobility_error_access
                Failure.STALE -> R.string.mobility_error_changed
                Failure.OFFLINE -> R.string.mobility_error_offline
                Failure.INVALID_RESPONSE,
                Failure.UNAVAILABLE -> R.string.mobility_error_unknown
            }
    AlertDialog(
        onDismissRequest = { visible = false },
        title = { Text(stringResource(R.string.vehicle_request_attention)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(knownGuide?.first?.let { stringResource(it) } ?: failureText(failure))
                if (manual) {
                    Text(
                        stringResource(R.string.mobility_error_next),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(stringResource(nextStep))
                }
            }
        },
        confirmButton = {
            if (!manual)
                TextButton(onClick = { manual = true }) {
                    Text(stringResource(R.string.mobility_error_manual))
                }
        },
        dismissButton = {
            TextButton(onClick = { visible = false }) {
                Text(stringResource(R.string.mobility_error_close))
            }
        },
    )
}
