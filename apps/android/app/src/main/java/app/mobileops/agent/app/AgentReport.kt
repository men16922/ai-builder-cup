package app.mobileops.agent.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*

/**
 * The crew writes a small markdown subset: ### headings, bullets and **bold**. Anything else shows
 * as plain text.
 */
/** Render server-provided text as a limited markdown subset, never HTML or executable content. */
@Composable
internal fun Report(markdown: String) {
    Column(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(16.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (line in markdown.lines()) {
            val trimmed = line.trim()
            when {
                trimmed.isEmpty() -> Spacer(Modifier.height(2.dp))
                trimmed.startsWith("#") ->
                    Text(
                        trimmed.trimStart('#').trim(),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 6.dp).semantics { heading() },
                    )

                trimmed.startsWith("- ") || trimmed.startsWith("* ") ->
                    Text(
                        inline(
                            "• " +
                                trimmed.drop(
                                    2,
                                ),
                        ),
                        style = MaterialTheme.typography.bodyMedium,
                    )

                else -> Text(inline(trimmed), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

private fun inline(value: String) = buildAnnotatedString {
    var bold = false
    for ((index, part) in value.replace("`", "").split("**").withIndex()) {
        if (index > 0) bold = !bold
        withStyle(SpanStyle(fontWeight = if (bold) FontWeight.Bold else null)) {
            append(
                part,
            )
        }
    }
}
