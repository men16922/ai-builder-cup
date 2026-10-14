package app.mobileops.agent.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import kotlinx.serialization.json.*

@Composable
internal fun NotificationCleanupNotice() =
    Notice(
        stringResource(R.string.ui_notification_cleanup_unconfirmed),
        stringResource(R.string.ui_the_previous_app_connection_is_cleared_server),
    )

/** Device registration is opt-in; successful registration does not prove message delivery. */
@Composable
internal fun NotificationControls(
    state: NotificationState,
    onEnable: () -> Unit,
    onDisable: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Title(stringResource(R.string.ui_work_notifications_on_this_device))
            if (!state.supported)
                Text(
                    stringResource(R.string.ui_push_reception_is_not_connected_in_this),
                )
            else {
                Text(
                    if (state.enabled)
                        stringResource(
                            R.string.ui_device_registration_confirmed_message_arrival_is_not,
                        )
                    else stringResource(R.string.ui_enable_to_register_for_gcp_work_notifications),
                )
                if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (state.uncertain)
                    Text(
                        stringResource(
                            R.string.ui_registration_outcome_unknown_recheck_the_same_request,
                        ),
                    )
                state.failure?.let {
                    Text(
                        failureText(it),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                Button(onClick = { onEnable() }, enabled = !state.busy) {
                    Text(
                        if (state.uncertain) stringResource(R.string.ui_recheck_registration)
                        else if (state.enabled) stringResource(R.string.ui_refresh_registration)
                        else stringResource(R.string.ui_enable_work_notifications),
                    )
                }
                if (state.enabled || state.uncertain || state.busy || state.failure != null)
                    OutlinedButton(
                        onClick = { onDisable() },
                    ) {
                        Text(
                            stringResource(R.string.ui_disable_notifications),
                        )
                    }
            }
            if (state.cleanupUnknown)
                Text(
                    stringResource(
                        R.string.ui_local_connection_cleared_server_retirement_is_unconfirmed,
                    ),
                    color = MaterialTheme.colorScheme.error,
                )
        }
    }
}
