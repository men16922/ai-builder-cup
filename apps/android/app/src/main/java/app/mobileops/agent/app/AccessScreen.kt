package app.mobileops.agent.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import kotlinx.serialization.json.*

/**
 * Explicit workspace sign-in. Missing configuration or permission never falls back to sample data.
 */
@Composable
internal fun ConfiguredAccess(
    configuration: app.mobileops.agent.app.data.ConfigurationState,
    state: LiveAccessState,
    onSignIn: (String) -> Unit,
    onCancel: () -> Unit,
) {
    val uriHandler = LocalUriHandler.current
    val config = configuration.configuration
    val invalid = configuration.invalid
    if (state.cleanupUnknown) NotificationCleanupNotice()
    if (invalid)
        Notice(
            stringResource(R.string.ui_configuration_needs_attention),
            stringResource(R.string.ui_the_packaged_server_or_identity_configuration_is),
        )
    else if (config == null)
        Text(
            stringResource(R.string.ui_live_access_is_not_configured_you_can),
            style = MaterialTheme.typography.bodySmall,
        )
    else
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Title(stringResource(R.string.ui_connect_your_gcp_workspace))

                Text(
                    stringResource(R.string.ui_sign_in_with_google_to_view_work),
                )
                state.failure?.let {
                    Text(
                        failureText(it),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (state.busy) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    TextButton(onClick = { onCancel() }) {
                        Text(
                            stringResource(R.string.ui_cancel_sign_in),
                        )
                    }
                }
                config!!.workspaces.forEach { workspace ->
                    Button(
                        onClick = { onSignIn(workspace.key) },
                        enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            workspace.label +
                                " · " +
                                stringResource(R.string.ui_sign_in_with_google),
                        )
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { uriHandler.openUri(config.origin + "/#/privacy") }) {
                        Text(stringResource(R.string.aide_privacy))
                    }
                    TextButton(onClick = { uriHandler.openUri(config.origin + "/#/terms") }) {
                        Text(stringResource(R.string.aide_terms))
                    }
                }
            }
        }
}
