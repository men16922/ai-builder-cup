package app.mobileops.agent.app

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.mobileops.agent.*
import kotlinx.serialization.json.*

internal fun text(ko: Boolean, korean: String, english: String) = if (ko) korean else english

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun MobileOpsApp(model: MobileViewModel, onSignIn: (String) -> Unit, changeLanguage: (String) -> Unit) {
    val state by model.controller.state.collectAsStateWithLifecycle()
    val language by model.language.collectAsStateWithLifecycle()
    val disconnected by model.disconnected.collectAsStateWithLifecycle()
    val mode by model.mode.collectAsStateWithLifecycle()
    val liveState by model.liveState.collectAsStateWithLifecycle()
    val pendingNotification by model.notificationNavigation.available.collectAsStateWithLifecycle()
    val ko = language == "ko"
    BackHandler(enabled = state.scope != null) { if (state.selectedId != null) model.controller.back() else model.leave() }
    MaterialTheme(colorScheme = opsColorScheme(isSystemInDarkTheme())) {
        Scaffold(topBar = { TopAppBar(title = { Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { Image(painterResource(R.drawable.google_cloud), contentDescription = null, modifier = Modifier.size(32.dp)); Column { Text("Aide", fontWeight = FontWeight.Bold); Text("GOOGLE CLOUD · MOBILE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.tertiary) } } },
            actions = { TextButton(onClick = { changeLanguage(if (ko) "en" else "ko") }) { Text(if (ko) "English" else "한국어") } }) }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                if (pendingNotification && mode != "synthetic") Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Title(text(ko, "GCP 업무 알림", "GCP work notification"))
                    Text(text(ko, "해당 업무의 공간으로 로그인한 뒤 최신 기록을 여세요. 알림은 검토나 실행을 시작하지 않습니다.", "Sign in to the task’s workspace and open its latest record. A notification does not review or execute work."))
                    Button(onClick = { model.openNotification() }, enabled = mode == "server" && state.scope != null && !state.busy) { Text(text(ko, "최신 업무 열기", "Open latest task")) }
                    TextButton(onClick = { model.notificationNavigation.clear() }) { Text(text(ko, "알림 닫기", "Dismiss notification")) }
                } }
                if (state.scope == null) {
                    Text(text(ko, "운영의 다음 판단을,\n어디에서나.", "Your next decision.\nWherever you are."), style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                    Text(text(ko, "GCP 계획과 근거를 확인하고, 명시적으로 조회한 결과를 팀에 이어 주세요.", "Review GCP evidence, explicitly run a fixed read, and hand the results to your team."))
                    ConfiguredAccess(ko, model, onSignIn)
                    Notice(text(ko, "합성 시연", "Synthetic rehearsal"), text(ko, "실제 로그인·Google API·Gemini 호출은 없습니다. 예제 기록은 앱을 종료하면 초기화됩니다.", "No real sign-in, Google API or Gemini calls. Example records reset when the process ends."))
                    for (edition in listOf("personal", "organization")) Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Title(if (edition == "personal") text(ko, "개인 운영 공간", "Personal workspace") else text(ko, "조직 운영 공간", "Organization workspace"))
                            Text(if (edition == "personal") text(ko, "내 GCP 계획과 결과", "Your GCP plans and results") else text(ko, "팀의 검토와 인계", "Team review and handoff"))
                            Button(onClick = { model.connect(edition) }, modifier = Modifier.fillMaxWidth()) { Text(if (edition == "personal") text(ko, "개인 시연 시작", "Start personal rehearsal") else text(ko, "조직 시연 시작", "Start organization rehearsal")) }
                        }
                    }
                    Text(text(ko, "AWS·On-Prem 운영은 웹에서 사용합니다.", "AWS and On-Prem operations remain on the web."), style = MaterialTheme.typography.bodySmall)
                } else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(if (mode == "server") (liveState.workspace?.label ?: text(ko, "서버 연결", "Server connection")) else if (state.scope!!.owner.kind == "personal") text(ko, "개인용 · 합성", "Personal · Synthetic") else text(ko, "조직용 · 합성", "Organization · Synthetic"), modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.tertiary, fontWeight = FontWeight.Bold)
                        TextButton(onClick = { model.leave() }) { Text(if (mode == "server") text(ko, "로그아웃", "Sign out") else text(ko, "공간 나가기", "Leave workspace")) }
                    }
                    if (mode == "synthetic") {
                        Notice(text(ko, "예제 시각 · 2026-10-10 01:00 UTC", "Example clock · 2026-10-10 01:00 UTC"), text(ko, "아래 판단·조회·인계는 이 앱의 메모리에서만 연습합니다.", "Review, read and handoff below are rehearsed in this app’s memory only."))
                        AgentScreen(ko, model.agent, model.language.collectAsStateWithLifecycle().value)
                        TextButton(onClick = { model.toggleNetwork() }, enabled = !state.busy) { Text(if (disconnected) text(ko, "연결 복구 연습", "Restore demo connection") else text(ko, "오프라인 전환 연습", "Simulate offline")) }
                    } else {
                        Notice(text(ko, "GCP 서버 기록", "GCP server records"), text(ko, "권한과 작업 범위는 서버에서 확인합니다. 검토와 결과 재조회는 새 실행을 시작하지 않습니다.", "The server verifies access and scope. Review and result refresh do not start a new execution."))
                        AgentScreen(ko, model.agent, model.language.collectAsStateWithLifecycle().value)
                        NotificationControls(ko, model)
                        if (liveState.cleanupUnknown) NotificationCleanupNotice(ko)
                    }
                    if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    state.failure?.let { failure -> Notice(text(ko, "최신 기록 확인 필요", "Refresh required"), failureText(ko, failure)) }
                    if (state.uncertain) {
                        Notice(text(ko, "전송 결과 미확인", "Request outcome unknown"), text(ko, "새 요청을 만들지 않습니다. 최신 기록을 확인한 후 같은 요청으로만 재확인하세요.", "Do not start a new request. Read the latest record, then explicitly retry the exact same request."))
                        OutlinedButton(onClick = { model.launch { recover() } }, enabled = !state.busy) { Text(text(ko, "최신 서버 기록 확인", "Read latest server record")) }
                        if (state.detail != null && state.failure == null) OutlinedButton(onClick = { model.launch { retrySameRequest() } }, enabled = !state.busy) { Text(text(ko, "동일 요청으로 재확인", "Retry identical request")) }
                    }
                    if (state.selectedId == null) InboxScreen(ko, state, model) else {
                        TextButton(onClick = { model.controller.back(); model.launch { refresh() } }, enabled = !state.busy) { Text(text(ko, "← 받은 작업", "← Inbox")) }
                        state.detail?.let { DetailScreen(ko, state, model) }
                        OutlinedButton(onClick = { model.launch { open(state.selectedId!!) } }, enabled = !state.busy) { Text(text(ko, "최신 상세 조회", "Refresh details")) }
                    }
                }
            }
        }
    }
}

@Composable private fun ConfiguredAccess(ko: Boolean, model: MobileViewModel, onSignIn: (String) -> Unit) {
    val config by model.configuration.collectAsStateWithLifecycle()
    val invalid by model.configurationInvalid.collectAsStateWithLifecycle()
    val state by model.liveState.collectAsStateWithLifecycle()
    if (state.cleanupUnknown) NotificationCleanupNotice(ko)
    if (invalid) Notice(text(ko, "연결 설정 확인 필요", "Configuration needs attention"), text(ko, "앱에 포함된 서버·인증 설정이 올바르지 않습니다. 관리자가 설정을 확인해야 합니다.", "The packaged server or identity configuration is invalid. Ask the administrator to check it."))
    else if (config == null) Text(text(ko, "실제 환경 미설정 · 아래 합성 시연을 사용할 수 있습니다.", "Live access is not configured. You can use the synthetic rehearsal below."), style = MaterialTheme.typography.bodySmall)
    else Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Title(text(ko, "내 GCP 환경 연결", "Connect your GCP workspace"))
        Text(config!!.origin, style = MaterialTheme.typography.bodySmall)
        Text(text(ko, "Google 계정으로 로그인한 뒤 서버가 허용한 작업만 표시합니다.", "Sign in with Google to view work allowed by the server."))
        state.failure?.let { Text(failureText(ko, it), color = MaterialTheme.colorScheme.error) }
        if (state.busy) { LinearProgressIndicator(Modifier.fillMaxWidth()); TextButton(onClick = { model.leave() }) { Text(text(ko, "로그인 취소", "Cancel sign-in")) } }
        config!!.workspaces.forEach { workspace -> Button(onClick = { onSignIn(workspace.key) }, enabled = !state.busy, modifier = Modifier.fillMaxWidth()) {
            Text(workspace.label + " · " + text(ko, "Google로 로그인", "Sign in with Google"))
        } }
    } }
}

@Composable private fun NotificationCleanupNotice(ko: Boolean) = Notice(text(ko, "알림 해제 확인 필요", "Notification cleanup unconfirmed"), text(ko, "앱의 이전 연결은 해제했습니다. 서버의 단말 해제는 확인하지 못했으며 등록 기한과 현재 권한 검사가 계속 적용됩니다.", "The previous app connection is cleared. Server retirement was not confirmed; registration expiry and current access checks still apply."))

@Composable private fun NotificationControls(ko: Boolean, model: MobileViewModel) {
    val state by model.notifications.state.collectAsStateWithLifecycle()
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Title(text(ko, "이 기기의 업무 알림", "Work notifications on this device"))
        if (!state.supported) Text(text(ko, "이 빌드에는 알림 수신 연결이 없습니다. 받은 작업을 새로고침해 계속할 수 있습니다.", "Push reception is not connected in this build. Refresh your inbox to continue."))
        else {
            Text(if (state.enabled) text(ko, "단말 등록을 확인했습니다. 메시지의 실제 도착을 보장하지 않습니다.", "Device registration confirmed. Message arrival is not guaranteed.") else text(ko, "명시적으로 켜면 현재 공간의 GCP 업무 알림에 등록합니다.", "Enable to register for GCP work notifications in the current workspace."))
            if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (state.uncertain) Text(text(ko, "등록 결과 미확인 · 새 등록 대신 같은 요청으로 재확인합니다.", "Registration outcome unknown. Recheck the same request."))
            state.failure?.let { Text(failureText(ko, it), color = MaterialTheme.colorScheme.error) }
            Button(onClick = { model.enableNotifications() }, enabled = !state.busy) {
                Text(if (state.uncertain) text(ko, "동일 등록 재확인", "Recheck registration") else if (state.enabled) text(ko, "알림 등록 갱신", "Refresh registration") else text(ko, "업무 알림 켜기", "Enable work notifications"))
            }
            if (state.enabled || state.uncertain || state.busy || state.failure != null) OutlinedButton(onClick = { model.disableNotifications() }) { Text(text(ko, "알림 끄기", "Disable notifications")) }
        }
        if (state.cleanupUnknown) Text(text(ko, "로컬 연결은 해제했지만 서버 해제를 확인하지 못했습니다.", "Local connection cleared; server retirement is unconfirmed."), color = MaterialTheme.colorScheme.error)
    } }
}

@Composable private fun InboxScreen(ko: Boolean, state: MobileState, model: MobileViewModel) {
    Title(text(ko, "받은 작업", "Inbox"))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for (filter in listOf("pending", "results", "all")) FilterChip(selected = state.filter == filter,
            onClick = { model.launch { refresh(filter) } }, enabled = !state.busy,
            label = { Text(when(filter) { "pending" -> text(ko, "검토 대기", "Pending"); "results" -> text(ko, "결과", "Results"); else -> text(ko, "전체", "All") }) })
    }
    Text(text(ko, "최근 50개 계획 범위 · 한 페이지 최대 20개", "Latest 50 plans · up to 20 per page"), style = MaterialTheme.typography.bodySmall)
    state.inbox?.let { inbox ->
        Text(text(ko, "서버 시각: ", "Server time: ") + inbox.serverTime, style = MaterialTheme.typography.labelSmall)
        if (inbox.items.isEmpty()) Text(text(ko, "이 범위에 표시할 작업이 없습니다.", "No work in this range."))
        inbox.items.forEach { item -> Card(onClick = { model.launch { open(item.id) } }, modifier = Modifier.fillMaxWidth(), enabled = !state.busy) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(item.binding.target.resourceName.substringAfterLast('/'), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Text(scenarioText(ko, item.label), color = MaterialTheme.colorScheme.tertiary)
                Text(if (item.dataMode == "synthetic") text(ko, "합성 데이터", "Synthetic data") else text(ko, "실제 수집 기록", "Live collection record"), style = MaterialTheme.typography.labelSmall)
                Text(item.binding.target.projectId + " · " + item.binding.target.location, style = MaterialTheme.typography.bodySmall)
                Text(stateText(ko, item.executionState ?: item.reviewStatus), fontWeight = FontWeight.SemiBold)
                Text(text(ko, "근거 ", "Evidence ") + item.evidenceObservedAt, style = MaterialTheme.typography.labelSmall)
                if (item.expired) Text(text(ko, "계획 만료 · 실행 불가", "Expired · execution unavailable"), color = MaterialTheme.colorScheme.error)
            }
        } }
        if (inbox.nextCursor != null) OutlinedButton(onClick = { model.launch { refresh(more = true) } }, enabled = !state.busy) { Text(text(ko, "다음 페이지", "Next page")) }
    }
    OutlinedButton(onClick = { model.launch { refresh() } }, enabled = !state.busy) { Text(text(ko, "목록 새로고침", "Refresh inbox")) }
}

@Composable private fun DetailScreen(ko: Boolean, state: MobileState, model: MobileViewModel) {
    val view = state.detail!!; val plan = view.plan.payload
    var note by remember(plan.planId, state.scope) { mutableStateOf("") }
    Title(plan.target.resourceName.substringAfterLast('/'))
    Text(if (plan.dataMode == "synthetic") text(ko, "합성 데이터", "Synthetic data") else text(ko, "실제 수집 기록", "Live collection record"), color = MaterialTheme.colorScheme.tertiary)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Metric(Modifier.weight(1f), text(ko, "검토", "Review"), stateText(ko, view.plan.review.status))
        Metric(Modifier.weight(1f), text(ko, "실행", "Execution"), stateText(ko, view.execution?.state ?: "not_started"))
    }
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Title(text(ko, "01 · 대상과 근거", "01 · Target and evidence"))
        Text(plan.target.projectId + " / " + plan.target.location)
        Text(text(ko, "리비전: ", "Revision: ") + plan.target.revision)
        Text("UID: " + plan.target.resourceUid, style = MaterialTheme.typography.bodySmall)
        Text(text(ko, "관측: ", "Observed: ") + plan.evidence.observedAt, style = MaterialTheme.typography.bodySmall)
        Text(text(ko, "만료: ", "Expires: ") + plan.expiresAt, style = MaterialTheme.typography.bodySmall)
        Text(if (plan.action.id == "gcp.cloudrun.inspect.v1") text(ko, "고정 읽기 · 15분 · 로그 최대 50건", "Fixed read · 15 min · up to 50 logs") else text(ko, "고정 읽기 · 서비스·리비전 메타데이터", "Fixed read · service and revision metadata"), fontWeight = FontWeight.Bold)
        plan.action.completionCriteria.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
    } }
    state.original?.let { EvidencePanel(ko, it) }
    Notice(text(ko, "02 · 근거 해석", "02 · Evidence interpretation"), plan.analysis.summary)
    Text(text(ko, "부족한 정보", "Missing information"), fontWeight = FontWeight.Bold)
    plan.analysis.missingInformation.forEach { Text("• $it") }
    if (view.execution == null) {
        Row(Modifier.fillMaxWidth()) { Checkbox(checked = state.reviewed, onCheckedChange = { model.controller.reviewed(it) }, enabled = !state.busy && !state.uncertain)
            Text(text(ko, "대상·근거·기한을 확인했습니다. 검토는 실행을 시작하지 않습니다.", "I checked the target, evidence and expiry. Review does not start execution."), Modifier.padding(top = 12.dp)) }
        OutlinedTextField(value = note, onValueChange = { if (it.length <= 2000) note = it }, label = { Text(text(ko, "검토 메모", "Review note")) }, modifier = Modifier.fillMaxWidth(), enabled = !state.busy)
        if (view.capabilities.requestReview) ActionButton(ko, model, Operation.REVIEW, "검토 요청", "Request review", note)
        if (view.capabilities.decide) {
            ActionButton(ko, model, Operation.APPROVE, "검토 확인", "Confirm review", note)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = { model.launch { perform(Operation.REJECT, note) } }, enabled = model.controller.can(Operation.REJECT)) { Text(text(ko, "거절", "Reject")) }
                TextButton(onClick = { model.launch { perform(Operation.CHANGES, note) } }, enabled = model.controller.can(Operation.CHANGES)) { Text(text(ko, "수정 요청", "Request changes")) }
            }
        }
        if (view.capabilities.execute) ActionButton(ko, model, Operation.EXECUTE, "고정 읽기 명시적 실행", "Run fixed read explicitly", note)
    }
    view.execution?.let { execution ->
        Title(text(ko, "03 · 실행 결과", "03 · Execution result"))
        Notice(stateText(ko, execution.state), text(ko, "조회 완료와 서비스 정상 여부는 다릅니다. 서비스 상태: 미확인", "Query completion is separate from service health. Service health: unknown"))
        execution.result?.let { Text(text(ko, "근거 범위: ", "Evidence coverage: ") + stateText(ko, it.coverage)) }
        view.evidence?.let(::inspectionReceipt)?.outcomes?.forEach { outcome ->
            Text(outcome.id + " · " + stateText(ko, outcome.status))
        }
        if (view.capabilities.cancel) ActionButton(ko, model, Operation.CANCEL, "시작 전 중지", "Cancel before start", "")
        Title(text(ko, "04 · 인계", "04 · Handoff"))
        Text(text(ko, "메모는 실행 결과를 성공으로 바꾸지 않습니다.", "A handoff note does not change the execution outcome."), style = MaterialTheme.typography.bodySmall)
        if (view.capabilities.handoff) {
            OutlinedTextField(value = note, onValueChange = { if (it.length <= 2000) note = it }, label = { Text(text(ko, "다음 확인 사항", "Next checks")) }, modifier = Modifier.fillMaxWidth(), enabled = !state.busy)
            ActionButton(ko, model, Operation.HANDOFF, "인계 저장", "Save handoff", note)
        }
        execution.handoffs.forEach { Notice(it.at, it.note) }
    }
}
@Composable private fun ActionButton(ko: Boolean, model: MobileViewModel, operation: Operation, korean: String, english: String, note: String) {
    val state by model.controller.state.collectAsStateWithLifecycle()
    Button(onClick = { model.launch { perform(operation, note) } }, enabled = !state.busy && model.controller.can(operation) && (operation != Operation.HANDOFF || note.isNotBlank()), modifier = Modifier.fillMaxWidth()) { Text(text(ko, korean, english)) }
}
@Composable internal fun Title(value: String) { Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() }) }
@Composable internal fun Notice(title: String, body: String) { Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(16.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { Text(title, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSecondaryContainer); Text(body, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer) } }
@Composable internal fun Metric(modifier: Modifier, label: String, value: String) { Column(modifier.background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(12.dp)).padding(12.dp)) { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.tertiary); Text(value, fontWeight = FontWeight.Bold) } }
private fun scenarioText(ko: Boolean, label: String) = when(label) { "signals" -> text(ko, "오류 표본 시나리오", "Error sample scenario"); "empty" -> text(ko, "빈 표본 시나리오", "Empty sample scenario"); "denied" -> text(ko, "지연 지표 권한 거절", "Latency access denied"); else -> label }
private fun failureText(ko: Boolean, failure: Failure) = when(failure) {
    Failure.OFFLINE -> text(ko, "연결이 끊겼습니다. 기록을 숨겼으며 자동으로 제출하지 않습니다.", "Connection lost. Records are hidden and nothing is submitted automatically.")
    Failure.SIGN_IN -> text(ko, "다시 로그인해야 합니다.", "Sign in again to continue.")
    Failure.DENIED -> text(ko, "현재 사용자에게 이 기록의 접근 권한이 없습니다.", "The current user cannot access this record.")
    Failure.STALE -> text(ko, "기록이 변경되었거나 만료되었습니다.", "The record changed or expired.")
    Failure.INVALID_RESPONSE -> text(ko, "대상과 응답을 확인하지 못했습니다.", "The response does not match the expected target.")
    Failure.UNAVAILABLE -> text(ko, "요청을 확인하지 못했습니다. 최신 기록부터 조회하세요.", "The request could not be confirmed. Read the latest record first.")
}
private fun stateText(ko: Boolean, value: String) = if (!ko) value.replace('_', ' ') else when(value) {
    "not_requested" -> "미요청"; "pending" -> "대기"; "approved" -> "확인됨"; "rejected" -> "거절됨"; "changes_requested" -> "수정 요청"
    "not_started" -> "시작 전"; "queued" -> "실행 대기"; "running" -> "진행 중"; "succeeded" -> "조회 완료"; "failed" -> "실패"; "unknown" -> "미확인"; "cancelled" -> "중지"
    "collected" -> "수집됨"; "no_data" -> "일치 표본 없음"; "denied" -> "권한 거절"; "missing" -> "누락"; "unavailable" -> "조회 불가"; "skipped" -> "건너뜀"; "partial" -> "부분 근거"; "complete" -> "완전"; else -> value
}
