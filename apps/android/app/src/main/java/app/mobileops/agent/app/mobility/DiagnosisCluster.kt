package app.mobileops.agent.app.mobility

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.SimulatedVehicle
import java.text.NumberFormat
import java.util.Locale

/** The part of the car the current simulated fault points to. */
internal enum class FaultPart {
    CHARGE_PORT,
    BATTERY,
    TIRE_RL,
    UNKNOWN,
}

internal fun faultPart(vehicle: SimulatedVehicle): FaultPart? =
    when {
        vehicle.fault == "charge_handshake" ||
            vehicle.fault == "unknown" && vehicle.diagnosticSignal == "charge_link_timeout" ->
            FaultPart.CHARGE_PORT
        vehicle.fault == "battery_hot" -> FaultPart.BATTERY
        vehicle.fault == "tire_low" -> FaultPart.TIRE_RL
        vehicle.fault == "unknown" -> FaultPart.UNKNOWN
        else -> null
    }

/**
 * Instrument cluster and a top-down car diagram: the affected part is highlighted; everything else
 * reads normal. Values are simulated twin telemetry, never physical sensor readings.
 */
@Composable
internal fun DiagnosisCluster(vehicle: SimulatedVehicle, onServiceShop: () -> Unit) {
    val part = faultPart(vehicle)
    val headline =
        stringResource(
            when (part) {
                FaultPart.CHARGE_PORT -> R.string.cluster_charge_port_fault
                FaultPart.BATTERY -> R.string.cluster_battery_fault
                FaultPart.TIRE_RL -> R.string.cluster_tire_fault
                FaultPart.UNKNOWN -> R.string.cluster_unknown_fault
                null -> R.string.cluster_normal
            },
        )
    val error = MaterialTheme.colorScheme.error
    val clusterTitle = stringResource(R.string.cluster_title)
    Card(
        Modifier.fillMaxWidth().semantics { paneTitle = clusterTitle },
        colors =
            CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        border = if (part != null) BorderStroke(1.dp, error.copy(alpha = .6f)) else null,
    ) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier.size(10.dp)
                        .background(
                            if (part != null) error else MaterialTheme.colorScheme.primary,
                            CircleShape,
                        ),
                )
                Text(
                    headline,
                    fontWeight = FontWeight.Bold,
                    color = if (part != null) error else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                SimBadge()
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Gauge(
                    vehicle.batteryPercent / 100f,
                    stringResource(R.string.vehicle_percent, vehicle.batteryPercent),
                    stringResource(R.string.cluster_battery),
                    MaterialTheme.colorScheme.primary,
                )
                Gauge(
                    (vehicle.batteryCelsius / 60.0).toFloat(),
                    stringResource(R.string.cluster_celsius, degrees(vehicle.batteryCelsius)),
                    stringResource(R.string.cluster_battery_temp),
                    if (part == FaultPart.BATTERY) error else MaterialTheme.colorScheme.tertiary,
                )
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Fact(
                        stringResource(R.string.cluster_range),
                        stringResource(R.string.vehicle_range_km, vehicle.rangeKm),
                    )
                    Fact(
                        stringResource(R.string.cluster_charging),
                        when (vehicle.charging) {
                            "charging" ->
                                stringResource(
                                    R.string.vehicle_power_kw,
                                    kilowatts(vehicle.powerKw),
                                )
                            "interrupted" -> stringResource(R.string.cluster_interrupted)
                            else -> stringResource(R.string.cluster_idle)
                        },
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Fact(
                        stringResource(R.string.cluster_cabin),
                        stringResource(
                            R.string.cluster_celsius,
                            degrees(vehicle.climate.cabinCelsius),
                        ),
                    )
                    Fact(
                        stringResource(R.string.cluster_odometer),
                        stringResource(
                            R.string.vehicle_drive_km,
                            NumberFormat.getIntegerInstance(Locale.getDefault())
                                .format(vehicle.odometerKm),
                        ),
                    )
                }
            }
            CarDiagram(vehicle, part, stringResource(R.string.cluster_diagram, headline))
            Text(
                stringResource(R.string.cluster_note),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (vehicle.fault == "tire_low")
                OutlinedButton(onClick = onServiceShop, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Filled.Place, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.cluster_service_shop))
                }
        }
    }
}

@Composable
internal fun SimBadge() {
    Text(
        stringResource(R.string.cluster_sim),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier =
            Modifier.background(
                    MaterialTheme.colorScheme.surfaceContainerHighest,
                    RoundedCornerShape(6.dp),
                )
                .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

@Composable
private fun RowScope.Gauge(fraction: Float, value: String, label: String, color: Color) {
    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    Row(
        Modifier.weight(1f),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Canvas(Modifier.size(56.dp)) {
            val stroke = 7.dp.toPx()
            val inset = stroke / 2
            val arcSize = Size(size.width - stroke, size.height - stroke)
            drawArc(track, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
            drawArc(
                color,
                -90f,
                360f * fraction.coerceIn(0f, 1f),
                false,
                Offset(inset, inset),
                arcSize,
                style = Stroke(stroke, cap = StrokeCap.Round),
            )
        }
        Column {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text(
                label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun RowScope.Fact(label: String, value: String) {
    Column(
        Modifier.weight(1f)
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(value, fontWeight = FontWeight.Bold)
    }
}

/** Top-down car in a fixed 340×320 design space, scaled to fit; only the faulty part glows. */
@Composable
private fun CarDiagram(vehicle: SimulatedVehicle, part: FaultPart?, description: String) {
    val colors = MaterialTheme.colorScheme
    val measurer = rememberTextMeasurer()
    val batteryLabel = stringResource(R.string.cluster_battery)
    val motorLabel = stringResource(R.string.cluster_motor)
    val portLabel = stringResource(R.string.cluster_charge_port)
    Canvas(
        Modifier.fillMaxWidth().height(250.dp).semantics { contentDescription = description },
    ) {
        val scale = minOf(size.width / 340f, size.height / 320f)
        val left = (size.width - 340f * scale) / 2
        val top = (size.height - 320f * scale) / 2
        fun p(x: Float, y: Float) = Offset(left + (x + 70f) * scale, top + y * scale)
        fun rect(x: Float, y: Float, w: Float, h: Float, r: Float, color: Color) =
            drawRoundRect(color, p(x, y), Size(w * scale, h * scale), CornerRadius(r * scale))
        val faultFill = colors.error
        val partFill = colors.secondaryContainer
        rect(46f, 20f, 108f, 280f, 46f, colors.surfaceContainerHighest)
        drawRoundRect(
            colors.outline,
            p(46f, 20f),
            Size(108f * scale, 280f * scale),
            CornerRadius(46f * scale),
            style = Stroke(1.5.dp.toPx()),
        )
        val glass = colors.primary.copy(alpha = .28f)
        drawPath(
            Path().apply {
                p(62f, 86f).let { moveTo(it.x, it.y) }
                val c = p(100f, 66f)
                val e = p(138f, 86f)
                quadraticTo(c.x, c.y, e.x, e.y)
                p(132f, 112f).let { lineTo(it.x, it.y) }
                val c2 = p(100f, 102f)
                val e2 = p(68f, 112f)
                quadraticTo(c2.x, c2.y, e2.x, e2.y)
                close()
            },
            glass,
        )
        drawPath(
            Path().apply {
                p(66f, 236f).let { moveTo(it.x, it.y) }
                val c = p(100f, 246f)
                val e = p(134f, 236f)
                quadraticTo(c.x, c.y, e.x, e.y)
                p(136f, 258f).let { lineTo(it.x, it.y) }
                val c2 = p(100f, 270f)
                val e2 = p(64f, 258f)
                quadraticTo(c2.x, c2.y, e2.x, e2.y)
                close()
            },
            glass,
        )
        val batteryFault = part == FaultPart.BATTERY
        rect(70f, 124f, 60f, 96f, 10f, if (batteryFault) faultFill else partFill)
        label(
            measurer,
            batteryLabel,
            p(100f, 172f),
            if (batteryFault) colors.onError else colors.onSecondaryContainer,
            11f,
            center = true,
        )
        rect(80f, 262f, 40f, 18f, 6f, partFill)
        label(measurer, motorLabel, p(100f, 271f), colors.onSecondaryContainer, 8f, center = true)
        val portFault = part == FaultPart.CHARGE_PORT
        val portColor = if (portFault) faultFill else colors.onSurfaceVariant
        drawLine(portColor, p(40f, 200f), p(4f, 200f), 1.5.dp.toPx())
        drawCircle(if (portFault) faultFill else partFill, 7f * scale, p(47f, 200f))
        if (portFault) drawCircle(faultFill.copy(alpha = .3f), 14f * scale, p(47f, 200f))
        label(measurer, portLabel, p(4f, 188f), portColor, 10f, end = true)
        val tires = listOf(34f to 62f, 154f to 62f, 34f to 218f, 154f to 218f)
        tires.forEachIndexed { index, (x, y) ->
            val fault = index == 2 && part == FaultPart.TIRE_RL
            rect(x, y, 14f, 44f, 5f, if (fault) faultFill else colors.onSurface.copy(alpha = .75f))
            val text =
                String.format(
                    Locale.getDefault(),
                    "%.1f",
                    vehicle.tiresBar.getOrElse(index) { 0.0 },
                )
            val color = if (fault) faultFill else colors.onSurfaceVariant
            if (index % 2 == 0)
                label(measurer, text, p(x - 6f, y + 22f), color, 11f, end = true, bold = fault)
            else label(measurer, text, p(x + 20f, y + 22f), color, 11f, bold = fault)
        }
        if (part == FaultPart.UNKNOWN)
            label(measurer, "?", p(100f, 48f), faultFill, 26f, center = true, bold = true)
    }
}

/** Draws one label vertically centred on [at]; [end] right-aligns, [center] centres it. */
private fun DrawScope.label(
    measurer: TextMeasurer,
    text: String,
    at: Offset,
    color: Color,
    size: Float,
    center: Boolean = false,
    end: Boolean = false,
    bold: Boolean = false,
) {
    val layout =
        measurer.measure(
            text,
            TextStyle(
                color = color,
                fontSize = size.sp,
                fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
            ),
        )
    val x =
        when {
            center -> at.x - layout.size.width / 2f
            end -> at.x - layout.size.width
            else -> at.x
        }
    drawText(layout, topLeft = Offset(x, at.y - layout.size.height / 2f))
}
