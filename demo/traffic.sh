#!/usr/bin/env bash
# Sends a small, bounded burst of requests so that Cloud Logging and Cloud Monitoring have data to read.
# Usage: demo/traffic.sh https://<service-url> [requests=120] [delay-seconds=0.25]
set -euo pipefail
url="${1:?service url}"; count="${2:-120}"; delay="${3:-0.25}"
case "$url" in https://*) ;; *) echo "https url required" >&2; exit 2;; esac
[ "$count" -le 500 ] || { echo "limit is 500 requests" >&2; exit 2; }
ok=0; bad=0
for _ in $(seq 1 "$count"); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/checkout" || echo 000)
  if [ "$code" = "200" ]; then ok=$((ok + 1)); else bad=$((bad + 1)); fi
  sleep "$delay"
done
echo "ok=$ok failed=$bad"
