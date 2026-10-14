package app.mobileops.agent.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

/**
 * First-launch guide with replay and skip; receives display state and never performs operations.
 */
@Composable
internal fun OnboardingScreen(
    state: OnboardingUiState,
    onNext: () -> Unit,
    onBack: () -> Unit,
    onSkip: () -> Unit,
    modifier: Modifier = Modifier,
) {
    BackHandler { if (state.page > 0) onBack() else onSkip() }
    val title =
        when (state.page) {
            0 -> R.string.onboarding_title_1
            1 -> R.string.onboarding_title_2
            else -> R.string.onboarding_title_3
        }
    val body =
        when (state.page) {
            0 -> R.string.onboarding_body_1
            1 -> R.string.onboarding_body_2
            else -> R.string.onboarding_body_3
        }
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                stringResource(
                    R.string.onboarding_progress,
                    state.page + 1,
                    OnboardingUiState.PAGE_COUNT,
                ),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.testTag("onboarding_progress"),
            )
            TextButton(onClick = onSkip, modifier = Modifier.testTag("onboarding_skip")) {
                Text(stringResource(R.string.onboarding_skip))
            }
        }
        OnboardingIllustration(state.page)
        Text(
            stringResource(title),
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(stringResource(body), style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(8.dp))
        Button(onClick = onNext, modifier = Modifier.fillMaxWidth().testTag("onboarding_next")) {
            Text(
                stringResource(
                    if (state.lastPage) R.string.onboarding_finish else R.string.onboarding_next,
                ),
            )
        }
        if (state.page > 0)
            TextButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.onboarding_back))
            }
    }
}
