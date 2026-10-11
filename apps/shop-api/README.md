# Demo target

`shop-api` is a minimal storefront API that the agent crew inspects. Revision `v1` is healthy. Revision `v2` returns HTTP 500 for half of the requests and answers slowly (`FAIL_RATE`, `SLOW_MS`), which reproduces a bad release. `traffic.sh` sends light, bounded traffic so that logs and metrics exist.
