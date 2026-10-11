> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 근거 분석과 고정 읽기 계획

갱신: 2026-10-10. HTTP/저장/권한/공통 workflow와 한·영 UI를 합성 모델로 통합 검증했다. 실제 Gemini 호출·의미 정확도·Google 인증·배포 검증은 아니다.

## 사용 흐름과 기본 기동

서버에 관측·모델·읽기 어댑터를 주입한 환경에서 **GCP 웹 로그인 → 메타데이터 조회 → 분석과 계획 준비**를 선택한다. 오른쪽 패널은 분석, 관측 해석/가설, 클릭 가능한 근거 ID, 부족한 정보와 5분 수명의 고정 계획을 표시한다. 좁은 화면에서는 관측 아래에 배치한다. 분석 문장은 모델 출력이며 사용자가 근거를 확인해야 한다. 출처 존재 검사가 의미 정확도를 보증하지 않는다.

계획 준비는 검토 요청·FCM·실행 intent·Google 메타데이터 재조회를 시작하지 않는다. 같은 관측과 언어의 **저장된 분석 확인**은 기존 결과를 반환한다. 패널은 저장된 분석 언어도 표시한다. 표시 언어를 바꾸는 것만으로 모델을 호출하지 않으며, 다른 언어에서는 **한국어로 분석과 계획 준비 / Prepare analysis and plan in English** 버튼으로 해당 언어의 분석을 명시적으로 준비한다. 새로운 조회·서비스 변경·로그아웃·권한 회수·사용자 전환은 이전 분석을 지운다. 분석 실패 시 현재 관측은 남기되 401/403은 관측도 지운다. 모델 응답 유실은 같은 키로 결과만 확인한다.

`npm run dev`/`api:cloud`는 [명시적 서버 설정](server.md)으로 GCP composition을 켤 수 있으며 기본 비활성이다. 따라서 현재 기본 웹의 합성 관측 예시는 분석 API에 보내지 않는다. 합성 통합 fixture의 로그인과 분석을 제품의 실제 Gemini 연결로 표현하지 않는다.

## API와 서버 조립

선택적 [telemetry](telemetry.md)가 활성화된 관측은 로그 표본·요청 수·분별/응답 코드별 p95도 모델 근거에 포함한다. 새 출처 3개를 검증하며 prompt version은 `cloud-run-observation-v3`다. 로그 본문/명령은 전달하지 않는다. 기존 metadata-only 근거도 지원한다.

[관측 API](web.md)의 개인/조직 GCP base 아래에 추가한다.

| 경로 | 입력 | 결과 |
| --- | --- | --- |
| `GET /resources` | 없음 | 자원별 `analysisAvailable` 추가. 데이터 모드와 등록 어댑터를 확인한다. |
| `POST /analyses` | `observationId` UUID, `language: ko/en`, UUID `Idempotency-Key` | 불변 분석·근거·서버 고정 plan payload/digest. |
| `GET /analyses/:id` | 저장된 ID | 현재 owner/membership·관측 구성·계획 무결성 확인 후 저장된 분석 반환. |

자격증명·대상·objective·action·코드·임의 prompt는 브라우저에서 받지 않는다. GCP 전용 `/plans`·검토·명시적 실행·인계는 [workflow API](workflow.md)에 연결했다. 저장된 분석 조회는 과거 계획이 아직 실행 가능한지를 보증하지 않으며 실행 시 버전·digest·만료·상태를 다시 검사한다. 별도 [모바일 HTTP](mobile.md)에서 저장된 결과/검토/실행을 이어받는다. Android 앱은 남았다.

1. 같은 `CloudStore`에 `GcpWebAccess`, `GcpObservations`와 `CloudWorkflow`를 조립한다.
2. `createCloudRunAdapters(registrations, dataMode, authorize)`가 반환하는 두 adapter를 workflow에 등록한다. `authorize`는 내부 worker가 사용할 새 권한을 실제 확인해야 한다. 브라우저 입력이나 데모 역할로 재구성하지 않는다.
3. `GcpAnalyses(store, access, observations, workflow, model)`를 만들고 `GcpApiServices.analyses`에 넣는다. API/서비스/저장소 인스턴스가 서로 다른 persistence를 가리키게 구성하지 않는다.
4. 실제 모델은 `createGeminiModel({ enabled, projectId, location, modelId, principal, sessionId, credentials })`로 구성한다. 프로젝트는 관측 프로젝트와 같아야 한다. 모델/지역은 운영자가 서버에서 고정한다. 기본 ADC/gcloud·브라우저 API key를 사용하지 않는다. credential adapter/config loader는 구현했으며 실제 프로젝트·모델·비용 범위와 live 검증은 남았다.

## 호출·저장 경계

- 모델 호출 전에 owner/workspace/actor/request-key에 입력 fingerprint를 저장한다. 같은 actor·관측·언어·모델 구성에는 키가 달라도 하나의 30초 reservation을 재사용한다. 다른 입력으로 기존 키를 쓰면 409다.
- 모델 I/O는 트랜잭션 밖에서 수행한다. 20초 대기 제한과 AbortSignal, 입력 64 KiB·응답 128 KiB·후보 1개·출력 4,096 tokens를 제한한다. 가격/실제 과금액을 보증하는 한도는 아니다. 네트워크와 모델 호출을 자동 재시도하지 않는다.
- 만료한 pending은 unknown이며 같은 작업으로 재호출하지 않는다. 늦게 도착한 결과는 계획을 저장하지 않는다. 실패 결과도 같은 키로 다시 모델을 호출하지 않는다. 다른 언어 또는 새로운 관측 분석은 별도 호출 대상이다.
- 모델 호출 전후 웹 권한, 트랜잭션 내 membership version, 관측 구성/근거 digest와 15분 신선도를 확인한다. 분석·고정 계획·감사·완료 reservation을 한 트랜잭션으로 저장한다. 저장 실패 시 계획만 남지 않는다.
- Vertex 요청은 서버 고정 `generateContent` 경로·JSON schema·system instruction이다. 도구·검색·function calling·모델 생성 실행 코드는 없다. STOP/단일 JSON 응답만 받고 citation ID·필드·길이를 별도 검증한다. 원문 에러·bearer·모델 원문은 audit/replay에 저장하지 않는다.
- `serviceAssessment`는 항상 unknown이다. 누락/거절/변경 근거는 서버가 missingInformation에 덧붙인다. 자유형 해석의 사실성·인과관계는 실제 모델 평가가 별도로 필요하다.

## 메타데이터 점검과 전체 점검의 구분

신규 고정 action `gcp.cloudrun.metadata.inspect.v1`은 입력 `{}`로 **동일 service → pinned revision → 동일 service 재조회**만 수행한다. 서버가 action/대상/완료 기준/5분 만료를 결정한다. telemetry가 있는 관측에서는 `gcp.cloudrun.inspect.v1`의 15분/로그 50건 계획을 서버가 선택한다. 모델은 action이나 입력을 선택하지 않는다. 확장 실행은 로그/요청 수/지연 세 쿼리와 서비스 전후 확인을 포함한다. 기존 저장된 metadata 계획도 조회/실행할 수 있다.

명시적인 workflow 검토·실행에서는 메타데이터가 모두 수집되면 읽기 완료가 succeeded, revision 거절이면 failed다. 두 결과 모두 application health는 unknown이며 미수집 신호와 표본 범위 때문에 evidence coverage는 partial이다. 확장 실행은 빈 결과/부분 페이지가 있어도 각 고정 쿼리가 끝나면 완료될 수 있고, 하나라도 denied/unavailable/skipped이면 실패한다. 인증된 HTTP 요청 안의 제한된 실행과 결과/인계 UI를 합성 통합했다. 실제 인증·별도 worker transport·FCM은 남았다.

## 근거와 검증 한계

- [Google generateContent REST](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/projects.locations.publishers.models/generateContent)와 [구조화 출력](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/control-generated-output?hl=en)의 endpoint·JSON 응답 설정을 확인했다. API가 구조를 맞추더라도 근거의 사실성을 보증하지 않으므로 앱 검증/의미 평가를 분리한다.
- `apps/gateway/test/analysis.test.ts`: 실제 HTTP/SQLite+합성 모델, 동시성·다른 키 중복 방지·unknown·권한 회수·위조 출처/명령·rollback, 메타데이터 성공/부분 실패 대조, REST 요청/응답 한도와 offline 차단.
- `apps/gateway/test/web-client.test.ts`, `npm run test:gcp-web`: 실제 브라우저의 분석·저장 결과 재조회·출처 열기·영문 모바일/axe·이전 결과 제거. 모델 호출 수와 metadata 재조회가 늘지 않음을 확인한다.
- 실제 Gemini 모델 품질/지연·IAM·과금·Google API 네트워크·원격 DB·배포·Android 실기기는 미검증이다.

합성 관측 8종·한영 요청 16개와 원문/사람 검토 기록 도구는 [GCP 의미 평가 사용법](evaluation.md)을 따른다. 제품과 형식/출처 검사·요청 본문을 공유하지만 실제 Gemini 응답·정확도·개선율은 아직 측정하지 않았다.
