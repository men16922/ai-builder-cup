# Aide · GCP Android

Kotlin/Compose 앱 소스와 GCP 모바일 클라이언트다. 기본 앱은 **합성 시연 전용**이다. 선택적으로 고정 서버 설정·Credential Manager/Google → Firebase 신원 adapter·로그인 UI를 조립했다. Kotlin 신원/서버 HTTP 계약은 합성 검증했다. 2026-10-11~12 기준 `assembleDebug`·`lintDebug` 통과, 에뮬레이터에서 실제 Google 로그인과 배포 서버의 crew 흐름 확인. 실기기 검증과 FCM 실수신은 아직 없다.

**새로 합류했다면 [ONBOARDING.md](ONBOARDING.md)부터 읽는다** (환경 점검: `scripts/doctor.sh`).

## 현재 동작과 구조

- `core/Contract.kt`: GCP 전용 owner/workspace/target·고정 action·근거/결과/Inbox 계약. 다른 provider·owner, 확장 입력 변경, 계획과 결과 불일치를 거부한다.
- `core/OriginalEvidence.kt`: 원본 서비스/revision·트래픽 배분·고정 15분 로그/지표를 strict DTO로 검증한다. 대상/UID/출처·관측 시각·50개 로그/120개 metric points·안전 정수/중복을 검사하며 로그 본문·URL·IP·임의 JSON을 받지 않는다. 준비 상태/조회 전후 변경과 서비스 정상 여부를 분리한다.
- `core/Client.kt`: 신원 port에서 매 요청 토큰을 받고, [모바일 API](../../docs/archive/runbooks/mobile.md)에 native bearer 요청한다. HTTPS 기본, 테스트에서만 명시적 loopback HTTP. redirect/응답 캐시/자동 retry 없음, 응답 2 MiB 제한. 서버 오류 원문·토큰을 기록하지 않는다.
- `core/Controller.kt`: Inbox/상세/검토/명시적 실행/결과/인계 상태. 실패/권한 변경 때 이전 데이터를 숨긴다. 세션 전환·background 이후 늦은 응답을 버린다. 응답 유실 시 최신 GET 후 같은 요청 키/본문으로만 명시적 재확인한다. 프로세스 재시작 시 저장한 실행 명령은 없다.
- `core/FixtureApi.kt`: 개인/조직 각각 오류 표본·빈 표본·지연 권한 거절의 메모리 시연. 실제 API/AI/클라우드가 아니다. 예제 시각은 **2026-10-10 01:00 UTC**로 고정된다. `scripts/generate-mobile-fixtures.ts`가 현재 서버 Zod 스키마/근거 변환기로 자산을 생성한다.
- `core/Configuration.kt`, `FirebaseIdentity.kt`, `LiveAccess.kt`: strict 공개 설정, 서버와 같은 issuer/tenant/UID → actor 계산, 토큰 issuer/audience/subject/tenant/기한 확인, 명시적 로그인과 세션 교체·취소 처리. 이 검사는 서버의 서명·회수·membership 검증을 대신하지 않는다.
- `app/`: 한/영 공간 선택 → 검토 대기/결과/전체 Inbox → 대상·근거 → 검토 → 별도 읽기 버튼 → 결과·인계. ViewModel은 activity 재생성을 유지하고 재진입 시 GET으로 다시 확인한다. 로그아웃/시연 전환은 진행 중 로그인을 취소한다. 앱 자체의 저장 설정은 언어뿐이며 근거·메모·실행 키·토큰을 별도 파일이나 SavedState에 복사하지 않는다. Firebase SDK의 내부 인증 저장은 아래와 구분한다.

화면의 검토는 회사 승인이 아니며 조회 완료는 서비스 정상을 의미하지 않는다. 예제 분석/완료 기준은 생성 당시 영문 원문이며 UI 언어와 별개다. 실제 분석 언어는 웹에서 준비할 때 결정된다. Google Cloud 이미지는 기존 [provider 자산 출처](../../reference/provider-icons.md)를 따른다.

## 상세에서 확인할 근거

`EvidencePanel.kt`는 계획을 준비한 원본 관측의 서비스·지정 revision 준비, 조회 전후 변경, 트래픽 배분 막대와 요청/5xx/p95 카드·응답 코드별 막대·안전한 로그 표본을 표시한다. 기본 로그는 5개, 펼치면 수집된 최대 50개이며 추가 API는 호출하지 않는다. 배포 세부와 출처도 펼칠 수 있다. 이후 실행 결과와 원본 관측을 구분한다. **Compose 소스는 작성했으나 Android 컴파일/기기 시각 검증 전이다.**

수치는 웹의 `summarizeTelemetry`와 같은 계산이다. 실제 수집된 0, 일치 표본 없음, 빈 부분 페이지, 거절/미수집을 구분한다. 5xx series가 없으면 오류 0으로 채우지 않으며 p95는 분·응답 코드별 값의 최댓값이다. 전체 요청 수·오류율·시간창 전체의 p95로 표현하지 않는다. 원본이 검증을 통과하지 못하면 이전 상세/근거와 검토 확인을 해제한다.

## 도구와 검증

고정 버전: Gradle **8.13**, Android Gradle Plugin **8.13.2**, Kotlin/Compose compiler **2.2.21**, Compose BOM **2025.08.01**, compile/target SDK **36**, Build Tools **35.0.0**, min SDK **26**. 현재 JDK **21**로 JVM 17 bytecode를 만든다. AGP/Kotlin 플러그인은 root의 동일 classpath에서 로딩한다.

공식 근거: [AGP 호환표](https://developer.android.com/build/releases/agp-8-13-0-release-notes), [Kotlin과 Compose compiler 버전](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler), [Compose BOM](https://developer.android.com/develop/ui/compose/bom/bom-mapping), [Gradle Java 21 지원](https://docs.gradle.org/8.5/release-notes.html).

Gradle wrapper는 공식 배포의 SHA-256을 고정한다. 최초 의존성 준비는 게이트와 별도로 수행한다. 저장소 루트에서:

```sh
GRADLE_USER_HOME="$PWD/.tools/gradle-home" apps/android/gradlew -p apps/android -PcoreOnly=true :core:test
make check-android-core
```

첫 명령은 의존성을 다운로드할 수 있다. 둘째는 TypeScript 도구 타입 검사와 `generate-mobile-fixtures.ts --check`의 재생성 일치 확인 후 `--offline` Gradle을 실행한다. 게이트는 fixture를 덮어쓰지 않는다. 최신 검증은 **49개**(원본 근거 6, 신원/설정 9, 클라이언트/상태 14, 알림 core/수명주기 16, 실제 로컬 HTTP 4)다. 서버 스키마/웹 실제 요약 계산으로 생성한 11종 벡터를 Kotlin 결과와 대조한다. 임시 SQLite/GCP HTTP 서버와 Kotlin 클라이언트가 연결되며 신원/관측/모델은 합성이다. 조직과 개인 공간에서 각각 준비 1회 + 명시적 실행 1회로 총 4회 수집하고 인계·같은 요청·재접속으로 늘지 않는다. Firebase 서명 검증 SDK는 합성 port로 대체한다. `:core:test`만 직접 실행하면 서버 통합 4개는 환경 주소가 없어 skip되므로 전체 모바일 계약 검증에는 `make check-android-core`를 사용한다.

기존 웹/서버 전체 회귀는 `make check`이며 Android 검증을 대체하지 않는다. SDK나 의존성을 게이트 안에서 설치하지 않는다.

## 업무 알림 수명주기

`NotificationLifecycle.kt`는 명시적 enable·token 갱신·같은 등록 요청 재확인·해제의 coordinator다. 로그인은 source를 만들지 않으며 기본 앱에는 실제 FCM source factory가 없다. 정상 로그아웃은 현재/진행 중 등록 요청 키를 retire한 뒤 신원을 닫고, 해제 미확인은 별도로 표시한다. Intent entry는 최소 ID만 받아 로그인한 공간에서 최신 업무를 여는 버튼으로 연결했다. 화면/manifest 소스의 APK/기기 검증은 남아 있다. [API·저장·앱 계약](../../docs/archive/runbooks/notifications.md)을 따른다.

## Android SDK와 APK

SDK는 사용자 동의 후 저장소 로컬 `.tools/android-sdk`에 설치되어 있다(소유자 머신 전용, Git 제외). 새 환경은 [ONBOARDING.md](ONBOARDING.md) 3단계를 따르며 약관은 본인이 수락한다.

동의 후 공식 command-line tools를 확인된 아키텍처에 맞게 설치한다. Mac ARM의 조사 시점 파일은 `commandlinetools-mac_arm64-15859902_latest.zip`, SHA-256 `835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e`다. [공식 다운로드 표](https://developer.android.com/studio#command-tools)에서 실행 시 다시 확인한다. 플랫폼/도구는 `sdkmanager --sdk_root=… "platforms;android-36" "build-tools;35.0.0" "platform-tools"`로 지정한다. 라이선스 파일을 위조하거나 일괄 자동 동의하지 않는다.

SDK 준비 후 저장소 루트에서:

```sh
ANDROID_HOME="$PWD/.tools/android-sdk" GRADLE_USER_HOME="$PWD/.tools/gradle-home" apps/android/gradlew -p apps/android :app:assembleDebug :app:lintDebug
# 에뮬레이터/시험용 기기를 확인한 뒤에만:
ANDROID_HOME="$PWD/.tools/android-sdk" GRADLE_USER_HOME="$PWD/.tools/gradle-home" apps/android/gradlew -p apps/android :app:connectedDebugAndroidTest
```

기기 테스트 소스는 한/영 개인·조직 선택, 검토 전 버튼 차단, 별도 명시적 실행, 인계, activity 재생성, 오프라인/재접속을 포함한다. **작성과 통과는 다르다.** 아직 실행하지 못했다. 실제 화면 크기·폰트 확대·회전·TalkBack·프로세스 종료/재진입은 빌드 후 확인한다.

## 선택적 서버 연결 설정

현재 실제 설정 파일은 없다. 자산이 없거나 내용이 정확히 `{"configured":false}`이면 로그인 기능을 켜지 않는다. 잘못된 설정은 고정 오류만 표시하며 원문을 출력하지 않는다. 앱 시작·설정 읽기·합성 시연에서는 Firebase SDK나 HTTP 클라이언트를 만들지 않는다.

실제 대상/비용 범위를 확정한 뒤 [합성 설정 예시](../../deploy/android-mobile.example.json)의 값을 교체해 `app/src/main/assets/mobileops-agent.json`에 패키징한다. 파일은 Git에서 제외한다. 예시를 그대로 복사해서 실제 연결로 사용하지 않는다.

1. `origin`: [GCP 모바일 API](../../docs/archive/runbooks/mobile.md)를 제공하는 고정 HTTPS origin. 경로·사용자 정보·query·fragment·443 이외 포트는 거부한다. 앱 화면에서 임의 주소를 받지 않는다.
2. `firebase`: 서버 verifier와 같은 projectId/선택적 tenantId, 해당 Android 앱의 공개 apiKey/appId, Google 로그인용 **Web OAuth client ID**. 서비스 계정/private key/CLI·SSO token은 넣지 않는다. Android 등록·서명 인증서 SHA 및 Google 로그인 제공자 설정은 실제 Firebase 프로젝트에서 별도로 준비한다. [공식 Android Google 로그인 구성](https://firebase.google.com/docs/auth/android/google-signin)
3. `workspaces`: 개인/조직 모드·workspaceId·조직이면 organizationId·표시 label. 개인 actor는 실제 Firebase 신원에서 계산하며 설정으로 지정하지 않는다. 조직 membership/role과 등록 자원은 서버에서 준비한다. 이 파일은 권한을 부여하지 않는다.

사용자는 작업 공간의 Google 로그인 버튼을 누른 뒤 계정을 선택한다. Credential Manager의 Google credential을 Firebase 신원으로 교환하고 **Firebase ID token**을 모바일 API에 전달한다. 선택마다 별도의 named FirebaseApp을 소유하고 취소/사용자 변경 시 기존 화면을 해제한다. 늦은 이전 로그인 결과가 새 공간을 연결하지 못하도록 세션 세대를 확인한다. 로그인 실패를 예제 데이터로 대체하지 않는다.

Firebase BOM 34.4.0(Auth 24.0.1)·Credential Manager 1.3.0·Google ID 1.1.1·coroutines play-services 1.10.2를 고정했다. Gradle 의존성 그래프는 해석됐지만 Android 컴파일 통과 근거는 아니다. default FirebaseInitProvider는 제거하며 명시적 버튼에서만 SDK를 초기화한다.

**저장 경계:** Firebase Android SDK는 인증 상태를 앱 내부 저장소에 관리할 수 있다. 따라서 전체 인증이 메모리에만 존재한다고 보장하지 않는다. 정상 로그아웃은 Firebase `signOut`과 Credential Manager 상태 정리를 호출하고 앱 백업은 비활성화한다. 강제 종료 시 SDK 잔여 저장·실기기 백업/복원은 아직 검증하지 않았다. SDK 내부 파일의 안전 삭제나 원격 세션 회수 완료로 표현하지 않는다. [FirebaseAuth 저장/로그아웃 계약](https://firebase.google.com/docs/reference/android/com/google/firebase/auth/FirebaseAuth#signOut())

실제 Firebase/Google 로그인·토큰 회수·TLS API·기기 상태 일치는 지정 프로젝트에서 검증해야 한다. GCP 알림 저장·단말 API·전송 port와 Kotlin의 ID-only data/최신 조회 core는 합성 연결했다. 등록 수명주기 core·앱의 명시적 열기/상태 UI 소스를 조립했다. 서버 측 수신자 매핑·FCM 전송 adapter·worker는 조립했으나 앱의 FCM source factory/SDK(새 SDK 승인 필요)·APK/기기 수신은 아직 없다. [알림 계약](../../docs/archive/runbooks/notifications.md)과 [전체 완료 기준](../../docs/plans/2026-10-10-gcp-android.md)을 따른다.
