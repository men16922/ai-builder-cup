package app.mobileops.agent.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.mobileops.agent.*
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Displays the original plan observation. It is never relabelled as a later execution result. */
@Composable
fun EvidencePanel(ko: Boolean, evidence: OriginalEvidence) {
    val locale = if (ko) Locale.KOREAN else Locale.US
    val numbers = remember(locale) {
        NumberFormat.getNumberInstance(locale)
            .apply { maximumFractionDigits = 1; roundingMode = RoundingMode.HALF_UP }
    }

    fun number(value: Number?) = value?.let { numbers.format(it) } ?: "—"
    fun readiness(value: String?) = when (value) {
        "succeeded" -> text(ko, "준비 완료", "Ready")
        "failed" -> text(ko, "준비 실패", "Readiness failed")
        "pending" -> text(ko, "대기 중", "Pending")
        "reconciling" -> text(ko, "배포 반영 중", "Reconciling")
        else -> text(ko, "미확인", "Unknown")
    }

    var detailsOpen by remember(evidence.id) { mutableStateOf(false) }
    var allTraffic by remember(evidence.id) { mutableStateOf(false) }
    var allLogs by remember(evidence.id) { mutableStateOf(false) }
    Title(text(ko, "계획의 원본 근거", "Original plan evidence"))
    Text(evidenceTime(evidence.observedAt), style = MaterialTheme.typography.labelSmall)
    Notice(
        text(ko, "서비스 상태 · 미확인", "Application health · Unknown"), text(
            ko,
            "배포 준비 상태와 서비스 정상 여부는 다릅니다. 아래는 계획 준비 당시의 관측이며 이후 실행 결과가 아닙니다.",
            "Deployment readiness does not establish application health. These observations prepared the plan; they are not the later execution result."
        )
    )
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Metric(
            Modifier.weight(1f),
            text(ko, "서비스 배포 준비", "Service readiness"),
            readiness(evidence.service?.readiness)
        )
        Metric(
            Modifier.weight(1f),
            text(ko, "지정 revision 준비", "Pinned revision readiness"),
            readiness(evidence.revision?.readiness)
        )
    }
    Text(
        text(ko, "조회 전후 비교: ", "Before / after comparison: ") + when (evidence.consistency) {
            "stable" -> text(ko, "변경 없음", "No change observed")
            "changed" -> text(ko, "조회 중 변경", "Changed during collection")
            else -> text(ko, "재확인 미완료", "Recheck incomplete")
        }, fontWeight = FontWeight.SemiBold
    )
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Title(text(ko, "관측된 트래픽 배분", "Observed traffic allocation"))
            if (evidence.service?.traffic.isNullOrEmpty()) Text(
                text(
                    ko,
                    "배분을 확인하지 못했습니다. 트래픽 0%라는 뜻은 아닙니다.",
                    "Allocation is unavailable. This does not mean zero traffic."
                )
            )
            else (if (allTraffic) evidence.service!!.traffic!! else evidence.service!!.traffic!!.take(
                5
            )).forEach { row ->
                Text(
                    row.revision ?: text(ko, "revision 미확인", "Unknown revision"),
                    style = MaterialTheme.typography.bodySmall
                )
                Text(row.percent?.let { "$it%" } ?: "—", fontWeight = FontWeight.Bold)
                row.percent?.let { EvidenceBar(it / 100f) }
            }
            if ((evidence.service?.traffic?.size ?: 0) > 5) TextButton(onClick = {
                allTraffic = !allTraffic
            }) {
                Text(
                    if (allTraffic) text(ko, "트래픽 배분 접기", "Show fewer allocations") else text(
                        ko,
                        "배분 ${evidence.service!!.traffic!!.size}개 모두 보기",
                        "Show all ${evidence.service!!.traffic!!.size} allocations"
                    )
                )
            }
            Text(
                text(
                    ko,
                    "라우팅 설정이며 요청 수나 오류율이 아닙니다.",
                    "Routing configuration, not request volume or error rate."
                ), style = MaterialTheme.typography.bodySmall
            )
        }
    }
    val telemetry = evidence.telemetry
    if (telemetry == null) Notice(
        text(ko, "로그·지표 미수집", "Logs and metrics not collected"), text(
            ko,
            "이 계획의 원본 근거에는 서비스와 revision 메타데이터만 있습니다.",
            "This plan was prepared from service and revision metadata only."
        )
    )
    else {
        val summary = telemetry.summary()
        Title(text(ko, "로그·요청 지표", "Logs and request metrics"))
        Text(
            evidenceTime(telemetry.window.start) + " — " + evidenceTime(telemetry.window.end),
            style = MaterialTheme.typography.labelSmall
        )
        Text(
            text(
                ko,
                "지정 revision · 최근 2분을 제외한 15분 · 한 페이지",
                "Pinned revision · 15 minutes ending two minutes before collection · one page"
            ), style = MaterialTheme.typography.bodySmall
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Metric(
                Modifier.weight(1f),
                text(ko, "반환된 요청 수", "Returned request count"),
                number(summary.total)
            )
            Metric(
                Modifier.weight(1f),
                text(ko, "반환된 5xx 요청 수", "Returned 5xx count"),
                number(summary.errorCount)
            )
        }
        Text(
            sourceStatus(ko, telemetry.requests.status),
            style = MaterialTheme.typography.bodySmall
        )
        Metric(
            Modifier.fillMaxWidth(),
            text(ko, "분·응답 코드별 p95 최댓값", "Highest per-minute, per-code p95"),
            summary.highestP95Ms?.let { number(it) + " ms" } ?: "—")
        Text(sourceStatus(ko, telemetry.latency.status), style = MaterialTheme.typography.bodySmall)
        if (summary.counts.isNotEmpty()) Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Title(text(ko, "응답 코드별 반환된 요청 수", "Returned requests by response code"))
                summary.counts.forEach { row ->
                    Text(
                        "HTTP ${row.code} · ${number(row.count)}",
                        fontWeight = FontWeight.SemiBold
                    )
                    EvidenceBar(
                        if ((summary.total
                                ?: 0) > 0
                        ) row.count.toFloat() / summary.total!!.toFloat() else 0f
                    )
                }
            }
        }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Title(text(ko, "최근 로그 표본", "Recent log samples"))
                Text(sourceStatus(ko, telemetry.logs.status))
                if (telemetry.logs.truncated == true) Text(
                    text(
                        ko,
                        "다음 페이지 있음 · 부분 결과",
                        "More pages exist · partial results"
                    ), style = MaterialTheme.typography.bodySmall
                )
                val visible = if (allLogs) summary.logs else summary.logs.take(5)
                visible.forEach { sample ->
                    HorizontalDivider()
                    Text(
                        evidenceTime(sample.timestamp),
                        style = MaterialTheme.typography.labelSmall
                    )
                    Text("${sample.severity} · ${sample.stream}", fontWeight = FontWeight.SemiBold)
                    Text("HTTP ${sample.responseCode ?: "—"} · " + (sample.latencyMs?.let {
                        number(
                            it
                        ) + " ms"
                    } ?: "—"))
                }
                if (summary.logs.size > 5) TextButton(onClick = { allLogs = !allLogs }) {
                    Text(
                        if (allLogs) text(ko, "로그 표본 접기", "Show fewer log samples") else text(
                            ko,
                            "표본 ${summary.logs.size}개 모두 보기",
                            "Show all ${summary.logs.size} samples"
                        )
                    )
                }
            }
        }
        Notice(
            text(ko, "표본의 한계", "Sample limits"), text(
                ko,
                "전체 요청 수·오류율·시간창 전체의 p95가 아닙니다. 없는 표본은 0으로 채우지 않습니다. 로그 본문·URL·IP는 포함하지 않으며 원인이나 서비스 정상을 확정하지 않습니다.",
                "These are not complete request totals, error rates or an interval-wide p95. Missing samples are not zero. Log payloads, URLs and IPs are excluded. These samples do not establish cause or health."
            )
        )
    }
    OutlinedButton(onClick = { detailsOpen = !detailsOpen }, modifier = Modifier.fillMaxWidth()) {
        Text(
            if (detailsOpen) text(
                ko,
                "배포 세부·출처 접기",
                "Hide deployment details and sources"
            ) else text(ko, "배포 세부·출처 보기", "Show deployment details and sources")
        )
    }
    if (detailsOpen) Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Title(text(ko, "배포 세부 근거", "Deployment details"))
            val service = evidence.service
            Text(
                text(
                    ko,
                    "최근 생성 revision: ",
                    "Latest created revision: "
                ) + (service?.latestCreatedRevision ?: "—")
            )
            Text(
                text(
                    ko,
                    "최근 준비 revision: ",
                    "Latest ready revision: "
                ) + (service?.latestReadyRevision ?: "—")
            )
            Text(
                text(
                    ko,
                    "요청 / 관측 generation: ",
                    "Requested / observed generation: "
                ) + (service?.generation ?: "—") + " / " + (service?.observedGeneration ?: "—")
            )
            Text(
                text(ko, "배포 반영 중: ", "Reconciling: ") + when (service?.reconciling) {
                    true -> text(ko, "예", "Yes"); false -> text(ko, "아니요", "No"); null -> text(
                        ko,
                        "미확인",
                        "Unknown"
                    )
                }
            )
            evidence.facts.forEach { fact ->
                HorizontalDivider()
                Text(
                    sourceName(ko, fact.id) + " · " + sourceStatus(ko, fact.status),
                    fontWeight = FontWeight.SemiBold
                )
                Text(evidenceTime(fact.observedAt), style = MaterialTheme.typography.labelSmall)
                Text(fact.source, style = MaterialTheme.typography.bodySmall)
                fact.code?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                if (fact.truncated == true) Text(
                    text(
                        ko,
                        "다음 페이지 있음 · 부분 결과",
                        "More pages exist · partial results"
                    )
                )
                if (fact.missingFields.isNotEmpty()) Text(
                    text(
                        ko,
                        "누락/확인 필요: ",
                        "Missing / needs review: "
                    ) + fact.missingFields.joinToString(", ")
                )
            }
        }
    }
}

@Composable
private fun EvidenceBar(fraction: Float) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(8.dp)
            .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(4.dp))
            .clearAndSetSemantics { }) {
        Box(
            Modifier
                .fillMaxHeight()
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(4.dp))
        )
    }
}

private fun evidenceTime(value: String) =
    DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'", Locale.ROOT).withZone(ZoneOffset.UTC)
        .format(Instant.parse(value))

private fun sourceName(ko: Boolean, id: String) = when (id) {
    "service" -> text(ko, "서비스 조회", "Service read"); "revision" -> text(
        ko,
        "지정 revision 조회",
        "Pinned revision read"
    )

    "recheck" -> text(ko, "서비스 재조회", "Service recheck"); "logs" -> text(ko, "로그", "Logs")
    "requests" -> text(ko, "요청 수", "Requests"); "latency" -> text(
        ko,
        "응답 지연",
        "Latency"
    ); else -> id
}

private fun sourceStatus(ko: Boolean, status: String) = when (status) {
    "collected" -> text(ko, "수집됨", "Collected"); "no_data" -> text(
        ko,
        "표본 없음 · 0 아님",
        "No samples · not zero"
    )

    "denied" -> text(ko, "권한 거절", "Access denied"); "missing" -> text(ko, "대상 미확인", "Not found")
    "skipped" -> text(ko, "대상 미확인 · 조회 생략", "Target unverified · not queried"); else -> text(
        ko,
        "수집 미완료",
        "Collection unavailable"
    )
}
