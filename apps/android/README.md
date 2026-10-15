# Aide · GCP Android

차량 상태, 충전 문제, 지도 이동과 서비스 운영을 다루는 Kotlin/Compose 앱이다. 차량·배터리·운전은 서버에 저장하는 **시뮬레이션**이며 실제 차량을 제어하지 않는다. 장소 검색은 명시적으로 구성한 서버의 Gemini 검색 계획 → 공식 Google Maps MCP 흐름을 사용한다. 미구성·실패를 예제 데이터로 대체하지 않는다.

새 개발자는 [ONBOARDING.md](ONBOARDING.md)부터 읽는다. 현재 개발 상태와 배포 여부는 [STATUS](../../docs/STATUS.md)를 확인한다. 에뮬레이터 검증은 실물 휴대폰 검증과 별개다.

## MVVM과 파일 책임

| 계층 | 파일 / 디렉터리 | 책임 |
| --- | --- | --- |
| 조립 | `MainActivity`, `data/AppContainer` | 플랫폼 의존성 주입, Activity에서 Google 로그인·알림 권한 처리 |
| 상태 | `MobileViewModel`, `OnboardingViewModel`, `mobility/VehicleViewModel` | 불변 상태와 명명된 사용자 작업. Context/Activity를 보관하지 않음 |
| UI | `MobileOpsApp`, 각 기능 Screen, `mobility/` | 상태 표시와 callback. 직접 서버 호출·권한 생성 없음 |
| 데이터 | `core/.../data/MobileRepository`, `DefaultMobileRepository` | 신원, 세션, 업무·에이전트·알림 coordinator 조립 |
| 차량 | `core/.../mobility/` | strict DTO, typed command, 세션 세대와 늦은 응답 차단 |
| 전송 | `core/Client`, `FirebaseIdentity`, `LiveAccess` | 고정 HTTPS 서버, 매 요청 bearer, 신원·공간·응답 검증 |

영문은 `res/values/strings.xml`, 한국어는 `res/values-ko/strings.xml`이다. Android가 기기의 언어 목록에 따라 선택하고 지원하지 않는 언어는 기본 영문을 사용한다. 국가·언어는 계정이나 권한을 고르지 않는다. 수동 언어 토글과 UI의 Korean/English 분기를 제거했다. Agent 요청 언어도 동일한 resource에서 얻는다.

첫 실행 안내는 세 페이지로 구성한다. 건너뛰기·완료 여부만 앱 preferences에 저장하며 설정에서 다시 볼 수 있다. 미완료 상태는 다음 실행에 다시 표시한다. UI/ViewModel/Repository의 책임과 보안 경계를 주석으로 설명한다.

## 실행과 데이터 경계

- 로그인·workspace membership·operator/reviewer 권한은 서버에서 검증한다. 앱 설정이나 표시 모드로 권한을 만들 수 없다.
- 앱 시작과 설정 읽기는 Firebase 로그인이나 서버 요청을 시작하지 않는다. 사용자 로그인 버튼에서 SDK를 초기화한다.
- HTTP redirect, 응답 캐시, 자동 변경 retry를 사용하지 않는다. 계정·공간 변경/로그아웃 때 이전 화면을 지우고 늦은 응답을 버린다. 복귀·새로고침은 GET이며 실행을 재개하지 않는다.
- 차량 조치는 고정된 simulated charging runbook만 가능하다. 최초에는 사람 선택, 명시적으로 켠 정책은 24시간. 서버는 최신 온도·정차·episode·버전·시도 횟수를 다시 확인한다. 모르는 상황은 조치하지 않고 보고한다.
- 목적지는 처음에 선택한다. Favorite 또는 7일의 동일 맥락 선택 동의만 서버가 재사용한다. 이동은 취소 가능한 지도 시뮬레이션이다.
- Google Maps MCP의 설명과 출처 링크를 함께 보여준다. 충전기 이용 가능 수가 없으면 미확인으로 표시한다. 지도 데이터를 모델 학습이나 사례 학습에 사용하지 않는다. 보관 기한과 재초기화는 개인정보 안내에 표시한다.
- 테스트의 synthetic fixture는 ViewModel에 주입한다. 제품 화면에는 합성 시연 실행 버튼이 없다.

기존 업무의 원본 근거 패널은 실제 관측된 0, 빈 부분 결과, 누락/미수집을 구분한다. 준비 상태·조회 성공을 서비스 정상으로 표현하지 않는다. 검토와 실행 확인은 별도 작업이며 알 수 없는 실행 결과를 자동으로 재전송하지 않는다.

## 도구와 검증

Gradle 8.13, AGP 8.13.2, Kotlin/Compose compiler 2.2.21, Compose BOM 2025.08.01, Maps Compose 6.8.0, SDK 36, Build Tools 35.0.0, min SDK 26. JDK 21로 JVM 17 bytecode를 만든다.

최초 SDK·의존성 준비는 게이트와 별도로 수행한다. 소유자 머신의 `.tools/android-sdk`, `.tools/gradle-home`은 Git에서 제외한다. 준비 후 저장소 루트에서:

```sh
make check-android-core
ANDROID_HOME="$PWD/.tools/android-sdk" GRADLE_USER_HOME="$PWD/.tools/gradle-home" apps/android/gradlew -p apps/android --offline :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
# 연결한 에뮬레이터/시험용 단말에서:
ANDROID_HOME="$PWD/.tools/android-sdk" GRADLE_USER_HOME="$PWD/.tools/gradle-home" apps/android/gradlew -p apps/android --offline :app:connectedDebugAndroidTest
```

`make check-android-core`는 실제 로컬 gateway와 Kotlin native HTTP 계약을 합성 신원/관측으로 연결한다. 직접 `:core:test`만 실행하면 서버 통합 네 개는 주소가 없어 skip될 수 있다. 웹/서버 게이트는 Android 빌드·기기 검증을 대신하지 않는다.

통화 초안의 시간·본문 회귀는 `CallDraftRenderingTest`에서 확인한다. 고정 합성 자료의 금요일 07:30 UTC가 서울 시간 `Fri 16:30` / `금 16:30`으로 보이는지, 본문·수신자가 유지되는지, 버튼이 정확한 명령만 내보내는지 검사한다. 로그인·네트워크·실제 전송은 하지 않는다. 기본 합성 자료와 별도로 받은 Gemini 요약 재생은 서로 다른 검증이며, 전체 앱이나 실물폰 검증을 대신하지 않는다.

공유 기기의 앱을 덮어쓰지 않도록 새 전용 에뮬레이터에서 실행한다. 준비된 SDK·Gradle 의존성으로 테스트 APK를 빌드한 뒤, 명시한 기기에만 설치한다. 이 화면 검증에는 비공개 앱 설정이나 지도 키가 필요하지 않다.

```sh
ANDROID_HOME="$PWD/.tools/android-sdk" GRADLE_USER_HOME="$PWD/.tools/gradle-home" apps/android/gradlew -p apps/android --offline :app:assembleDebug :app:assembleDebugAndroidTest
# AIDE_ANDROID_TEST_SERIAL에 직접 만든 전용 에뮬레이터의 serial을 지정한다.
: "${AIDE_ANDROID_TEST_SERIAL:?Set the exclusive test emulator serial}"
.tools/android-sdk/platform-tools/adb -s "$AIDE_ANDROID_TEST_SERIAL" install -t apps/android/app/build/outputs/apk/debug/app-debug.apk
.tools/android-sdk/platform-tools/adb -s "$AIDE_ANDROID_TEST_SERIAL" install -t apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
.tools/android-sdk/platform-tools/adb -s "$AIDE_ANDROID_TEST_SERIAL" shell am instrument -w -r -e class app.mobileops.agent.app.CallDraftRenderingTest app.mobileops.agent.test/androidx.test.runner.AndroidJUnitRunner
```

선택 인수 `aideSummaryFixtureBase64`는 합성 입력으로 따로 받은 `CallSummary` JSON만 재생한다. 계정·설정·실제 통화 자료를 전달하지 않는다. 캡처는 앱 외부 파일 디렉터리의 `verification/summary-draft-{en,ko}-{message,calendar}.png`에 남는다. 15 October 검증은 실제 Gemini 요약 재생 두 개와 기본 합성 자료 두 개가 각각 통과했으며, 전용 에뮬레이터만 사용했다. 추가 모델 호출은 없었다.

### 실제 Maps SDK 확인 — 별도 opt-in

`NativeMapProviderSmokeTest`는 기본 실행에서 skip한다. 승인된 제한 키를 `AIDE_ANDROID_MAPS_KEY`에 설정하고 시험용 에뮬레이터 한 대를 연결한 뒤에만 아래 명령으로 실제 Google 지도 로딩을 확인한다. SDK의 로딩 완료 콜백을 기다린 후 제품의 `VehicleMap`을 렌더링한다. 좌표·목적지는 공개된 합성 시험 위치이며 로그인, GPS 조회, Gateway 요청과 차량·클라우드 조치는 하지 않는다. `--offline`은 Gradle 의존성 해석에만 적용되며, 이 시험은 Google 지도 네트워크를 사용한다.

```sh
ANDROID_HOME="$PWD/.tools/android-sdk" GRADLE_USER_HOME="$PWD/.tools/gradle-home" \
  apps/android/gradlew -p apps/android --offline \
  -Pandroid.testInstrumentationRunnerArguments.aideLiveMaps=true \
  -Pandroid.testInstrumentationRunnerArguments.class=app.mobileops.agent.app.NativeMapProviderSmokeTest \
  -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true \
  :app:connectedDebugAndroidTest
mkdir -p .data/captures
.tools/android-sdk/platform-tools/adb pull \
  /sdcard/Android/data/app.mobileops.agent/files/verification/native-google-maps-provider.png \
  .data/captures/native-google-maps-provider.png
```

테스트 APK를 남기는 옵션이 없으면 Gradle의 종료 정리가 캡처도 삭제할 수 있다. XML의 `tests=1`, `failures=0`, `errors=0`, `skipped=0`과 실제 캡처를 함께 확인한다. 15 October 2026에는 API 36 에뮬레이터에서 SDK 로딩, 실제 타일, 차량 마커와 직선 시뮬레이션 경로를 확인했다. 이 결과는 실물 폰 로그인·주행·차량 제어 검증을 대신하지 않는다. 키·APK·캡처는 Git에 넣지 않는다.

`.editorconfig`는 4칸 들여쓰기를 지정한다. 공식 ktfmt 0.65 jar를 별도로 준비한 뒤 `scripts/format-kotlin.sh` 또는 `--check`를 사용한다. SHA-256을 검증하며 formatter 명령은 다운로드하지 않는다. `Theme.kt`는 `design/tokens.json`의 생성 파일이므로 formatter에서 제외한다.

## 비공개 설정과 지도 키

고정 설정은 `app/src/main/assets/mobileops-agent.json`에 패키징한다(Git 제외). [설정 예시](../../deploy/android-mobile.example.json)를 실제 설정으로 그대로 사용하지 않는다. HTTPS origin, Firebase Android app/API key, Web OAuth client ID와 workspace만 담는다. 서비스 계정 key나 CLI token을 넣지 않는다. 설정이 없으면 로그인을 켜지 않고, 잘못된 설정은 고정 오류만 표시한다.

Android Maps SDK 키는 **`AIDE_ANDROID_MAPS_KEY` 빌드 환경 변수**로 제공한다. Manifest에 들어가는 공개 SDK 키는 Maps SDK for Android API와 `app.mobileops.agent` 패키지·설치 APK의 SHA-1로 제한해야 한다. 키가 없는 빌드는 Google map을 초기화하지 않는다. 웹 지도 키와 서버 OAuth 토큰을 재사용하지 않는다. 상세: [Google Maps 연결](../../docs/MAPS.md).

Firebase SDK는 인증 상태를 앱 내부에 저장할 수 있다. 정상 로그아웃은 Firebase signOut과 Credential Manager 정리를 호출하고 앱 백업을 비활성화한다. 전체 인증의 메모리 전용 보관, 내부 파일의 안전 삭제나 원격 세션 회수를 보장하지 않는다.

FCM source adapter는 사용자 opt-in 후에만 조립한다. 주소는 서버의 비공개 단말 기록이며 업무·감사 payload에 넣지 않는다. 등록/해제 수명주기와 ID-only 알림 조회는 검증했지만 실제 push 수신·물리 단말 접근은 별도 검증 대상이다. 배포에서 알림이 꺼져 있으면 로그인만으로 켜지지 않는다.
