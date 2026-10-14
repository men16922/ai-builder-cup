package app.mobileops.agent.app.mobility

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * Provider display only: retain paragraphs and safely format emphasis, without extracting facts.
 */
@Composable
internal fun GroundedText(text: String) {
    val formatted =
        remember(text) {
            buildAnnotatedString {
                var cursor = 0
                Regex("\\*\\*([^*]+)\\*\\*").findAll(text).forEach { match ->
                    append(text.substring(cursor, match.range.first))
                    withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(match.groupValues[1])
                    }
                    cursor = match.range.last + 1
                }
                append(text.substring(cursor))
            }
        }
    Text(formatted, style = MaterialTheme.typography.bodyMedium)
}
