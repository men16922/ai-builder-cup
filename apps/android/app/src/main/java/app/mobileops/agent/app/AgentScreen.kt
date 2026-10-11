package app.mobileops.agent.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.mobileops.agent.*
import java.time.Instant

/** The crew assistant. The phone only asks and decides; every investigation step and the one allowed change run on the server. */
@Composable internal fun AgentScreen(ko: Boolean, agent: MobileAgent, language: String) {
    val board by agent.state.collectAsStateWithLifecycle()
    if (!board.available) return
    var draft by remember { mutableStateOf("") }
    val task = board.selected
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Title(text(ko, "에이전트 팀", "Agent crew"))
            Text(text(ko, "한 문장으로 지시하세요. 조사와 진단은 팀이 하고, 큰 결정만 당신에게 묻습니다.", "Say it in one sentence. The crew investigates and diagnoses and only asks you for the big decisions."), style = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(draft, { if (it.length <= 1000) draft = it }, Modifier.fillMaxWidth(), label = { Text(text(ko, "에이전트에게 지시", "Ask the crew")) },
                placeholder = { Text(text(ko, "shop-api 상태를 점검하고 요약해 줘.", "Check shop-api and summarize its health.")) }, minLines = 2, maxLines = 5, enabled = !board.busy)
            Button(onClick = { agent.send(draft, language); draft = "" }, enabled = draft.isNotBlank() && !board.busy, modifier = Modifier.fillMaxWidth()) { Text(text(ko, "지시하기", "Send")) }
            if (board.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            board.failure?.let { Notice(text(ko, "확인이 필요합니다", "Needs a look"), agentFailure(ko, it)) }
            if (board.items.size > 1) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (item in board.items.take(3)) FilterChip(selected = item.id == board.selectedId, onClick = { agent.select(item.id) }, label = { Text(item.instruction.take(14) + if (item.instruction.length > 14) "…" else "", maxLines = 1) })
            }
            if (task != null) TaskView(ko, task, board.busy, agent)
        }
    }
}

@Composable private fun TaskView(ko: Boolean, task: AgentTask, busy: Boolean, agent: MobileAgent) {
    val label = agentStateText(ko, task.state)
    Column(Modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite; contentDescription = "$label. ${task.instruction.take(80)}" }, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(task.instruction, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        StatePill(task.state, label)
        if (task.state == AgentState.WORKING || task.state == AgentState.DECIDING) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (task.steps.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(text(ko, "진행 단계 ${task.steps.size}개", "${task.steps.size} steps"), style = MaterialTheme.typography.labelLarge)
            for (step in task.steps.takeLast(8)) Text("${if (step.kind == "call") "→" else if (step.kind == "result") "✓" else "•"} ${step.agent}: ${step.summary}", style = MaterialTheme.typography.bodySmall)
        }
        val approval = task.approval
        if (approval != null && task.state == AgentState.AWAITING_APPROVAL) {
            val open = task.decidable(System.currentTimeMillis())
            val minutes = ((Instant.parse(approval.expiresAt).toEpochMilli() - System.currentTimeMillis()) / 60000).coerceAtLeast(0) + 1
            Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.tertiaryContainer, RoundedCornerShape(16.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(text(ko, "당신의 결정이 필요합니다", "Your decision is needed"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onTertiaryContainer)
                Text(text(ko, "${approval.action.service}의 트래픽 100%를 ${approval.action.revision} 리비전으로 되돌립니다.", "Send 100% of ${approval.action.service} traffic back to revision ${approval.action.revision}."), color = MaterialTheme.colorScheme.onTertiaryContainer)
                Text(approval.reason, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onTertiaryContainer)
                Text(if (open) text(ko, "위험도 ${approval.risk}. 되돌릴 수 있고 리비전을 삭제하지 않습니다. ${minutes}분 안에 결정하세요.", "Risk ${approval.risk}. Reversible; nothing is deleted. Decide within $minutes min.")
                     else text(ko, "승인 기한이 지났습니다. 새로 지시하세요.", "The approval window has passed. Ask again."), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onTertiaryContainer)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { agent.decide(task.id, true) }, enabled = open && !busy, modifier = Modifier.weight(1f)) { Text(text(ko, "승인하고 실행", "Approve and apply")) }
                    OutlinedButton(onClick = { agent.decide(task.id, false) }, enabled = open && !busy, modifier = Modifier.weight(1f)) { Text(text(ko, "거절", "Reject")) }
                }
            }
        }
        task.note?.let { Notice(text(ko, "참고", "Note"), it) }
        task.result?.let { Report(it) }
    }
}

@Composable private fun StatePill(state: AgentState, label: String) {
    val colors = MaterialTheme.colorScheme
    val (container, content) = when (state) {
        AgentState.AWAITING_APPROVAL -> colors.tertiaryContainer to colors.onTertiaryContainer
        AgentState.COMPLETED -> colors.primaryContainer to colors.onPrimaryContainer
        AgentState.FAILED, AgentState.UNKNOWN -> colors.errorContainer to colors.onErrorContainer
        else -> colors.secondaryContainer to colors.onSecondaryContainer
    }
    Text(label, color = content, style = MaterialTheme.typography.labelLarge, modifier = Modifier.background(container, RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 6.dp))
}

/** The crew writes a small markdown subset: ### headings, bullets and **bold**. Anything else shows as plain text. */
@Composable private fun Report(markdown: String) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(16.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (line in markdown.lines()) {
            val trimmed = line.trim()
            when {
                trimmed.isEmpty() -> Spacer(Modifier.height(2.dp))
                trimmed.startsWith("#") -> Text(trimmed.trimStart('#').trim(), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp).semantics { heading() })
                trimmed.startsWith("- ") || trimmed.startsWith("* ") -> Text(inline("• " + trimmed.drop(2)), style = MaterialTheme.typography.bodyMedium)
                else -> Text(inline(trimmed), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
private fun inline(value: String) = buildAnnotatedString {
    var bold = false
    for ((index, part) in value.replace("`", "").split("**").withIndex()) { if (index > 0) bold = !bold; withStyle(SpanStyle(fontWeight = if (bold) FontWeight.Bold else null)) { append(part) } }
}

private fun agentStateText(ko: Boolean, state: AgentState) = when (state) {
    AgentState.WORKING -> text(ko, "진행 중", "Working"); AgentState.AWAITING_APPROVAL -> text(ko, "승인 대기", "Waiting for your decision")
    AgentState.DECIDING -> text(ko, "결정 처리 중", "Applying your decision"); AgentState.COMPLETED -> text(ko, "완료", "Done")
    AgentState.REJECTED -> text(ko, "거절됨", "Rejected"); AgentState.FAILED -> text(ko, "실패", "Failed")
    AgentState.UNKNOWN -> text(ko, "결과 미확인", "Outcome unknown")
}
private fun agentFailure(ko: Boolean, failure: Failure) = when (failure) {
    Failure.OFFLINE -> text(ko, "연결이 끊겼습니다. 자동으로 다시 보내지 않았습니다. 최신 상태를 확인하세요.", "Connection lost. Nothing was resent automatically. Check the latest state.")
    Failure.SIGN_IN -> text(ko, "다시 로그인해야 합니다.", "Sign in again to continue.")
    Failure.DENIED -> text(ko, "이 작업을 지시할 권한이 없습니다.", "You are not allowed to do this.")
    Failure.STALE -> text(ko, "승인 기한이 지났거나 이미 처리되었습니다.", "The approval expired or was already handled.")
    Failure.INVALID_RESPONSE -> text(ko, "서버 응답을 확인하지 못했습니다.", "The server response could not be verified.")
    Failure.UNAVAILABLE -> text(ko, "요청 결과를 확인하지 못했습니다. 최신 기록을 먼저 확인하세요.", "The request could not be confirmed. Read the latest record first.")
}
