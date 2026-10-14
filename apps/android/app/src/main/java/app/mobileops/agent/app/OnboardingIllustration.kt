package app.mobileops.agent.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

/**
 * Tutorial illustration only; numbers, permissions and vehicle state are never inferred from it.
 */
@Composable
internal fun OnboardingIllustration(page: Int) {
    val primary = MaterialTheme.colorScheme.primary
    val accent = MaterialTheme.colorScheme.tertiary
    Box(
        Modifier.fillMaxWidth()
            .height(180.dp)
            .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(28.dp)),
        contentAlignment = Alignment.Center,
    ) {
        if (page == 0)
            Image(
                painterResource(R.drawable.aide_ev),
                stringResource(R.string.vehicle_image),
                Modifier.fillMaxWidth().height(160.dp),
            )
        else
            Canvas(Modifier.fillMaxWidth().height(160.dp).padding(28.dp)) {
                if (page == 1) {
                    val x = size.width * .28f
                    val y = size.height * .18f
                    drawRoundRect(
                        primary,
                        Offset(x, y),
                        Size(size.width * .44f, size.height * .64f),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(14f, 14f),
                        style = Stroke(4.dp.toPx()),
                    )
                    drawRect(
                        primary,
                        Offset(size.width * .72f, size.height * .38f),
                        Size(10.dp.toPx(), size.height * .24f),
                    )
                    val check =
                        Path().apply {
                            moveTo(size.width * .4f, size.height * .51f)
                            lineTo(size.width * .48f, size.height * .62f)
                            lineTo(size.width * .61f, size.height * .36f)
                        }
                    drawPath(check, accent, style = Stroke(5.dp.toPx()))
                } else {
                    val from = Offset(size.width * .15f, size.height * .8f)
                    val to = Offset(size.width * .85f, size.height * .2f)
                    val route =
                        Path().apply {
                            moveTo(from.x, from.y)
                            cubicTo(size.width * .62f, from.y, size.width * .38f, to.y, to.x, to.y)
                        }
                    drawPath(route, primary, style = Stroke(4.dp.toPx()))
                    drawCircle(primary, 9.dp.toPx(), from)
                    drawCircle(accent, 12.dp.toPx(), to)
                }
            }
    }
}
