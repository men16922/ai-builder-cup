# apps/crew — the agents

Python, [Google ADK](https://google.github.io/adk-docs/) 2.11, [A2A](https://a2a-protocol.org), Gemini on Vertex AI. One image; the `AGENT` environment variable selects the role.

| `AGENT` | Role | Notable limits |
| --- | --- | --- |
| `chief` | Takes the instruction, delegates to the others over A2A, asks the person for decisions (tool confirmation → A2A `input-required`) | Has no Google API permission of its own except Gemini |
| `ops` | Reads Cloud Run, Monitoring and Logging through typed read-only tools; `POST /execute` applies an approved traffic rollback | The only mutation path; re-checks policy and the signature; mutation right on one service |
| `diagnosis` | Evidence → ranked hypotheses and what it cannot see | Read-only |
| `guardian` | Explains the policy verdict | The verdict itself comes from a deterministic table (`policy.py`), not the model |

```
src/mobileops_agents/
  agents/       chief.py ops.py diagnosis.py guardian.py   (instructions and wiring)
  policy.py     the allow / require_human / refuse table
  approval.py   HMAC over the exact action; executor.py applies it
  tools.py      the typed tools; gcp/ the Google API clients (Cloud Run, Monitoring, Logging)
  serve.py      A2A servers and the /execute route; service_auth.py ID-token checks; tracing.py Cloud Trace
tests/          unit and HTTP attack tests (no network)
evals/          six scenarios run against the real crew; results/ keeps every round; report.py writes docs/EVALUATION.md
```

Configuration is explicit environment variables only (`config.py`): `GOOGLE_CLOUD_PROJECT`, `OPS_SERVICES` (the registered services), `OPS_MODEL`, the peers' agent-card URLs (`OPS_AGENT_URL`, `DIAGNOSIS_AGENT_URL`, `GUARDIAN_AGENT_URL`), `OPS_APPROVAL_KEY` (Secret Manager), `OPS_TRACE_TO_CLOUD=1`.

```sh
make check-agents      # from the repository root; uses .tools/venv-agents
cd apps/crew && python -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/python -m pytest
```

Run locally against Vertex with your own Application Default Credentials: `GOOGLE_GENAI_USE_VERTEXAI=1 GOOGLE_CLOUD_PROJECT=<p> GOOGLE_CLOUD_LOCATION=global GOOGLE_CLOUD_QUOTA_PROJECT=<p>`.
