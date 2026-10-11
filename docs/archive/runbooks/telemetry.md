> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP의 제한된 로그·요청 지표 수집

갱신: 2026-10-10. 한 서비스·서버 지정 revision의 로그 표본과 요청 지표를 관측 API, 근거 저장, Gemini 입력과 한/영 화면에 연결했다. 실제 Logging/Monitoring 네트워크·IAM·과금 검증은 하지 않았다.

## 켜고 사용하는 방법

[GCP 서버 설정](server.md)에 `"telemetry": { "enabled": true }`를 추가한다. 생략하거나 false이면 기존 메타데이터 세 번 조회만 수행한다. 전체 GCP 기본값도 비활성이다. 지정 프로젝트/서비스/비용 범위 확정 전 실제 호출하지 않는다.

설정된 작업 공간에서 **GCP 웹 로그인 → 서비스 선택 → 메타데이터·로그·지표 조회**를 누른다. 한 요청은 서비스 → 지정 revision → 세 telemetry 조회 → 서비스 재조회 순서다. telemetry 세 요청은 같은 시간창으로 병렬 수행하며 전체 collector의 15초 제한을 공유한다. 수집 전후 웹 권한과 서비스 계정 신원을 검사한다. 같은 요청 키로 재시도하거나 저장 결과를 열어도 다시 수집하지 않는다.

결과의 요청 수·5xx 수·지연 카드, 응답 코드별 막대와 로그 표본은 반환된 데이터만 표시한다. **분석과 계획 준비**는 이 근거를 Gemini에 전달할 수 있다. 출처 `gcp-run-logs`, `gcp-run-requests`, `gcp-run-latency`를 누르면 저장된 표본을 확인한다.

telemetry 활성 관측은 `gcp.cloudrun.inspect.v1`의 15분/로그 50건 계획으로 이어진다. 검토 후 **고정 로그·지표 조회 실행**을 누르면 새 시간창으로 최대 6회 읽기를 수행한다. 기존 `gcp.cloudrun.metadata.inspect.v1`은 원래의 세 GET만 유지한다. 조회 완료·표본 coverage·서비스 상태를 분리하는 기준은 [workflow](workflow.md)를 따른다.

## 고정 범위

| 항목 | 범위 |
|---|---|
| 시간창 | 수집 시작 시각을 분 단위로 내린 뒤 최근 2분을 제외한 15분 |
| 자원 | project/location/service_name/revision_name 네 값이 서버 binding과 일치해야 함 |
| 로그 | Cloud Run requests/stdout/stderr, 최신순 한 페이지, 최대 50건 |
| 요청 수 | `run.googleapis.com/request_count`, 60초 `ALIGN_SUM`, 한 페이지 최대 120 points |
| 응답 지연 | `run.googleapis.com/request_latencies`, 60초 `ALIGN_PERCENTILE_95`, 한 페이지 최대 120 points |
| 네트워크 | Logging 읽기 POST 1회 + Monitoring GET 2회, 응답당 128 KiB; 페이지 추적·재시도·자동 갱신 없음 |
| 저장 필드 | 로그 시각/심각도/stream/HTTP 상태/지연, 지표 응답 코드/시각/값, 페이지 제한 여부·출처·수집 시각 |

Logging의 POST는 `entries:list` 읽기 API다. 브라우저에서 filter·pageToken·window·endpoint·project·credential을 받지 않는다. API 부분 응답 mask와 서버 재추림을 모두 적용한다. 로그 본문·JSON/proto payload·URL/IP·trace·label 원문·원문 오류·페이지 token을 저장하지 않으므로 그 안의 지시문이나 비밀도 모델 입력에 포함하지 않는다. [entries.list](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/entries/list) · [LogEntry](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/LogEntry)

## 수치 해석

- Cloud Run 요청 지표는 컨테이너에 도달한 요청 범위이며 모든 외부 요청을 포함하지 않는다. 60초 단위 수집 뒤 지연될 수 있어 최근 2분을 제외하지만 데이터 완전성을 보장하지 않는다. [Cloud Run metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_p_z#run)
- 요청 수는 반환된 표본의 합이다. 누락된 분/응답 코드·추가 페이지가 있을 수 있으므로 전체 요청 수나 오류율로 표시하지 않는다. 5xx 표본이 없으면 `—`이며 0으로 추정하지 않는다.
- 지연 카드는 반환된 **응답 코드별·분별 p95 중 최댓값**이다. 전체 서비스나 15분 전체의 p95가 아니다. GAUGE 형태의 정렬 결과를 고정 60초 bucket으로 표시한다. [정렬과 percentile 계약](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.alertPolicies#Aligner)
- 빈 응답과 다음 페이지가 있는 빈 응답을 구분한다. `no_data`, `denied`, `unavailable`, `skipped`를 보존한다. 잘못된 지표 타입/값·중복 series/points·안전 정수 범위 초과는 unavailable, 다른 자원/시간 범위·주체 변경은 전체 관측 거부다.
- 조회 당시 서비스 UID는 검증하지만 Logging/Monitoring의 revision 라벨에 과거 서비스 UID는 없다. 같은 이름을 재사용한 과거 자원과의 관계를 확정하지 않는다. 앱 상태는 unknown, telemetry 근거 품질은 partial이다.

Monitoring의 FULL 페이지 크기는 series 수가 아니라 points 수 기준이다. 각 지표는 한 페이지이며 실행 오류가 있으면 완전한 수치로 사용하지 않는다. [timeSeries.list](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list)

## 검증과 남은 일

`apps/gateway/test/telemetry.test.ts`는 고정 쿼리·필드 제거·거절/결측/페이지·scope/time·identity/취소·응답 한도·metric 값/중복을 합성 검증한다. `gcp-configuration.test.ts`는 설정된 GCP-only HTTP와 Firestore transaction port까지 연결한다. `npm run test:gcp-web`는 실제 HTTP/저장/collector와 합성 Google·모델 응답으로 조회→분석/출처→검토/명시적 로그·지표 실행→인계/새로고침·영문 모바일/axe를 검증한다. 검토/재시도/상태 확인은 추가 조회하지 않고, 확장 실행 시에만 telemetry 세 쿼리가 한 번 더 수행되는지 확인한다. 기존 metadata 계획의 무추가 호출 회귀도 유지한다.

실제 IAM에는 지정 범위의 `logging.logEntries.list`와 `monitoring.timeSeries.list` 등 사용하는 읽기 권한이 필요하다. 앱이 권한을 자동 생성하지 않는다. [Monitoring 권한](https://docs.cloud.google.com/iam/docs/roles-permissions/monitoring) 호출/응답 한도는 비용 예산을 보장하지 않으며 실제 프로젝트에서 인증·쿼리 응답·사용량을 별도로 검증해야 한다. 로그 본문은 현재 범위에서 제외한다. GCP Android/FCM과 실제 배포는 남아 있다.

Monitoring의 time-series 조회는 조회 결과에 따른 과금 대상이 될 수 있다. 무료량/단가는 [현재 Observability 요금표](https://cloud.google.com/products/observability/pricing?hl=en)와 [청구 추정](https://docs.cloud.google.com/stackdriver/estimating-bills)을 따른다. 이 앱의 한 페이지/120 points 제한을 통화 단위 비용 상한으로 해석하지 않는다.
