package app.mobileops.agent.app.mobility

import android.content.Context
import android.speech.tts.TextToSpeech
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.mobileops.agent.app.R
import app.mobileops.agent.mobility.CallTurn
import app.mobileops.agent.mobility.MobilityCommand
import app.mobileops.agent.mobility.VehicleBoard
import app.mobileops.agent.mobility.VehicleCall
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

private val SCENARIOS =
    listOf(
        "meeting_reschedule" to R.string.call_scenario_meeting,
        "family_pickup" to R.string.call_scenario_pickup,
        "delivery" to R.string.call_scenario_delivery,
    )

/** Over this many turns the server refuses more call steps, so new turns are not offered. */
private const val TURN_LIMIT = 13

/**
 * Incoming call, live call sheet, post-call summary and the unconfirmed state, shown on every
 * mobility tab. Callers are fictional and voiced by the model. My Aide drafts; only an explicit tap
 * marks a follow-up done, and an unknown call step is never resent.
 */
@Composable
internal fun CallOverlay(
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    onRefresh: () -> Unit,
) {
    val call = board.state?.call ?: return
    var closed by rememberSaveable { mutableStateOf("") }
    var voiceOn by rememberSaveable { mutableStateOf(true) }
    var spokenId by rememberSaveable { mutableStateOf("") }
    var spokenCount by rememberSaveable { mutableIntStateOf(0) }
    if (
        call.state == "declined" ||
            call.state == "unknown" && closed == call.id ||
            call.state == "ended" && (closed == call.id || call.summary == null)
    )
        return
    val maxHeight =
        with(LocalDensity.current) { (LocalWindowInfo.current.containerSize.height * .62f).toDp() }
    Surface(
        Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        color = MaterialTheme.colorScheme.surfaceContainer,
        tonalElevation = 3.dp,
        shadowElevation = 12.dp,
    ) {
        Column(
            // Insets inside the surface so its colour reaches the screen edge.
            Modifier.fillMaxWidth()
                .navigationBarsPadding()
                .imePadding()
                .heightIn(max = maxHeight)
                .padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            when (call.state) {
                "unknown" -> CallUnconfirmed(call, onRefresh) { closed = call.id }
                "ringing" -> CallRinging(call, (board.busy || board.callBusy), onCommand)
                "active" ->
                    CallActive(
                        call,
                        board,
                        onCommand,
                        voiceOn,
                        onVoice = { voiceOn = it },
                        spoken = if (spokenId == call.id) spokenCount else 0,
                        onSpoken = { count ->
                            spokenId = call.id
                            spokenCount = count
                        },
                    )
                else ->
                    CallSummarySheet(call, (board.busy || board.callBusy), onCommand) {
                        closed = call.id
                    }
            }
        }
    }
}

@Composable
private fun CallAvatar(icon: ImageVector, color: Color, onColor: Color, size: Int = 44) {
    Box(
        Modifier.size(size.dp).background(color, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = onColor, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun CallRinging(call: VehicleCall, busy: Boolean, onCommand: (MobilityCommand) -> Unit) {
    val title = stringResource(R.string.call_from, call.caller.name)
    Row(
        Modifier.semantics { paneTitle = title },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        CallAvatar(
            AideIcons.Phone,
            MaterialTheme.colorScheme.primary,
            MaterialTheme.colorScheme.onPrimary,
            52,
        )
        Column(Modifier.weight(1f)) {
            Text(
                stringResource(R.string.call_incoming_simulated),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                call.caller.name,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                call.caller.relation,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        EndButton(stringResource(R.string.call_decline), !busy) {
            onCommand(MobilityCommand.CallDecline(call.id))
        }
    }
    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(
            onClick = { onCommand(MobilityCommand.CallAnswer(call.id, "aide")) },
            enabled = !busy,
            modifier = Modifier.weight(1.3f),
        ) {
            Icon(AideIcons.Sparkle, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.call_let_aide_answer), maxLines = 1)
        }
        OutlinedButton(
            onClick = { onCommand(MobilityCommand.CallAnswer(call.id, "driver")) },
            enabled = !busy,
            modifier = Modifier.weight(1f),
        ) {
            Icon(AideIcons.Phone, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.call_answer), maxLines = 1)
        }
    }
}

/** A read-only status label; unlike a chip it offers no action. */
@Composable
internal fun StatusPill(text: String, icon: ImageVector?, container: Color, content: Color) {
    Row(
        Modifier.background(container, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        icon?.let {
            Icon(it, contentDescription = null, tint = content, modifier = Modifier.size(16.dp))
        }
        Text(text, color = content, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun EndButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    FilledIconButton(
        onClick = onClick,
        enabled = enabled,
        colors =
            IconButtonDefaults.filledIconButtonColors(
                containerColor = MaterialTheme.colorScheme.error,
                contentColor = MaterialTheme.colorScheme.onError,
            ),
        modifier = Modifier.size(48.dp),
    ) {
        Icon(AideIcons.CallEnd, contentDescription = label)
    }
}

@Composable
private fun callClock(call: VehicleCall): String {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    // Real-time ticker off the frame clock, so UI tests and idle detection are not held open.
    LaunchedEffect(call.id, call.state) {
        if (call.state != "active") return@LaunchedEffect
        withContext(Dispatchers.Default) {
            while (isActive) {
                delay(1000)
                now = System.currentTimeMillis()
            }
        }
    }
    val started = runCatching { Instant.parse(call.startedAt).toEpochMilli() }.getOrDefault(now)
    val ended = call.endedAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
    val seconds = ((((ended ?: now) - started) / 1000).coerceAtLeast(0))
    return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
}

@Composable
private fun speaker(call: VehicleCall, role: String) =
    when (role) {
        "caller" -> call.caller.name
        "aide" -> stringResource(R.string.call_my_aide)
        else -> stringResource(R.string.call_you)
    }

@Composable
private fun ColumnScope.CallActive(
    call: VehicleCall,
    board: VehicleBoard,
    onCommand: (MobilityCommand) -> Unit,
    voiceOn: Boolean,
    onVoice: (Boolean) -> Unit,
    spoken: Int,
    onSpoken: (Int) -> Unit,
) {
    val voice = rememberCallVoice()
    LaunchedEffect(call.id, call.turns.size, voiceOn) {
        val fresh = call.turns.drop(spoken)
        onSpoken(call.turns.size)
        // Only the fictional caller and My Aide are voiced; the driver's own words never are.
        if (voiceOn)
            fresh
                .filter { it.role != "driver" }
                .forEach { voice.speak(it.text, call.language, it.role) }
    }
    val busy = (board.busy || board.callBusy)
    val clock = callClock(call)
    val journey = board.state?.journey
    val autopilot = journey?.state == "moving" && journey.autopilot
    val title = stringResource(R.string.call_on_call)
    var draft by rememberSaveable(call.id) { mutableStateOf("") }
    val exhausted = call.turns.size > TURN_LIMIT
    // Stop is a vehicle intent. A pending model reply must never disable it.
    if (journey?.state == "moving") {
        OutlinedButton(
            onClick = { onCommand(MobilityCommand.Stop(journey.id)) },
            enabled = !board.busy,
            modifier = Modifier.fillMaxWidth(),
        ) {
            IconLabel(AideIcons.Stop, stringResource(R.string.call_stop_drive))
        }
    }
    val send: (String) -> Unit = { text ->
        if (text.isNotBlank()) {
            onCommand(MobilityCommand.CallSay(call.id, text.trim().take(300)))
            draft = ""
        }
    }
    Row(
        Modifier.semantics { paneTitle = title },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CallAvatar(
            AideIcons.Phone,
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
        )
        Column(Modifier.weight(1f)) {
            Text(
                call.caller.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                stringResource(
                    R.string.call_status_clock,
                    stringResource(
                        if (call.handledBy == "aide") R.string.call_aide_on_call
                        else R.string.call_driver_on_call,
                    ),
                    clock,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            onClick = {
                if (voiceOn) voice.stop()
                onVoice(!voiceOn)
            },
        ) {
            Icon(
                if (voiceOn) AideIcons.VolumeUp else AideIcons.VolumeOff,
                contentDescription =
                    stringResource(
                        if (voiceOn) R.string.call_mute_voice else R.string.call_play_voice,
                    ),
            )
        }
        EndButton(stringResource(R.string.call_end), !busy) {
            onCommand(MobilityCommand.CallEnd(call.id))
        }
    }
    if (autopilot)
        StatusPill(
            stringResource(R.string.call_autopilot),
            AideIcons.Sparkle,
            MaterialTheme.colorScheme.secondaryContainer,
            MaterialTheme.colorScheme.onSecondaryContainer,
        )
    val scroll = rememberScrollState()
    LaunchedEffect(call.turns.size, busy) { scroll.animateScrollTo(scroll.maxValue) }
    val transcript = stringResource(R.string.call_transcript)
    Column(
        Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(scroll).semantics {
            contentDescription = transcript
            liveRegion = LiveRegionMode.Polite
        },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        call.turns.forEach { TurnBubble(call, it) }
        if (busy)
            Text(
                stringResource(R.string.call_responding),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
    }
    Row(
        Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        for (reply in
            listOf(
                R.string.call_quick_good,
                R.string.call_quick_callback,
                R.string.call_quick_driving,
            )) {
            val text = stringResource(reply)
            SuggestionChip(
                onClick = { send(text) },
                label = { Text(text) },
                enabled = !busy && !exhausted,
            )
        }
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        OutlinedTextField(
            value = draft,
            onValueChange = { if (it.length <= 300) draft = it },
            placeholder = { Text(stringResource(R.string.call_reply_yourself)) },
            singleLine = true,
            enabled = !busy && !exhausted,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { if (!busy && !exhausted) send(draft) }),
            modifier = Modifier.weight(1f),
        )
        FilledIconButton(
            onClick = { send(draft) },
            enabled = !busy && !exhausted && draft.isNotBlank(),
            modifier = Modifier.size(52.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Send,
                contentDescription = stringResource(R.string.call_send),
            )
        }
    }
    OutlinedButton(
        onClick = { onCommand(MobilityCommand.CallDelegate(call.id)) },
        enabled = !busy && !exhausted,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Icon(AideIcons.Sparkle, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(stringResource(R.string.call_let_aide_reply))
    }
}

@Composable
private fun TurnBubble(call: VehicleCall, turn: CallTurn) {
    val driver = turn.role == "driver"
    val colors = MaterialTheme.colorScheme
    val (container, content) =
        when (turn.role) {
            "driver" -> colors.primaryContainer to colors.onPrimaryContainer
            "aide" -> colors.tertiaryContainer to colors.onTertiaryContainer
            else -> colors.surfaceContainerHighest to colors.onSurface
        }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = if (driver) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            Modifier.widthIn(max = 300.dp)
                .background(
                    container,
                    RoundedCornerShape(
                        topStart = 18.dp,
                        topEnd = 18.dp,
                        bottomStart = if (driver) 18.dp else 4.dp,
                        bottomEnd = if (driver) 4.dp else 18.dp,
                    ),
                )
                .padding(horizontal = 14.dp, vertical = 10.dp),
        ) {
            Text(
                speaker(call, turn.role),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = content.copy(alpha = .8f),
            )
            Text(turn.text, color = content, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun ColumnScope.CallSummarySheet(
    call: VehicleCall,
    busy: Boolean,
    onCommand: (MobilityCommand) -> Unit,
    onClose: () -> Unit,
) {
    val summary = call.summary ?: return
    val title = stringResource(R.string.call_summary_title)
    Row(
        Modifier.semantics { paneTitle = title },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CallAvatar(
            AideIcons.Sparkle,
            MaterialTheme.colorScheme.tertiaryContainer,
            MaterialTheme.colorScheme.onTertiaryContainer,
        )
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                stringResource(R.string.call_status_clock, call.caller.name, callClock(call)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onClose) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.call_close))
        }
    }
    Column(
        Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(summary.text, style = MaterialTheme.typography.bodyMedium)
        summary.actionItems.forEach { item ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(
                    Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
                Text(item, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Followups(call, busy, onCommand)
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (call.saved)
            StatusPill(
                stringResource(R.string.call_saved),
                Icons.Filled.CheckCircle,
                MaterialTheme.colorScheme.primaryContainer,
                MaterialTheme.colorScheme.onPrimaryContainer,
            )
        else
            Button(onClick = { onCommand(MobilityCommand.CallSave(call.id)) }, enabled = !busy) {
                IconLabel(AideIcons.Bookmark, stringResource(R.string.call_save_summary))
            }
        OutlinedButton(onClick = onClose) {
            IconLabel(Icons.Filled.Close, stringResource(R.string.call_close))
        }
    }
}

/** Drafts only. "Done" records a simulated send or booking; nothing reaches a real inbox. */
@Composable
internal fun Followups(call: VehicleCall, busy: Boolean, onCommand: (MobilityCommand) -> Unit) {
    val items = call.summary?.followups.orEmpty()
    if (items.isEmpty()) return
    val whenFormat = remember { DateTimeFormatter.ofPattern("EEE HH:mm", Locale.getDefault()) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { item ->
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(
                        when (item.kind) {
                            "message" -> Icons.Filled.Email
                            "calendar" -> Icons.Filled.DateRange
                            else -> Icons.Filled.Notifications
                        },
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(item.title, fontWeight = FontWeight.Bold)
                        item.to?.let {
                            Text(
                                stringResource(R.string.call_followup_to, it),
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }
                        item.whenAt
                            ?.let {
                                runCatching {
                                    whenFormat.format(
                                        Instant.parse(it).atZone(ZoneId.systemDefault()),
                                    )
                                }
                                    .getOrNull()
                            }
                            ?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        item.body?.let {
                            Text(
                                it,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        if (item.status == "draft")
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilledTonalButton(
                                    onClick = {
                                        onCommand(MobilityCommand.Followup(call.id, item.id, true))
                                    },
                                    enabled = !busy,
                                ) {
                                    IconLabel(
                                        when (item.kind) {
                                            "message" -> Icons.AutoMirrored.Filled.Send
                                            "calendar" -> Icons.Filled.DateRange
                                            else -> Icons.Filled.Notifications
                                        },
                                        stringResource(
                                            when (item.kind) {
                                                "message" -> R.string.call_send_message
                                                "calendar" -> R.string.call_add_calendar
                                                else -> R.string.call_set_reminder
                                            },
                                        ),
                                    )
                                }
                                TextButton(
                                    onClick = {
                                        onCommand(MobilityCommand.Followup(call.id, item.id, false))
                                    },
                                    enabled = !busy,
                                ) {
                                    IconLabel(
                                        Icons.Filled.Clear,
                                        stringResource(R.string.call_dismiss),
                                    )
                                }
                            }
                        else
                            Text(
                                stringResource(
                                    if (item.status == "done") R.string.call_done_simulated
                                    else R.string.call_dismissed,
                                ),
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold,
                                color =
                                    if (item.status == "done") MaterialTheme.colorScheme.primary
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                    }
                }
            }
        }
    }
}

/**
 * A durable unknown call is shown for review. This panel has no call-step or model callback: the
 * only actions are reading the latest record and closing the card locally.
 */
@Composable
private fun ColumnScope.CallUnconfirmed(
    call: VehicleCall,
    onRefresh: () -> Unit,
    onDismiss: () -> Unit,
) {
    var transcript by rememberSaveable(call.id) { mutableStateOf(false) }
    val title = stringResource(R.string.call_unconfirmed_title)
    Row(
        Modifier.semantics { paneTitle = title },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CallAvatar(
            Icons.Filled.Warning,
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
        )
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                stringResource(R.string.call_simulated_call, call.caller.name),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onDismiss) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.call_close))
        }
    }
    Column(
        Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            stringResource(R.string.call_unconfirmed_body),
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Text(
            stringResource(R.string.call_no_followup),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.error,
        )
        if (call.turns.isNotEmpty()) {
            TextButton(onClick = { transcript = !transcript }) {
                Text(stringResource(R.string.call_confirmed_transcript))
            }
            if (transcript) call.turns.forEach { TurnBubble(call, it) }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Button(onClick = onRefresh) {
            Icon(Icons.Filled.Refresh, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.call_read_latest))
        }
        OutlinedButton(onClick = onDismiss) {
            IconLabel(Icons.Filled.Close, stringResource(R.string.call_close))
        }
    }
}

/** Calls tab: introduction, three fictional incoming-call scenarios and saved summaries. */
@Composable
internal fun CallsScreen(board: VehicleBoard, onCommand: (MobilityCommand) -> Unit) {
    val language = stringResource(R.string.agent_request_language)
    val state = board.state
    val live = state?.call?.state in setOf("ringing", "active")
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                stringResource(R.string.calls_intro_title),
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                stringResource(R.string.calls_intro_body),
                style = MaterialTheme.typography.bodyMedium,
            )
            Text(
                stringResource(R.string.calls_try_caption),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            for ((scenario, label) in SCENARIOS) {
                OutlinedButton(
                    onClick = { onCommand(MobilityCommand.CallIncoming(scenario, language)) },
                    enabled = !(board.busy || board.callBusy) && !live && state?.vehicle != null,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(AideIcons.Phone, contentDescription = null, Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(label))
                }
            }
        }
    }
    if ((board.busy || board.callBusy)) LinearProgressIndicator(Modifier.fillMaxWidth())
    val calls = state?.calls.orEmpty()
    Text(
        stringResource(R.string.calls_history_title),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.Bold,
    )
    if (calls.isEmpty()) {
        Text(
            stringResource(R.string.calls_empty),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    val format = remember { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT) }
    calls.forEach { call ->
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    CallAvatar(
                        AideIcons.Phone,
                        MaterialTheme.colorScheme.secondaryContainer,
                        MaterialTheme.colorScheme.onSecondaryContainer,
                        36,
                    )
                    Column(Modifier.weight(1f)) {
                        Text(call.caller.name, fontWeight = FontWeight.Bold)
                        Text(
                            stringResource(
                                R.string.call_status_clock,
                                runCatching {
                                        format.format(
                                            Instant.parse(call.startedAt)
                                                .atZone(ZoneId.systemDefault()),
                                        )
                                    }
                                    .getOrDefault(""),
                                stringResource(
                                    if (call.handledBy == "aide") R.string.calls_handled_aide
                                    else R.string.calls_handled_driver,
                                ),
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                call.summary?.text?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                Followups(call, (board.busy || board.callBusy), onCommand)
            }
        }
    }
}

@Composable
private fun rememberCallVoice(): CallVoice {
    val context = LocalContext.current.applicationContext
    val voice = remember(context) { CallVoice(context) }
    DisposableEffect(voice) { onDispose { voice.shutdown() } }
    return voice
}

/**
 * Optional Android TextToSpeech for caller and My Aide turns. The transcript stays authoritative; a
 * missing engine or language simply stays silent.
 */
private class CallVoice(context: Context) : TextToSpeech.OnInitListener {
    private val waiting = ArrayList<Triple<String, String, String>>()
    private var ready = false
    private var closed = false
    private val engine: TextToSpeech? = runCatching { TextToSpeech(context, this) }.getOrNull()

    override fun onInit(status: Int) {
        if (closed) return
        ready = status == TextToSpeech.SUCCESS
        if (ready) waiting.forEach { (text, language, role) -> say(text, language, role) }
        waiting.clear()
    }

    fun speak(text: String, language: String, role: String) {
        if (closed) return
        if (!ready) {
            if (waiting.size < 16) waiting += Triple(text, language, role)
            return
        }
        say(text, language, role)
    }

    private fun say(text: String, language: String, role: String) {
        val tts = engine ?: return
        runCatching {
            val locale = if (language == "ko") Locale.KOREA else Locale.US
            if (tts.setLanguage(locale) < TextToSpeech.LANG_AVAILABLE) return
            tts.setPitch(if (role == "aide") 1.15f else .9f)
            tts.setSpeechRate(1.05f)
            tts.speak(
                text.take(TextToSpeech.getMaxSpeechInputLength()),
                TextToSpeech.QUEUE_ADD,
                null,
                UUID.randomUUID().toString(),
            )
        }
    }

    fun stop() {
        waiting.clear()
        runCatching { engine?.stop() }
    }

    fun shutdown() {
        closed = true
        waiting.clear()
        runCatching {
            engine?.stop()
            engine?.shutdown()
        }
    }
}
