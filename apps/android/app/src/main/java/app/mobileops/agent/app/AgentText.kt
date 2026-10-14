package app.mobileops.agent.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import app.mobileops.agent.*

@Composable
internal fun executionText(state: ExecutionState) =
    when (state) {
        ExecutionState.APPLIED -> "✓" to stringResource(R.string.ui_applied_and_confirmed)
        ExecutionState.PENDING -> "…" to stringResource(R.string.ui_in_progress_not_finished)
        ExecutionState.UNKNOWN -> "?" to stringResource(R.string.ui_outcome_unknown_not_sent_again)

        ExecutionState.FAILED -> "✕" to stringResource(R.string.ui_not_applied_failed)
        ExecutionState.REFUSED -> "–" to stringResource(R.string.ui_refused_nothing_changed)
    }

@Composable
internal fun agentStateText(state: AgentState) =
    when (state) {
        AgentState.WORKING -> stringResource(R.string.ui_working)
        AgentState.AWAITING_APPROVAL -> stringResource(R.string.ui_waiting_for_your_decision)

        AgentState.DECIDING -> stringResource(R.string.ui_applying_your_decision)
        AgentState.COMPLETED -> stringResource(R.string.ui_done)
        AgentState.REJECTED -> stringResource(R.string.ui_rejected)
        AgentState.FAILED -> stringResource(R.string.ui_failed)

        AgentState.UNKNOWN -> stringResource(R.string.ui_outcome_unknown)
    }

@Composable
internal fun agentFailure(failure: Failure) =
    when (failure) {
        Failure.OFFLINE ->
            stringResource(R.string.ui_connection_lost_nothing_was_resent_automatically_check)

        Failure.SIGN_IN -> stringResource(R.string.ui_sign_in_again_to_continue)
        Failure.DENIED -> stringResource(R.string.ui_you_are_not_allowed_to_do_this)
        Failure.STALE -> stringResource(R.string.ui_the_approval_expired_or_was_already_handled)

        Failure.INVALID_RESPONSE ->
            stringResource(R.string.ui_the_server_response_could_not_be_verified)

        Failure.UNAVAILABLE -> stringResource(R.string.ui_the_request_could_not_be_confirmed_read_2)
    }
