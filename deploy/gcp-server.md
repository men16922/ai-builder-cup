> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 서버 설정과 서비스 계정 연결

갱신: 2026-10-10. 로컬/Cloud Run용 credential adapter와 서버 설정 loader를 구현했다. 인증 프로토콜·Firestore transaction port·실제 HTTP composition은 합성 검증 범위이며 실제 Google 로그인·토큰 발급·IAM·원격 DB·Gemini·배포는 아직 검증하지 않았다.

## 구성 순서

1. [설정 예시](gcp-server.example.json)를 Git 밖의 서버 전용 파일에 준비한다. 예시의 프로젝트·UID·revision·Firebase 값은 모두 합성이며 그대로 실제 환경에 연결할 수 없다.
2. `projectId`와 Cloud Run service name/UID/revision을 고정한다. 모든 등록 자원은 이 대상 프로젝트에 속해야 한다. Firebase 프로젝트와 Firestore 프로젝트/DB/collection도 별도로 명시한다. 환경 변수나 CLI 기본 프로젝트로 추정하지 않는다.
3. `scopes`는 개인/조직별 한 작업 공간을 지정한다. 자원 binding의 owner/workspace가 일치해야 한다. 조직 membership은 기존 신원/역할 저장소에 관리자가 별도로 준비하며 기동 시 자동으로 계정·역할을 부여하지 않는다.
4. 아래 credential 방법 중 하나를 선택한다. 이 서비스 계정은 자원 조회·Firebase 관리 API·Firestore·선택적 Gemini 접근에 사용한다. 사용자의 웹 로그인 ID token과 구분한다.
5. 선택적 `telemetry.enabled`는 기본 false다. true일 때만 한 revision의 고정 15분 로그/지표를 조회한다. [수집 범위](gcp-telemetry.md)를 확인한다. `.env` 또는 기동 환경에 `MOBILEOPS_GCP_ENABLED=1`, `MOBILEOPS_GCP_CONFIG=/absolute/path/gcp-server.json`을 지정한다. `publicOrigin`은 웹을 여는 정확한 origin이며 로컬 Vite는 `http://127.0.0.1:5173`이다.
6. `npm run dev`는 기존 로컬 웹/API에 GCP 서비스를 주입한다. hosted API는 `MOBILEOPS_CLOUD_ENABLED=1 npm run api:cloud`로 별도 기동한다. GCP만 구성해도 시작하며 개인 AWS CLI/합성 데모 API를 열지 않는다. GCP만 공개하는 별도 `npm run build:gcp` 후보는 웹/API를 같은 서버에서 제공한다. [GCP 전용 후보](gcp-hosted/README.md)는 로컬/합성 검증까지이며 실제 배포는 남았다.
7. 선택적 `notifications: { "enabled": true, "androidPackage": "<고정 Android applicationId>" }`는 기본으로 없다(비활성). 켜면 같은 서비스 계정으로 Firebase Admin 사용자 조회·FCM data 전송 port와 hosted 프로세스 내부 worker를 조립한다. 공개 전송 API는 없다. [알림 계약](gcp-notifications.md)
8. Firebase의 Google 로그인 공급자와 웹 도메인, 대상 API·Firestore DB·IAM이 준비된 환경에서 [관측→분석→검토/명시적 실행→결과/인계](gcp-workflow.md)를 검증한다. 파일을 작성하거나 서버가 시작된 것만으로 연결 성공을 판정하지 않는다.

`model.enabled`는 예시에서 false다. 이때 새로운 Gemini 분석은 꺼지지만 이미 저장된 계획/검토·결과/인계를 계속 열 수 있다. true로 바꾸면 서버 고정 modelId/location으로 명시적 **분석과 계획 준비** 요청 때만 추론한다. 기동·목록 확인·검토·결과 재조회가 Gemini를 호출하지 않는다. 모델 가용 지역/버전·비용은 실제 대상에서 따로 확인한다.

## Cloud Run: 연결된 서비스 계정

```json
{
  "method": "metadata",
  "runtimeProjectId": "example-mobileops-demo",
  "serviceAccountEmail": "mobileops-runtime@example-mobileops-demo.iam.gserviceaccount.com"
}
```

고정 metadata server에서 현재 계정 이메일과 실행 프로젝트를 읽어 설정과 비교한 뒤 access token을 얻는다. 새 토큰을 받으면 계정/프로젝트를 다시 확인한다. 호출 URL·Metadata-Flavor 헤더를 고정하고 redirect/임의 endpoint를 허용하지 않는다. 토큰은 메모리에만 보관하며 만료 60초 전 갱신한다. 토큰을 캐시해도 현재 metadata 신원은 재확인한다.

이 경로는 Google 런타임의 신뢰된 metadata 환경을 전제로 한다. 로컬 PC에서는 동작하지 않는다. Cloud Run은 배포에 연결된 service identity의 토큰을 metadata에서 제공하며, Google은 사용자 관리 서비스 계정을 연결하도록 안내한다. [Google 서비스 신원 안내](https://docs.cloud.google.com/run/docs/securing/service-identity)

## 로컬: 명시한 사용자 인증 파일로 서비스 계정 위임

```json
{
  "method": "impersonated_user",
  "serviceAccountEmail": "mobileops-runtime@example-mobileops-demo.iam.gserviceaccount.com",
  "sourceFile": "/absolute/private/path/authorized-user.json"
}
```

이미 승인된 사용자 OAuth `authorized_user` 파일의 절대 경로를 지정한다. 파일은 서버 실행 사용자 소유의 일반 파일이며 그룹/다른 사용자 권한이 없어야 한다(예: 0600). symlink·다운로드한 서비스 계정 private key·credential 내부 URL/명령·임의 외부 계정 포맷은 받지 않는다. 파일/토큰 원문을 채팅·Git·로그에 넣지 않는다.

서버는 고정 OAuth endpoint에서 사용자 access token을 받고, 고정 IAM Credentials endpoint의 **설정된 서비스 계정**에만 600초 토큰을 요청한다. 사용자 토큰은 IAM 위임 요청에만 쓰고 Cloud Run/Gemini/Firestore 자원 요청에는 보내지 않는다. 위임 계정은 source 사용자에게 해당 token 발급 권한을 이미 허용해야 한다. 앱은 IAM 권한을 생성하거나 확대하지 않는다. [Google 위임 인증](https://docs.cloud.google.com/docs/authentication/use-service-account-impersonation) · [generateAccessToken 계약](https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken)

기본 gcloud 계정이나 well-known ADC 파일을 탐색하지 않고, `gcloud auth login`/CLI·전역 환경 변경을 실행하지 않는다. 인증 파일이 변경되거나 사라지면 캐시 토큰을 반환하지 않으며 서버 재구성이 필요하다. 새로운 로그인이 필요하면 사용자가 승인된 로컬 인증 절차로 파일을 준비해야 한다. source 사용자는 기동할 서버 운영자이며 대시보드에 로그인하는 각 사용자의 웹 신원과 별개다.

## 공통 인증/저장 경계

- 인증 HTTP는 5초·응답 32 KiB·고정 endpoint·redirect 거절·자동 재시도 없음이다. token type/형식/유효기간을 검사한다. 예외에는 upstream 원문/토큰/인증 파일 내용을 넣지 않는다. live factory는 `MOBILEOPS_OFFLINE_TEST=1`에서 파일/네트워크 호출 전에 차단된다.
- Firebase Admin에 이 token provider를 직접 주입하고 issuer/audience·서명·만료·회수를 검증한다. Firestore도 명시적인 GoogleAuth client를 주입하므로 GCP 구성에서 별도 ADC/다른 서비스 계정으로 바뀌지 않는다. 기존 AWS 조직 Firebase 구성은 별도 경로이며 회사 AWS 빌드에는 이 구현을 포함하지 않는다.
- Firebase/Firestore emulator를 live 구성으로 대체할 수 없다. public config는 Firebase 브라우저 설정과 workspace만 반환한다. 서비스 계정/credential 경로·Cloud Run UID·token·저장소 설정은 포함하지 않는다.
- owner의 userId와 membership의 actorId는 `identityActor('https://securetoken.google.com/<firebase-project>', '<Firebase UID>', tenantId ?? '')`가 계산한 값이다. 이메일이나 AWS SSO 토큰을 넣지 않는다. 조직 관리자는 `OrganizationWebAccess.provision`으로 지정 workspace/actor의 active·roles·증가하는 version을 준비한다. 공개 self-enrollment/권한 부여 API는 없다. [기존 웹 인증 구성](../docs/IDENTITY.md)
- 서버 Firestore client는 IAM으로 접근한다. 앱의 owner/membership 통제와 Firestore IAM은 별개이며, 브라우저 Security Rules가 서버 요청의 고객 격리를 대신하지 않는다. Firestore transaction의 재시도에는 모델·클라우드 API 호출이 들어가지 않는다. [Firestore 서버 권한](https://docs.cloud.google.com/firestore/native/docs/security/iam)
- 같은 hosted 프로세스에 AWS/GCP를 함께 구성할 때 publicOrigin이 같아야 한다. 설정·자격증명·SDK 조립 실패 시 해당 기동은 실패하며 개인 CLI나 합성 인증으로 대체하지 않는다. 종료 시 GCP token cache·Firestore client·전용 Firebase app을 닫는다.

## 실제 연결에서 확인할 권한과 비용

| 대상 | 현재 코드의 호출/준비 사항 |
| --- | --- |
| Cloud Run | 고정 서비스 `run.services.get`, 지정 revision `run.revisions.get`. 목록 전수 수집·변경 API 없음. [service get](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/get) · [revision get](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services.revisions/get) |
| 로컬 위임 | 설정한 서비스 계정의 `iam.serviceAccounts.getAccessToken`. 위임 chain이나 IAM 변경은 수행하지 않음. |
| 선택적 로그/지표 | `telemetry.enabled`일 때만 `logging.logEntries.list`·`monitoring.timeSeries.list`. 한 revision·고정 시간창/페이지 한도를 사용. [수집과 비용 범위](gcp-telemetry.md) |
| Firebase Auth | 지정 프로젝트/tenant의 서명된 ID token 및 회수 상태 검증. Google 웹 로그인 공급자/허용 도메인과 관리자 조회 접근을 준비. [ID token 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens) |
| 선택적 알림 | `notifications.enabled`일 때만 수신자별 Firebase Auth 사용자 조회(비활성화·회수 시각)와 FCM HTTP v1 `messages.send`. 서비스 계정의 사용자 조회·FCM 전송 권한과 Cloud Run의 요청 밖 CPU 할당(최소 인스턴스)을 별도 검토. 미검증. [FCM 서버 전송](https://firebase.google.com/docs/cloud-messaging/send-message) |
| Firestore | 지정 DB에서 transaction 시작/rollback과 문서 get/create/update. 현재 API는 문서 삭제·DB/인덱스 생성 없음. 위 Firestore IAM 표에서 필요한 권한을 검토. |
| Gemini | enabled일 때만 지정 프로젝트/model/location의 generateContent. 실제 모델 접근·사용량은 별도 확인. [모델 접근 제어](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/access-control) |

이 구성은 리소스 점검 대상에 대해 읽기만 수행하지만 앱 기록은 Firestore에 저장한다. 무료 사용량을 넘는 Firestore 읽기/쓰기·저장과 Gemini 추론, 배포한 런타임 사용량은 비용 검토 대상이다. 현재는 실제 프로젝트/서비스/비용 범위 답변 대기이며 인증 토큰 발급·Google API·배포를 실행하지 않았다. 인증/설정 코드를 작성한 것을 실제 연결이나 비용 보증으로 표현하지 않는다.

## 로컬 검증과 남은 작업

`server/gcp-credentials.test.ts`는 metadata principal/project/헤더·갱신/취소·위임 endpoint/범위·민감 파일/변경 거부·SDK 명시 인증·offline 차단을 합성 응답으로 검증한다. `server/gcp-configuration.test.ts`는 strict 파일/범위·기본 차단, GCP-only hosted HTTP와 Firestore transaction port의 검토/실행/인계, 모델 off 후 결과 재조회·재시도 중 외부 호출 0회를 확인한다. 이 저장 검사는 실제 원격 Firestore transaction이 아니다.

제한된 로그/지표 관측과 화면/모델 근거 연결은 합성 통합했다. 로그/지표까지 다시 읽는 확장 고정 실행도 합성 통합했다. 다음은 GCP 전용 모바일 흐름이다. 실제 로그인/Google API/IAM·비용·Gemini 품질·Firestore 지속성·배포는 지정 환경에서 별도로 확인해야 한다. 프로젝트/서비스/비용이 확정되면 이 설정 파일을 실제 값으로 준비하고 로그인→단일 서비스 관측→결과 저장부터 검증한다.
