package app.mobileops.agent.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import app.mobileops.agent.*
import kotlinx.serialization.json.*

@Composable
internal fun scenarioText(label: String) =
    when (label) {
        "signals" -> stringResource(R.string.ui_error_sample_scenario)
        "empty" -> stringResource(R.string.ui_empty_sample_scenario)
        "denied" -> stringResource(R.string.ui_latency_access_denied)
        else -> label
    }

@Composable
internal fun failureText(failure: Failure) =
    when (failure) {
        Failure.OFFLINE ->
            stringResource(R.string.ui_connection_lost_records_are_hidden_and_nothing)

        Failure.SIGN_IN -> stringResource(R.string.ui_sign_in_again_to_continue)
        Failure.DENIED -> stringResource(R.string.ui_the_current_user_cannot_access_this_record)

        Failure.STALE -> stringResource(R.string.ui_the_record_changed_or_expired)
        Failure.INVALID_RESPONSE ->
            stringResource(R.string.ui_the_response_does_not_match_the_expected)

        Failure.UNAVAILABLE -> stringResource(R.string.ui_the_request_could_not_be_confirmed_read)
    }

/**
 * Translate known wire states with resources, keeping unknown future values visible as received.
 */
@Composable
internal fun stateText(value: String) =
    when (value) {
        "not_requested" -> stringResource(R.string.state_not_requested)
        "pending" -> stringResource(R.string.state_pending)
        "approved" -> stringResource(R.string.state_approved)
        "rejected" -> stringResource(R.string.state_rejected)
        "changes_requested" -> stringResource(R.string.state_changes_requested)
        "not_started" -> stringResource(R.string.state_not_started)
        "queued" -> stringResource(R.string.state_queued)
        "running" -> stringResource(R.string.state_running)
        "succeeded" -> stringResource(R.string.state_succeeded)
        "failed" -> stringResource(R.string.state_failed)
        "unknown" -> stringResource(R.string.state_unknown)
        "cancelled" -> stringResource(R.string.state_cancelled)
        "collected" -> stringResource(R.string.state_collected)
        "no_data" -> stringResource(R.string.state_no_data)
        "denied" -> stringResource(R.string.state_denied)
        "missing" -> stringResource(R.string.state_missing)
        "unavailable" -> stringResource(R.string.state_unavailable)
        "skipped" -> stringResource(R.string.state_skipped)
        "partial" -> stringResource(R.string.state_partial)
        "complete" -> stringResource(R.string.state_complete)
        else -> value
    }
