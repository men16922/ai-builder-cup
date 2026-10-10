"""Optional Cloud Trace export. Off unless OPS_TRACE_TO_CLOUD=1, so tests and local runs never send telemetry."""
from __future__ import annotations

import logging
import os

log = logging.getLogger("mobileops")


def setup_tracing() -> bool:
    if os.environ.get("OPS_TRACE_TO_CLOUD") != "1":
        return False
    try:
        from google.adk.telemetry.google_cloud import get_gcp_exporters
        from google.adk.telemetry.setup import maybe_set_otel_providers

        maybe_set_otel_providers([get_gcp_exporters(enable_cloud_tracing=True)])
        log.info("Cloud Trace export enabled")
        return True
    except Exception:  # Tracing must never stop an agent from serving.
        log.warning("Cloud Trace export could not be enabled")
        return False
