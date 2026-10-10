> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 모바일 알림·최신 업무 조회

2026-10-10. 서버의 지속 알림 의도·단말 계약·전송 port와 Android Kotlin core/로컬 HTTP를 합성 연결했다. **실제 FCM SDK 전송·기기 수신·APK는 아직 없다. 단말 등록 수명주기 core와 Android 알림 열기/상태 UI 소스는 조립했으며 Compose/기기 검증 전이다.** 실제 배포 composition은 `notifications.enabled`를 명시하지 않으면 전송 port를 주입하지 않으므로 알림 등록은 기본 비활성이다. 서버 측 비공개 수신자 매핑·Firebase authority·FCM adapter·worker 조립은 구현했으나 실제 Google 호출로 검증하지 않았다. 기존 Inbox/상세 조회는 그대로 사용할 수 있다.

## 현재 흐름

GCP 웹/모바일의 검토 요청·판단·실행 종료·인계 변경 → 같은 저장 트랜잭션의 알림 의도 → 별도 worker의 예약 → 신원·멤버십/단말 재확인 → 주입한 전송 port → 현재 권한으로 최신 업무 조회다. 검토 요청이나 알림 수신은 운영 실행을 시작하지 않는다. 관측 수집·분석 준비만으로 알림을 만들지 않는다.

`server/modules/gcp/notification-store.ts`는 GcpOperations의 저장 port를 감싼다. 기존 업무 쓰기를 버퍼링하고 알림 키를 읽은 뒤 한 트랜잭션으로 반영한다. 콜백 안에서는 저장소만 읽고 쓴다. 이전 read-before-write 계약은 유지하며 콜백 재시도/실패 시 업무와 의도가 함께 재시도/롤백된다. 공통 `CloudWorkflow`와 AWS 회사 코드는 Firebase/FCM에 의존하지 않는다.

알림 의도에는 owner/workspace와 plan ID/version·종류·시각·dataMode만 저장한다. worker 탐색은 공간별 최근 **100개** 의도·활성 후보 **20개** 단말로 제한한다. 이전 의도는 탐색 목록에서 빠지지만 원본 업무와 저장 기록을 삭제하지 않는다. 보존/삭제 운용은 실제 배포에서 별도 결정해야 한다. 목록에서 빠진 알림은 직접 열 수 없으며 Inbox에서 최신 업무를 찾는다.

## 단말과 API

모든 경로는 [모바일 API](gcp-mobile.md)의 `/api/mobile/v1/{personal|organizations}/…/gcp` 아래다. native bearer 예외는 이 경로에만 적용하며 브라우저 Origin·Host·중복 Authorization 검사를 유지한다. 웹 경로에서는 아래 기능을 제공하지 않는다.

| 요청 | 본문/결과 |
| --- | --- |
| `GET /devices` | 인증 후 `{configured:boolean}`. 기본 `false`. |
| `POST /devices` | `{installationId, expectedGeneration, token}`와 UUID `Idempotency-Key`. 새 등록의 expectedGeneration은 명시적 `null`. |
| `POST /devices/{installationId}/retire` | `{registrationKey}`와 UUID 요청 키. 등록 응답을 받기 전에도 해당 요청을 취소하고 늦은 등록을 차단한다. |
| `POST /devices/{installationId}/revoke` | `{expectedGeneration}`와 UUID 요청 키. 해당 세대만 해제하며 반복 해제는 동일 결과. |
| `POST /notifications` | 아래 data 객체와 UUID 요청 키. 최신 저장 업무/근거를 조회하며 운영 변경/모델/provider 호출은 하지 않는다. |

`installationId`는 앱이 만든 UUID이며 Firebase FID와 다르다. 서버는 신원에서 actor/owner를 계산하고 route의 작업 공간·현재 membership을 검사한다. 클라이언트의 owner/role·URL·provider/명령은 받지 않는다. 서버가 발급한 generation을 compare-and-swap으로 검사한다. 등록 응답은 `{installationId,generation,active,expiresAt}`뿐이다. 등록/교체는 같은 키·본문으로 복구할 수 있지만 해제/교체 뒤 이전 등록 요청을 재생하면 거부한다.

단말은 등록 당시 웹 ID token 만료 또는 1시간 중 빠른 시각에 만료된다. 권한 변경은 이전 membership version을 무효화한다. 같은 actor의 공간 이동은 현재 generation이 필요하다. 계정이 달라지면 새 설치 UUID를 사용해야 하며, 같은 transport token의 새 등록은 이전 주소 매핑을 무효화한다. 지연된 이전 등록·해제 응답으로 새 generation을 변경하지 않는다. Kotlin coordinator와 앱 소스는 token 갱신/로그아웃에 연결했다. 실제 FCM source는 아직 주입하지 않았다.

전송 token은 서버 내부 `gcp-push-address` 레코드에만 보관한다. 단말 메타데이터·알림/재시도 기록·응답·감사·보고서에 token을 넣지 않는다. 현재 같은 CloudStore의 별도 키 공간이며 별도 암호화 저장소를 구현했다는 뜻은 아니다. 실제 Firestore 접근은 서버 신원으로 제한해야 하며 모바일에서 이 레코드를 직접 읽거나 쓰는 경로는 없다. 원격 IAM/rules 검증은 남아 있다.

## data와 전송 의미

```json
{
  "schemaVersion": "1",
  "provider": "gcp",
  "notificationId": "<64 lowercase hex>",
  "installationId": "<UUID>",
  "generation": "<UUID>",
  "planId": "<UUID>",
  "planVersion": "1",
  "expiresAt": "<UTC ISO timestamp>"
}
```

모든 값은 문자열이다. 자원명·계정/조직 이름·근거·로그·메모·판단 결과·URL·실행 명령은 넣지 않는다. 의도는 1시간 뒤 만료되며 계획 자체의 더 짧은 실행 기한은 그대로 적용된다. 만료된 계획을 읽을 수 있어도 검토/실행 가능 상태로 승격하지 않는다.

`GcpPushPorts`는 worker 내부 주입 계약이다. public HTTP에서 `deliver`·전송 token 조회·임의 대상 전송을 호출할 수 없다. `current`는 recipient의 신원 회수/비활성 상태를 registeredAt 기준으로 확인해야 한다. 저장소 membership version/역할과 단말·token generation도 전후 재검사한다. Firebase Admin authority/FCM adapter와 worker는 아래 [수신자 매핑·전송 조립](#수신자-매핑전송-조립)에 따라 명시 설정 시에만 조립한다. 합성 event는 live port로 보내지 않는다.

전송 전에 30초 예약을 지속 저장한다. 예약이 이미 있으면 재전송하지 않는다. 만료·응답 유실·예외·기한 후 응답·전송 중 회수는 `unknown`으로 남기며, 재시작/같은 호출도 다시 보내지 않는다. `accepted`는 전송 서비스의 접수이며 휴대전화 도착이나 운영 성공이 아니다. `rejected`·전송 전 `suppressed`와 구분한다. 이미 네트워크로 나간 알림을 회수할 수 있다고 보장하지 않으며, 클릭 시 현재 권한 검사가 남아 있다.

FCM 자체의 등록 갱신/정리 지침은 [Firebase 공식 등록 관리 문서](https://firebase.google.com/docs/cloud-messaging/manage-tokens)를 따른다. 현재 port의 token 계약은 지원되는 legacy registration token 경로를 전제로 한다. 실제 SDK 버전·FID 전환 API·권한/자동 초기화 방식은 Android adapter 구현 시 다시 확인하며, 이 문서는 SDK 통합 완료를 뜻하지 않는다.

## Kotlin과 검증

`core/Notifications.kt`는 strict 문자열 data·단말 receipt·등록 DTO와 `MobileNotificationApi`다. `Client.kt`는 현재 로그인한 scope의 고정 mobile API에만 요청한다. token을 DTO `toString`에 노출하지 않으며 앱 자체 파일에 저장하지 않는다. `Controller.openNotification`은 명시적 클릭에서 최신 workflow와 원본 관측을 다시 조회하고 확인 체크를 초기화한다. 중복/늦은 알림의 상태를 화면에 복사하지 않으며 계정·공간 전환 후 늦은 응답을 버린다. 앱의 명시적 열기 버튼과 Intent entry 소스를 조립했다. 실제 FCM callback/source와는 아직 연결하지 않았다.

검증 명령은 `make check-android-core`와 `make check`다. Kotlin core/HTTP는 **49개**이며 실제 로컬 Node API·합성 신원/저장/전송과 연결한다. 이번 증분은 수명주기 11개·실제 소켓 취소 1개·등록 응답 유실 후 실제 로컬 HTTP 취소 1개다. 새 등록의 nullable CAS는 Kotlin JSON이 null을 생략하지 않도록 명시적으로 쓴다. payload/receipt의 숫자·문자열 Boolean 자동 변환을 차단한다. JVM 통과는 Compose/APK/기기 알림 검증이 아니다.

현재 전체 검증 결과·로그는 [verification](../docs/verification.md), 남은 앱 수명주기·실제 통합 조건은 [진행 계획](../docs/plans/2026-10-10-gcp-notification-handoff.md)에 기록한다.

## 앱 수명주기와 등록 응답 유실

`MobileNotifications`는 로그인 세션마다 새 설치 UUID를 사용한다. attach/로그인/초기 복귀는 source를 생성하지 않는다. 명시적 enable 후 서버 configured를 확인하고 `PushTokenSource`를 만든다. 확인된 등록은 token 변경/복귀 시 만료 임박 때 갱신할 수 있다. 결과가 불명확하면 자동 갱신/재시도로 덮지 않고 같은 input/key로만 명시적 재확인한다. token/등록 key/receipt는 앱 자체 파일·SavedState에 저장하지 않는다. SDK 내부 저장과 OS의 Intent 보관까지 제거했다는 뜻은 아니다.

해제 시 로컬 연결과 callback부터 제거한 뒤 최근 확인된 등록 키와 진행 중인 등록 키를 `retire`한다. 서버는 actor/owner/workspace·요청 키의 취소 기록을 트랜잭션에 저장한다. 늦게 도착한 등록은 그 기록을 읽고 거부한다. 이미 등록된 경우 해당 요청의 generation만 해제하므로 이전 취소가 새 갱신 세대를 해제하지 못한다. 전송 기능이 꺼졌어도 인증된 retire/revoke는 가능하다. 현재 membership이 회수돼 API를 사용할 수 없는 경우 worker의 현재 권한 검사와 등록 기한이 남는다.

정상 로그아웃은 화면을 즉시 비운 뒤 기존 신원이 살아 있을 때 2초 제한으로 retire를 기다리고 신원 SDK를 닫는다. 실패/시간 초과·강제 인증 상실/프로세스 정리에서는 서버 해제를 확인했다고 표시하지 않는다. 이전 정리가 진행 중인 채 새 로그인으로 넘어가도 그 불확실성을 보존하며 이전 정리가 새 신원을 닫지 않는다. 실제 Android TLS/강제 종료·background/여러 activity의 FCM 동작은 별도 검증해야 한다.

`UrlConnectionPort`는 취소 시 읽기 소켓을 disconnect하고 child IO를 정리한다. 기존 구현의 실제 loopback 응답 대기 취소는 3055ms가 걸렸다. 수정 후 서버 수신 확인·250ms timeout/1.5초 이내 종료 대조를 통과했으며 raw socket 오류가 CancellationException을 덮지 않게 했다. JVM 소켓 검증을 Android 기기 결과로 해석하지 않는다.

`MainActivity`는 `app.mobileops.agent.OPEN_GCP_NOTIFICATION` action의 `gcp_notification` JSON extra만 읽고 extra를 제거한다. 데이터는 untrusted locator이며 로그인·공간/URL·권한을 선택하지 않는다. cold start/재진입에서도 명시적 ‘최신 업무 열기’ 버튼만 HTTP를 호출한다. `singleTop`/`onNewIntent` 연결은 [Android task 문서](https://developer.android.com/guide/components/activities/tasks-and-back-stack)와 [Activity API](https://developer.android.com/reference/android/app/Activity#onNewIntent(android.content.Intent))를 따랐다. Compose/manifest 소스는 변경했지만 APK/기기 동작은 미검증이다. 기본 빌드에는 PushTokenSource factory가 없고 실제 알림 켜기를 제공하지 않는다.

## 수신자 매핑·전송 조립

2026-10-10 증분. 서버 측만이며 실제 Firebase/FCM 호출·Cloud Run·기기 수신은 검증하지 않았다.

- **비공개 수신자 매핑**: Firebase 검증기는 서버 검증 결과에 issuer·tenant·Firebase UID·`auth_time`을 private `recipient`로 함께 반환한다. 단말 등록 트랜잭션은 이 값으로 `identityActor`를 다시 계산해 현재 actor와 같을 때만 새 generation에 묶인 `gcp-push-recipient` 레코드에 저장한다. context·workflow·의도·전달 기록·응답·감사·보고서에는 넣지 않는다. 해제·retire·교체·미등록 정리 때 전송 주소와 함께 UID를 지운다. live 전송 port가 구성되면 검증된 subject 없는 등록은 `notification_identity_unavailable`(503)이고, 전송 시점에도 레코드가 없거나 actor와 맞지 않으면 `suppressed`다.
- **현재 신원 authority**: `server/platform/firebase/notifications.ts`의 `firebaseNotificationAuthority`는 Firebase Admin `getUser`로 비활성화와 `tokensValidAfterTime`을 확인한다. Firebase `checkRevoked`와 같이 등록한 로그인의 `auth_time`이 회수 시각 이상일 때만 현재로 본다. issuer/tenant/actor 불일치·등록 만료·조회 실패는 모두 false다. 저장소 membership/역할/generation 재검사는 그대로다.
- **FCM 전송**: `fcmNotificationTransport`는 고정 Android 패키지(`restrictedPackageName`)로 data-only 메시지를 보낸다. data는 위 8개 문자열 locator뿐이며 제목/본문·자원·URL은 없다. TTL은 의도 만료를 넘지 않는다. `registration-token-not-registered`·`invalid-registration-token`은 해당 generation만 비활성화하고 주소/UID를 지운 뒤 `rejected`로 기록한다. invalid-argument·패키지/자격 불일치 같은 명백한 거절은 `rejected`, 서버 오류·rate limit·빈 응답·중단은 `unknown`이며 어느 경우도 재전송하지 않는다. firebase-admin 14.5에서 deprecated지만 지원되는 registration token 경로이며 FID 전환은 Android adapter와 함께 결정한다.
- **worker**: `server/modules/gcp/notification-worker.ts`는 hosted 진입점이 `notifications.enabled`일 때만 시작한다. 공개 HTTP 트리거·cursor·임의 대상 없이 등록 시 서버가 갱신하는 최근 100개 공간 index → 공간별 최근 100개 의도 × 20개 단말만 순회한다. tick당 200회·15초 간격·겹침 없음이다. 같은 프로세스는 종결 상태를 다시 시도하지 않으며 재시작 후에는 지속 예약 기록이 재전송을 막는다. 종료 시 새 시도를 멈추고 최대 3초 기다린 뒤 HTTP를 drain한다. 중단된 예약은 `unknown`으로 남는다.
- **설정·조립**: `notifications: { enabled, androidPackage }`가 없거나 false면 port·worker가 없다. enabled와 port 유무·dataMode가 다르면 composition이 실패한다. live port는 `MOBILEOPS_OFFLINE_TEST=1`·Auth emulator·non-live credential에서 SDK import/토큰 발급 전에 차단된다. 명시적 서비스 계정 token provider를 전용 Firebase app에 주입한다.
- **검증**: `server/gcp-notification-delivery.test.ts`가 subject 비공개 저장과 정리, live subject 요구·변조 거부, 미등록 주소 1회 거절·세대 비활성화, worker 예산/진행/장애/중지, authority 회수·비활성화·불일치, FCM 메시지 형태·오류 분류·중단, offline 차단을 합성 port로 확인한다. `server/gcp-configuration.test.ts`가 설정·조립 불일치를 확인한다.
- **남은 조건**: 실제 FCM 호출·서비스 계정의 사용자 조회/FCM 권한·Cloud Run의 요청 밖 CPU(최소 인스턴스·인스턴스 기반 과금)·Android `firebase-messaging`과 `PushTokenSource` factory·기기 수신은 미검증이다. Android FCM SDK 추가는 새 SDK 승인 대상이다. 공간 index는 등록마다 단일 레코드를 갱신하므로 대량 동시 등록 시 트랜잭션 경합이 있을 수 있다. 만료 단말의 주소/UID 레코드 보존·삭제는 실제 배포에서 결정한다.
