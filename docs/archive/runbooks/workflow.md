> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 계획 검토·실행·결과와 인계

갱신: 2026-10-10. 인증된 HTTP·SQLite·고정 Cloud Run collector와 한/영 웹을 합성 신원/Google 응답으로 통합했다. 실제 Google/Firebase 로그인·Gemini·원격 저장·배포·Android 검증은 별도다. [GCP 서버 설정](server.md)으로 실제 서비스 구성을 조립할 수 있지만 기본 비활성이다. 기본 웹에서는 합성 관측 예시와 브라우저 워크플로 체험을 명시적으로 열 수 있다.

## 사용 흐름

초기 관측에 [제한된 로그/지표](telemetry.md)가 포함되면 서버가 `gcp.cloudrun.inspect.v1` 계획을 준비한다. 실행 시 새 시간창으로 로그·지표를 다시 조회한다. metadata-only 관측과 기존 metadata 계획은 원래의 세 GET 계약을 유지한다.

[관측 연결](web.md)과 [분석 구성](analysis.md)을 주입한 환경에서 사용한다.

1. **GCP 웹 로그인 → 메타데이터·로그·지표 조회 → 분석과 계획 준비** (telemetry 비활성 시 메타데이터 조회)로 근거와 5분 수명의 고정 계획을 만든다.
2. 준비된 계획은 **계획** 탭에서 연다. 카드 상단의 **검토 요청**으로 검토 대기를 만든다. reviewer가 메모와 함께 **계획 확인 / 수정 요청 / 거절**을 기록한다. 확인만으로 실행하지 않는다.
3. operator가 **고정 로그·지표 조회 실행**을 누른다. 같은 서비스 → 지정 revision → 로그/요청 수/응답 지연 → 서비스 재확인, 최대 6회 읽기다. **고정 메타데이터 조회 실행**은 원래의 세 GET만 수행한다. 모델은 다시 호출하지 않는다.
4. 필수 읽기 완료·필수 관측 미완료·결과 미확인·시작 전 중지를 구분한다. 읽기 완료도 서비스 정상이나 복구 완료를 뜻하지 않는다. 로그·지표가 있어도 한 페이지 표본/누락/과거 UID 한계로 health는 unknown, coverage는 partial이다.
5. **후속 담당자에게 남길 인계 → 인계 기록 저장**으로 후속 메모를 남긴다. 메모는 원래 실행 상태·완료 시각·근거를 바꾸지 않는다.
6. 로그인 후 **저장** 탭의 **저장된 계획과 결과**에서 서비스/계획 ID로 검색하고 **저장 계획 열기**를 누른다. owner/workspace별 최근 50개를 최대 6개씩 보여준다. 목록 탐색은 추가 HTTP를 만들지 않고, 계획 열기는 저장된 세부 정보를 조회하며 provider나 모델을 호출하지 않는다. 검토/인계 입력은 같은 계획의 탭·언어 전환 동안 유지하며 대상·사용자 변경이나 권한 회수에는 기존 화면 기록을 지운다.

검토는 앱의 작업 기록이며 회사 절차를 대체하는 새 승인 체계가 아니다. reviewer와 operator는 서버 membership에 따라 다르며 둘 다 부여할 수 있다. 개인 사용자의 앱 역할은 본인 등록 자원에만 적용된다. 언어는 권한/대상을 바꾸지 않는다.

## 조회 완료와 근거 범위

확장 계획 입력은 서버가 `windowMinutes: 15`, `maxLogEntries: 50`으로 고정한다. 각 지표는 120 points/한 페이지이며 새 시간창은 실행 시작 시 계산한다. 모델/브라우저가 이를 바꾸지 못한다.

서비스·revision·전후 일관성에 필요한 근거가 모두 수집되고 로그/요청 수/응답 지연 쿼리가 각각 `collected` 또는 `no_data`이면 조회가 완료된다. `no_data`는 빈 응답을 받은 것이며 0건이나 정상이라는 뜻이 아니다. 다음 페이지가 있더라도 고정 한 페이지 쿼리는 완료될 수 있다. denied/unavailable/skipped 중 하나라도 있으면 조회 미완료다. 메타데이터 변경도 실패로 남는다.

`gcp-run-query-completion`은 서버가 실행 결과에만 추가하는 세 쿼리의 완료 기록이다. 동일한 Monitoring 출처를 쓰는 요청 수와 지연을 ID별로 검사한다. 이 기록이 complete여도 telemetry 표본과 전체 coverage는 partial이며 서비스 정상 판정은 unknown이다. 원래 관측의 근거 생성/해시를 바꾸지 않으므로 과거 metadata 분석/계획도 유지된다. 화면은 각 쿼리의 결과와 범위를 따로 표시한다.

## 연결 없이 체험하기

개인용 또는 조직용 → Google Cloud → **합성 워크플로 체험**에서 **합성 근거 보기 → 합성 계획 검토 → 대상/범위 확인 → 합성 조회 결과 보기 → 체험 인계 남기기**를 진행한다. 오류 표본·빈 표본·응답 지연 권한 거절을 전환할 수 있다.

이 경로는 브라우저 안의 미리 작성한 데이터와 해석으로 구성된다. 실제 로그인/Google/Gemini/계획 API를 호출하지 않으며 서버 검토·실행·감사 기록을 만들지 않는다. 닫기·새로고침·시나리오/개인·조직 공간 변경 시 초기화한다. 실제 서버 흐름의 검증은 아래 HTTP 통합 테스트와 구분한다.

## HTTP 계약

[관측 API](web.md)의 개인/조직 GCP base 아래에 추가된다. 같은 Origin/Host·Bearer·no-store·strict JSON 32 KiB 경계를 사용한다. POST는 UUID `Idempotency-Key`가 필수다.

| 경로 | 입력 | 효과 |
| --- | --- | --- |
| `GET /plans` | 없음 | owner/workspace별 최근 50개 계획 ID·resourceId·생성 시각 |
| `GET /plans/:id` | 저장된 ID | 불변 계획, 현재 검토/실행, 결과 근거와 서버가 계산한 버튼 권한 |
| `POST /plans/:id/review` | expectedVersion, expectedDigest | 검토 대기·알림 intent 저장. 전송/실행 없음 |
| `POST /plans/:id/decision` | expectedVersion, expectedDigest, decision, note | approve/reject/request_changes 기록. 실행 없음 |
| `POST /plans/:id/execute` | planId, expectedVersion, expectedDigest | 새 실행만 고정 읽기 수행. 동일 요청 재전송은 저장된 상태 반환 |
| `GET /executions/:id` | 저장된 ID | 해당 분석/계획에 속하는 실행과 근거 조회 |
| `POST /executions/:id/handoff` | note (1–2,000자) | 종료된 실행의 인계 기록 추가, 최대 100개 |
| `POST /executions/:id/cancel` | 빈 객체 | queued 상태만 중지. 되돌림이나 재실행 아님 |

`GET /resources`의 `workflowAvailable`은 이 facade의 구성 여부이며 실제 Google 접근 성공을 의미하지 않는다. 모든 동작은 저장된 GCP metadata 또는 확장 고정 계획에만 연결된다. owner/provider·실행 대상·명령·자격증명·권한 override를 받지 않는다. 클라이언트 버튼은 편의 기능이며 서버 검증을 대신하지 않는다.

## 서버 조립과 재시도

`GcpOperations(store, access, analyses, registrations)`를 같은 저장소/신원/등록 목록으로 만들고 `GcpApiServices.operations`에 넣는다. 요청마다 session에 묶인 metadata/확장 adapter를 만들며 전역 사용자/프로필/토큰을 변경하지 않는다. bearer/session은 요청 메모리에만 있고 계획·근거·감사에 저장하지 않는다.

- 분석·계획·최근 목록·감사·완료 reservation은 같은 transaction에서 저장한다. 목록은 50개로 제한하지만 오래된 계획/근거를 삭제하지 않는다. 이 목록 기능 도입 전 저장된 계획의 자동 backfill은 없다.
- 계획 ID를 안다고 조회/변경할 수 없다. 매 요청에서 웹 신원·owner/membership을 확인하고 mutation transaction에서 membership version/만료를 재확인한다. 조직 기록은 허용된 같은 workspace 멤버끼리 공유하며 개인 기록과 분리된다.
- 실행은 고정 버전/digest·근거·만료·검토 상태·등록 대상을 검사한 뒤 plan consume/실행/dispatch intent/replay를 원자 저장한다. 최초 생성 요청만 worker claim을 받아 읽기를 시작한다. 같은 키의 다른 내용과 사용된 계획의 새 실행을 거부한다.
- 브라우저 응답 유실 후 **같은 요청 확인**은 원래 키/내용을 유지한다. 서버에서 실행을 마쳤으면 저장된 결과만 반환한다. 새로고침 후에는 최근 계획에서 실행/인계를 연다.
- 실행 intent 저장 직후 프로세스가 종료되면 queued가 남을 수 있다. 같은 요청이나 GET으로 작업을 재시작하지 않는다. 대기 실행을 명시적으로 중지한 뒤 새 관측/계획을 준비할 수 있다.
- running claim은 120초이며 현재 collector는 별도로 15초 제한을 둔다. 계획 또는 claim 기한이 지나면 unknown으로 기록하고 늦은 응답을 성공으로 승격하지 않는다. 결과 저장 transaction에서도 계획 기한과 membership을 검사한다. 수집 중 권한 회수는 성공/실패 근거를 저장하지 않고 unknown을 남긴다.
- 기본 화면은 불변 분석/관측/실행의 ID·scope·시각·digest 연결을 검사한다. 사용자 전환·로그아웃·401/403은 이전 결과와 최근 목록을 지우고 지연 응답을 버린다. 서버 목록 갱신 실패도 이전 선택지를 제거한다.

현재 실행은 인증된 HTTP 요청 안에서 제한된 읽기를 마친다. 별도 queue 소비자/worker 전송·자동 복구 실행·FCM 발송은 아직 없다. 외부 큐와 모바일을 붙일 때도 저장된 intent/claim과 전달 인증을 별도로 검증해야 한다. Firestore adapter가 존재하는 것만으로 실제 원격 지속성/동시성 검증을 완료했다고 표현하지 않는다.

## 재현과 검증 범위

```sh
npm run test:server
npm run test:gcp-web
make check
```

`apps/gateway/test/inspection.test.ts`는 전체/빈/부분 페이지 완료와 개별 쿼리 거절/불가·revision 거절·도중 변경, 입력/모드/등록 범위·권한 회수·같은 키 재시도·metadata 무추가 호출을 검증한다. `apps/gateway/test/analysis.test.ts`는 실제 HTTP/SQLite로 검토와 실행 분리, 동시 요청·같은 키 재시도, 재오픈 store 결과/인계, queued 중지, viewer/reviewer/operator·개인/조직 경계, 위조 입력, 권한 철회·기한 만료·늦은 완료·목록 원자성을 검증한다. `apps/gateway/test/web-client.test.ts`는 저장된 계획 복원, 고정 키/내용 재시도, 잘못된 근거/실행 응답 거부, 사용자 전환과 목록 정리를 검증한다.

`npm run test:gcp-web`는 브라우저와 실제 위 API/collector를 연결한다. 실행 응답을 의도적으로 끊은 뒤 같은 키로 복구하고 provider 읽기가 한 번만 발생하는지 확인한다. 한/영 검토→명시적 실행→인계→새로고침 복원, 영어 390px/접근성과 클라이언트 저장소 비노출도 검사한다. 신원과 Google 응답은 합성이며 live Google/Gemini 호출은 없다.

[모바일 HTTP](mobile.md)는 같은 계획/검토/실행/인계 기록을 사용한다. Android 앱/FCM 연결은 후속이며, 모바일 경로에서는 GCP/owner/역할을 다시 검사한다.
