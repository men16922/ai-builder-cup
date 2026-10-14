package app.mobileops.agent

import java.time.Instant

/** Synthetic crew for the rehearsal mode. Progress is driven by how often the task is read, so it needs no clock and no network.
 * It mirrors the server's task view: working steps, one approval for a traffic rollback, then a report or a rejection. */
class FixtureAgentApi(private val now: () -> Long = System::currentTimeMillis) : MobileAgentApi {
    private class Script(
        val id: String,
        val instruction: String,
        val language: String,
        val createdAt: Long,
        var reads: Int = 0,
        var decision: String? = null,
        var decidedReads: Int = 0
    )

    private val scripts = LinkedHashMap<String, Script>()
    private var counter = 0
    private fun iso(millis: Long) = Instant.ofEpochMilli(millis).toString()
    private fun stepsFor(script: Script, ko: Boolean): List<AgentStep> {
        val at = iso(script.createdAt)
        fun step(agent: String, kind: String, name: String, ko1: String, en1: String) =
            AgentStep(at, agent, kind, name, if (ko) ko1 else en1)

        val all = listOf(
            step(
                "chief",
                "note",
                "plan",
                "상태 점검과 원인 조사를 시작합니다.",
                "Starting a health check and root-cause search."
            ),
            step(
                "ops",
                "call",
                "ops",
                "shop-api 상태, 지표, 오류 로그를 읽습니다.",
                "Reading shop-api state, metrics and error logs."
            ),
            step(
                "ops",
                "result",
                "ops",
                "shop-api-bad가 트래픽 100%를 받고 5xx가 늘었습니다.",
                "shop-api-bad takes 100% of traffic and 5xx responses are rising."
            ),
            step(
                "diagnosis",
                "result",
                "diagnosis",
                "직전 리비전 shop-api-good은 정상이었고 새 리비전만 실패합니다.",
                "The previous revision shop-api-good was healthy; only the new one fails."
            ),
            step(
                "guardian",
                "result",
                "guardian",
                "트래픽 롤백은 허용되지만 사람의 승인이 필요합니다.",
                "A traffic rollback is allowed but needs a person's approval."
            )
        )
        return all.take(minOf(all.size, script.reads + 1))
    }

    private fun view(script: Script): AgentTask {
        script.reads++
        val ko = script.language == "ko"
        val steps = stepsFor(script, ko)
        val ready = steps.size >= 5
        val requested = script.createdAt
        val approval = AgentApproval(
            AgentAction("rollback_traffic", "shop-api", "shop-api-good"),
            "medium",
            if (ko) "새 리비전이 요청의 절반을 실패시킵니다. 직전 정상 리비전으로 되돌리면 복구됩니다." else "The new revision fails half of the requests. Going back to the last good revision restores service.",
            iso(requested),
            iso(requested + 8 * 60_000)
        )
        val base = AgentTask(
            script.id,
            AgentState.WORKING,
            script.instruction,
            script.language,
            iso(script.createdAt),
            iso(now()),
            steps
        )
        return when {
            script.decision == "reject" -> base.copy(
                state = AgentState.REJECTED,
                approval = approval,
                decision = AgentDecision("reject", iso(now()), true),
                note = if (ko) "거절했으므로 아무것도 변경하지 않았습니다." else "You rejected it, so nothing was changed."
            )

            script.decision == "approve" && script.decidedReads < 2 -> {
                script.decidedReads++; base.copy(
                    state = AgentState.DECIDING,
                    approval = approval,
                    decision = AgentDecision("approve", iso(now()), true)
                )
            }

            script.decision == "approve" -> base.copy(
                state = AgentState.COMPLETED,
                steps = steps + AgentStep(
                    iso(now()),
                    "ops",
                    "result",
                    "ops",
                    if (ko) "트래픽을 shop-api-good으로 되돌렸습니다." else "Traffic went back to shop-api-good."
                ),
                decision = AgentDecision("approve", iso(now()), true),
                result = if (ko) "### 무슨 일이 있었나\nshop-api의 새 리비전이 오류를 냈습니다.\n\n### 한 일\n승인에 따라 트래픽을 shop-api-good으로 되돌렸습니다.\n\n### 아직 모르는 것\n복구 직후라 오류율 지표는 아직 충분히 쌓이지 않았습니다. 몇 분 뒤 다시 확인하세요."
                else "### What happened\nThe new shop-api revision was failing.\n\n### What I did\nWith your approval I sent traffic back to shop-api-good.\n\n### Still unknown\nThe error-rate metric has not collected enough points since the change. Check again in a few minutes."
            )

            ready -> base.copy(state = AgentState.AWAITING_APPROVAL, approval = approval)
            else -> base
        }
    }

    override suspend fun agentTasks(): List<AgentTask> = scripts.values.reversed().map(::view)
    override suspend fun agentTask(id: String): AgentTask =
        view(scripts[id] ?: throw MobileFailure(Failure.DENIED))

    override suspend fun sendInstruction(
        instruction: String,
        language: String,
        key: String
    ): AgentTask {
        require(instruction.isNotBlank() && uuid(key))
        val id =
            java.util.UUID.nameUUIDFromBytes("fixture-agent-${++counter}".toByteArray()).toString()
                .let { it.substring(0, 14) + "4" + it.substring(15, 19) + "8" + it.substring(20) }
        val script = Script(id, instruction.trim(), language, now()); scripts[id] = script
        return view(script)
    }

    override suspend fun decideTask(id: String, approve: Boolean, key: String): AgentTask {
        val script = scripts[id] ?: throw MobileFailure(Failure.DENIED)
        val task = view(script)
        if (!task.decidable(now())) throw MobileFailure(Failure.STALE)
        script.decision = if (approve) "approve" else "reject"
        return view(script)
    }
}
