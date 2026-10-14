"""Runtime configuration. Everything comes from explicit environment variables; nothing is discovered."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class RegisteredService:
    """A Cloud Run service the crew may inspect. Agents pass only `name`; project and region are never model input."""

    name: str
    project: str
    region: str

    @property
    def resource(self) -> str:
        return f"projects/{self.project}/locations/{self.region}/services/{self.name}"


@dataclass(frozen=True)
class Settings:
    project: str
    model: str = "gemini-3.8-flash"
    reasoning_model: str = "gemini-3.8-flash"
    services: tuple[RegisteredService, ...] = ()
    # Peer agents reached over A2A (agent-card URLs). Empty entries mean the peer runs in-process (tests).
    ops_url: str = ""
    diagnosis_url: str = ""
    guardian_url: str = ""
    # HMAC key shared only by the gateway (which signs approvals) and the ops agent (which verifies them).
    approval_key: bytes = field(default=b"", repr=False)
    approval_ttl_seconds: int = 300
    # Fixed gateway broker. Empty means real execution is disabled; reads still work.
    gateway_origin: str = ""

    def service(self, name: str) -> RegisteredService:
        for item in self.services:
            if item.name == name:
                return item
        raise KeyError(f"'{name}' is not a registered service")


def model_config():
    """Retry model calls that fail with a transient quota or availability error. Model calls only read; changes are never retried."""
    from google.genai import types

    return types.GenerateContentConfig(http_options=types.HttpOptions(retry_options=types.HttpRetryOptions(attempts=6, initial_delay=2.0, max_delay=30.0, exp_base=2.0, jitter=1.0, http_status_codes=[429, 500, 503])))


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ if env is None else env)
    project = env.get("GOOGLE_CLOUD_PROJECT", "")
    raw = json.loads(env.get("OPS_SERVICES", "[]"))
    services = tuple(RegisteredService(name=i["name"], project=i.get("project", project), region=i["region"]) for i in raw)
    key = env.get("OPS_APPROVAL_KEY", "")
    return Settings(
        project=project,
        model=env.get("OPS_MODEL", "gemini-3.8-flash"),
        reasoning_model=env.get("OPS_REASONING_MODEL", env.get("OPS_MODEL", "gemini-3.8-flash")),
        services=services,
        ops_url=env.get("OPS_AGENT_URL", ""),
        diagnosis_url=env.get("DIAGNOSIS_AGENT_URL", ""),
        guardian_url=env.get("GUARDIAN_AGENT_URL", ""),
        approval_key=key.encode() if key else b"",
        approval_ttl_seconds=int(env.get("OPS_APPROVAL_TTL_SECONDS", "300")),
        gateway_origin=env.get("OPS_GATEWAY_ORIGIN", ""),
    )
