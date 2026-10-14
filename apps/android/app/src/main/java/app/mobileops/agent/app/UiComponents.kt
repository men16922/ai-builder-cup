package app.mobileops.agent.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import kotlinx.serialization.json.*

/** Shared Material presentation components; no data fetching or session ownership. */
@Composable
internal fun Title(value: String) {
    Text(
        value,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.semantics { heading() },
    )
}

@Composable
internal fun Notice(title: String, body: String) {
    Column(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            title,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}

@Composable
internal fun Metric(modifier: Modifier, label: String, value: String) {
    Column(
        modifier
            .background(
                MaterialTheme.colorScheme.surfaceContainerLow,
                RoundedCornerShape(12.dp),
            )
            .padding(12.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.tertiary,
        )
        Text(value, fontWeight = FontWeight.Bold)
    }
}
