#!/usr/bin/env bash
# Puts the demo storefront back into its "bad release" state: 100% of traffic on the faulty revision v2.
# Usage: demo/reset.sh <project> [region=asia-northeast3]
set -euo pipefail
project="${1:?project id}"; region="${2:-asia-northeast3}"
gcloud run services update-traffic shop-api --project "$project" --region "$region" --to-revisions shop-api-bad=100 --quiet
