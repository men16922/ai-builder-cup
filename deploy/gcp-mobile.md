> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 모바일 API

선택적 [단말·알림 API](gcp-notifications.md)는 같은 native bearer 경계에서만 제공한다. 실제 composition은 `notifications.enabled`를 명시할 때만 Firebase 신원 재확인·FCM 전송 port와 worker를 조립하며 기본 비활성이다(실제 호출 미검증). 지속 의도·전송 예약·Kotlin 최신 조회 core/로컬 HTTP는 합성 연결했으며 등록 coordinator/앱 열기 소스도 조립했다. FCM source/callback·APK/기기·실제 전송은 남았다. Inbox는 알림 없이도 사용할 수 있다.

갱신: 2026-10-10. 웹에서 준비한 GCP 계획을 모바일에서 조회·검토·명시적 실행·결과 확인·인계하는 HTTP 경로를 구현했다. 실제 서버/SQLite/collector와 합성 신원·Google 응답으로 검증한다. Android 앱, 실제 Firebase 로그인·Google API·FCM·배포 검증은 아직 아니다.

Kotlin 클라이언트/상태·고정 설정/Firebase 신원과 Compose 로그인 소스를 추가했다. `make check-android-core` 30개는 원본 근거/웹 11종 대조·조직/개인 로컬 HTTP/SQLite와 Kotlin 신원 계약을 합성 통합한다. Firebase SDK 서명 검증은 합성 port로 대체하며 앱 설정/저장 경계는 아래 실행 문서를 따른다. APK/기기 UI/실제 Firebase 신원은 별도 미검증이다. [Android 실행/검증](../mobile/android/README.md)

## 범위와 인증

- 개인: `/api/mobile/v1/personal/workspaces/{workspaceId}/gcp`
- 조직: `/api/mobile/v1/organizations/{organizationId}/workspaces/{workspaceId}/gcp`

기존 [GCP 서버 설정](gcp-server.md)의 신원 verifier·membership·등록 자원·저장소를 사용한다. 모든 요청에 Firebase ID token 또는 구성된 신원 adapter가 검증하는 토큰을 `Authorization: Bearer …`로 보낸다. 클라우드 서비스 계정 토큰/SSO token은 웹·모바일 신원이 아니다. 개인 owner는 검증된 actor로 만들고 조직은 현재 membership/역할을 확인한다.

채널 `mobile`은 서버가 경로를 보고 만든다. body/provider/role/header로 선택하지 않는다. 조직 인증의 내부 웹 session을 유지하면서 외부 GCP context의 owner/workspace/actor/roles가 일치하는지 검사한다. 공통 도메인은 모바일의 non-GCP binding을 거부한다. 이는 API 기능 경계이며 Android 기기 증명이나 별도 웹 권한의 회수 기능이 아니다.

운영 주소는 서버에 고정한 HTTPS `publicOrigin`이다. 로컬 검증만 loopback HTTP를 허용한다. Host는 고정 주소와 같아야 한다. 네이티브 요청은 Origin과 Sec-Fetch-Site 둘 다 없을 수 있으나, 브라우저 헤더가 있으면 같은 출처만 허용한다. 이 예외는 모바일 경로에만 적용되며 기존 웹의 Origin 검사는 유지한다. 쿠키만으로 접근할 수 없고 CORS 허용 헤더도 추가하지 않는다.

## 경로

아래 경로는 위 base 뒤에 붙인다. POST는 strict JSON·32 KiB 이하·UUID `Idempotency-Key`를 요구한다. 응답은 `Cache-Control: no-store`다.

| 메서드 / 경로 | 입력 | 동작 |
|---|---|---|
| `GET /inbox` | status=all/pending/results, limit=1–20, cursor=UUID | 현재 등록된 GCP 계획의 요약. 기본 pending/20 |
| `GET /plans/:id` | 없음 | 대상·근거 시각·고정 action/입력·해석·만료·검토/실행·서버 버튼 권한 |
| `GET /analyses/:id` | 없음 | 저장된 분석과 원래 관측 ID |
| `GET /observations/:id` | 없음 | 원래 관측/출처, 새 수집 없음 |
| `POST /plans/:id/review` | expectedVersion, expectedDigest | 검토 요청 기록, 전송/실행 없음 |
| `POST /plans/:id/decision` | expectedVersion, expectedDigest, decision, note | approve/reject/request_changes, 실행 없음 |
| `POST /plans/:id/execute` | planId, expectedVersion, expectedDigest | operator의 명시적 고정 읽기 실행 |
| `GET /executions/:id` | 없음 | 저장된 실행과 결과 근거/인계 |
| `POST /executions/:id/handoff` | note | 종료된 실행에 인계 추가, 상태 유지 |
| `POST /executions/:id/cancel` | 빈 객체 | 시작 전 queued만 중지 |

모바일에서 새 관측/모델 분석 생성은 제공하지 않는다. 웹의 준비 흐름을 이어받는다. reviewer는 판단, operator는 검토 요청·실행·인계, viewer는 읽기만 가능하다. 서버가 두 역할을 함께 부여할 수 있다. 계획 확인은 회사 절차를 대신하지 않고 실행 버튼과도 구분한다.

## Inbox와 재접속

Inbox는 owner/workspace의 최근 계획 50개 중 현재 등록된 GCP binding을 검사한다. pending은 만료하지 않은 prepared/pending, results는 실행 기록이 있는 항목이며 완료된 것만 뜻하지 않는다. all은 이 범위의 전체 상태다. 최대 20개를 반환하고 더 있으면 마지막으로 반환한 GCP 계획 ID를 nextCursor로 준다. 중복 query/미지원 filter와 다른 provider cursor를 거부한다.

cursor는 권한이나 snapshot token이 아닌 목록 위치다. 새 계획이 추가되거나 상태가 바뀔 수 있으므로 새로고침은 cursor 없이 시작한다. cursor가 최근 범위에서 사라지면 `409 inbox_changed`다. 전체 이력·정확한 조직 합계·지속 모니터링을 제공하지 않는다. 각 페이지는 한 저장 transaction의 요약이며 선택 후 상세를 다시 읽어 현재 권한·구성·기한을 확인해야 한다. 결과 상세 조회는 만료된 실행 claim을 unknown으로 정리할 수 있다.

요약에는 대상과 시각·lifecycle/review/execution 상태를 포함하고 모델 원문·로그 본문·토큰·실행 claim은 넣지 않는다. Inbox·상세·판단·재시도·인계는 자원/모델을 호출하지 않는다. 새 명시적 execute 요청만 고정 읽기를 시작한다. 같은 키/본문으로 재확인하면 저장된 결과를 돌려주며 키에 다른 본문을 보내면 충돌한다. 웹과 모바일의 같은 actor는 동일한 서버 기록을 공유한다.

연결이 끊기면 결과를 미확인으로 표시하고 최신 서버 상태를 확인한다. Android가 오프라인 판단을 예약했다가 자동 제출해서는 안 된다. 프로세스 재시작/오래된 알림 후에도 Inbox와 상세부터 읽는다. FCM은 아직 연결하지 않았으며 알림 없이 이 경로로 진행할 수 있다.

## 검증

`server/gcp-mobile.test.ts`는 실제 HTTP에서 네이티브 무-Origin 요청, 웹 경계 유지·Host/교차 출처 거절, missing/invalid/expired token, 역할·membership 회수·개인/조직/다른 사용자 경계, 다른 provider의 직접 ID/결정/실행/인계/cursor 거절, 페이지/만료·동시 판단, 웹→모바일 결과 일치와 저장소/서비스 재조립 후 복원을 확인한다.

실제 collector를 거치는 합성 확장 실행은 처음 관측에 metadata/telemetry 각각 3회, 실행 후 각각 6회다. 검토/인계/재접속/같은 키 재시도로 더 호출하지 않는다. 신원·Google·모델은 합성이고 Firebase/Firestore 원격 지속성·네이티브 앱/실기기·실제 API/IAM·비용 검증은 별도로 남아 있다.
