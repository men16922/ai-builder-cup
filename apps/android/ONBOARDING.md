# Android 온보딩 (Aide)

Android 팀원을 위한 안내서입니다. 1~5단계는 소유자에게 받을 것 없이 바로 시작할 수 있고, 6단계(실서버 로그인)는 소유자에게 세 가지를 받아야 합니다("소유자에게 받을 것" 참고).

**일정:** 제출물은 **2026-10-17에 동결**하고, 18일은 업로드와 접근 확인에 씁니다. 실기기 점검은 **14일까지** 끝내고, 15~16일은 수정에 쓰는 것을 목표로 합니다.

**2026-10-14 업데이트:** 팀원의 SHA-1과 SHA-256을 Firebase에 등록하고 재조회로 확인했습니다. Google 로그인으로 계정이 생성됐으며, 없었던 조직 멤버십도 `operator`·`reviewer`로 등록하고 Firestore에서 확인했습니다. 앱을 완전히 닫았다 열고 **CloudOps demo team 조직 워크스페이스**로 다시 로그인한 뒤 6~7단계를 진행하세요. 실제 앱 접근과 실기기 흐름은 아직 별도 검증이 필요합니다.

## 맡은 일 (한 문장)

**실제 Android 폰**에서 처음 쓰는 당직자처럼 Aide를 사용합니다. Google 로그인부터 승인 후 결과 확인까지, 앱을 닫았다 다시 열기와 승인 버튼 더블탭을 포함해 끝까지 해 보고, 막히는 것은 고치고, 본 것을 기록합니다.

15일에는 차량·지도 도메인으로 확장한 소스가 로컬에 있습니다. 원격에 아직 게시하지 않았으며 실서버 배포도 별도입니다. 검증 후보를 받을 때 revision과 APK를 함께 확인하세요.

## Aide가 무엇인가 (2분)

당직 엔지니어가 노트북 없이 자리를 비운 상황입니다. 폰에 "쇼핑몰이 느려, 조사해 줘" 같은 지시를 입력하면 AI 에이전트 4개(Chief, Diagnosis, Guardian, Ops)가 Cloud Run 서비스의 제한된 근거를 읽고 조치를 제안합니다. 조치가 무언가를 바꾸는 경우(예: 트래픽 롤백)에는 **사람이 폰에서 승인해야** 하며, 서버는 승인된 그 변경만 수행한 뒤 결과를 다시 읽어 확인합니다.

앱이 절대 하면 안 되는 것입니다. 이것을 "고치지" 마세요.
- 신원·역할·워크스페이스를 앱이 스스로 정하지 않습니다. 검증된 Google 토큰으로 서버가 정합니다.
- 작업을 열기·새로고침·재생하는 것만으로 변경이 시작되면 안 됩니다. 명시적 승인만 변경을 시작합니다.
- 근거가 없으면 "없음"으로 보여 줍니다. 0이나 정상으로 채우지 않습니다.
- 실행 상태 5개는 서로 다릅니다: `refused`(거절), `pending`(진행 중), `applied`(적용됨), `failed`(실패), `unknown`(결과 불명). 끝나지 않은 변경을 거절로 보이면 안 되고, `unknown`은 자동으로 다시 보내지 않습니다.

## 1. 코드 받기와 오프라인 점검 (계정 불필요)

```sh
git clone <REPO_URL>      # 소유자가 링크를 알려 줍니다 (저장소 이름: ai-builder-cup)
cd ai-builder-cup
npm ci
apps/android/scripts/doctor.sh      # 무엇이 부족한지 정확히 알려 줍니다
```

필요한 것: **JDK 21**, **Node.js 24 이상**. `doctor.sh`는 읽기만 합니다. 아무것도 설치하지 않고 라이선스도 대신 수락하지 않습니다. (출력 메시지는 영어입니다.)

## 2. 읽을 문서 (순서대로, 약 20분)

1. `README.md` (위쪽의 "What is verified": 무엇이 검증됐고 무엇이 안 됐는지)
2. `apps/android/README.md` (구조, `core/`와 `app/`의 경계, 저장 경계)
3. `docs/NEXT_PLAN.md`의 "Priority 2: people and impact evidence"(맡은 일)과 "Priority 4"(소유자 작업)
4. `docs/IDENTITY.md` (앱이 클라이언트가 보낸 역할을 믿지 않는 이유)

`docs/STATUS.md`와 `docs/PROGRESS_LOG.md`는 지금까지의 기록입니다.

## 3. Android SDK 설치 (라이선스는 본인이 직접 수락)

Android Studio가 가장 쉽습니다. 설치한 뒤 SDK Manager에서 **Android 16 / API 36**, **Build Tools 35.0.0**, **Platform-Tools**를 설치하고 라이선스 동의 창에서 직접 수락하세요. 그다음:

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"     # 본인 SDK 경로
export GRADLE_USER_HOME="$PWD/.tools/gradle-home"   # Gradle 파일을 저장소 안에 둡니다 (Git 제외)
apps/android/scripts/doctor.sh
```

Android Studio 없이 하려면 <https://developer.android.com/studio#command-tools>의 command-line tools로 `sdkmanager "platforms;android-36" "build-tools;35.0.0" "platform-tools"`를 실행합니다. 라이선스 수락을 스크립트로 자동화하지 마세요.

고정 버전(함부로 올리지 마세요): Gradle 8.13, AGP 8.13.2, Kotlin/Compose compiler 2.2.21, Compose BOM 2025.08.01, compileSdk/targetSdk 36, minSdk 26.

## 4. 빌드와 테스트

저장소 루트에서:

```sh
make check-android-core                                                # Kotlin core + 로컬 HTTP, 실제 gateway 코드 상대로 core 계약 테스트
apps/android/gradlew -p apps/android :app:assembleDebug :app:lintDebug # APK + lint (오류 0 예상)
```

APK 위치: `apps/android/app/build/outputs/apk/debug/app-debug.apk`. 15일 후보의 MVVM/resources/tutorial/Maps-key 빌드·lint·core와 에뮬레이터 검증은 STATUS에 기록합니다. 실물 폰 결과는 별도입니다.

`make check-android-core`는 Gradle 의존성이 미리 받아져 있어야 합니다. 처음에는 네트워크가 되는 상태에서 `assemble` 줄을 한 번 먼저 실행하세요. `build/`, `.gradle/`, `local.properties`, 키스토어, 비공개 설정 파일은 Git에서 제외되어 있으니 커밋하지 마세요.

## 5. 합성 시연을 폰에서 실행 (로그인·서버 불필요)

1. 폰: 설정 > 휴대전화 정보 > 빌드 번호를 7번 탭 → 개발자 옵션 > **USB 디버깅** 켜기.
2. USB로 연결하고 폰의 허용 창을 수락합니다. `$ANDROID_HOME/platform-tools/adb devices`에 `device`로 보여야 합니다.
3. `apps/android/gradlew -p apps/android :app:installDebug`
4. Aide를 열고 **개인 시연 시작**을 누릅니다. 스크립트로 짠 가짜 crew가 롤백 승인 1건을 보여 줍니다. UI가 동작함을 보여 줄 뿐 실서버에 대해서는 아무것도 증명하지 않습니다.

에뮬레이터로도 이 단계는 가능합니다. 소유자 머신의 `.tools/android-avd`는 공유되지 않으니 Android Studio에서 API 36 이미지를 직접 만드세요.

## 6. 실서버 로그인 (소유자에게 세 가지가 필요)

### 소유자에게 받을 것

1. **`mobileops-agent.json`**: 비공개 앱 설정(서버 주소, Firebase 앱 ID와 키, 웹 클라이언트 ID)입니다. `apps/android/app/src/main/assets/mobileops-agent.json`에 넣으세요. Git에서 제외되어 있으며, 커밋하거나 채팅에 붙여 넣거나 첫 화면 스크린샷(서버 주소가 보입니다)을 공유하지 마세요. `deploy/android-mobile.example.json`은 자리표시자라 **동작하지 않습니다**.
2. **내 debug 인증서의 Firebase 등록.** 구글은 앱 패키지 `app.mobileops.agent`**와 서명 인증서 SHA-1**이 등록되어 있어야 토큰을 발급합니다. 팀원 PC의 debug 키스토어는 소유자 것과 다릅니다. 첫 빌드 후 `apps/android/scripts/doctor.sh`를 실행해 출력되는 `SHA1`, `SHA256` 줄을 소유자에게 보내세요. 공개 지문이라 비밀이 아닙니다. 키스토어 파일 자체는 절대 보내지 마세요. 등록 전에는 "This android application is not registered to use OAuth2.0" 오류가 납니다.
3. **내 Google 계정의 서비스 접근 허용.** 접근은 서버가 "등록된 Cloud Run 서비스의 소유 여부"로 결정합니다(`crew_not_entitled`는 아직 허용되지 않았다는 뜻). 팀원은 조직 워크스페이스(**CloudOps demo team**)의 멤버(operator, reviewer)로 허용됩니다. 개인 워크스페이스는 소유자 계정 전용이라 쓰지 않습니다. 허용은 계정이 Firebase에 한 번 생긴 뒤에만 가능하므로, 먼저 웹 콘솔(소유자가 알려 주는 배포 주소)에서 사용할 Google 계정으로 **한 번 로그인**하고 소유자에게 알리세요.

### 그다음

1. `apps/android/gradlew -p apps/android :app:installDebug` → 앱을 열고 **조직 워크스페이스(CloudOps demo team)**의 Google 로그인 버튼을 누릅니다.
2. 지시를 입력합니다. 예: "shop-api가 느려, 조사해 줘". 시연 대상을 장애 상태로 만드는 `apps/shop-api/reset.sh <project>`와 트래픽 생성 `apps/shop-api/traffic.sh <url>`은 소유자가 실행합니다. 대상이 공유되는 실제 Cloud Run 서비스이므로, 실행 전에 소유자에게 부탁하세요.

## 7. 실기기 점검 (최종 산출물)

앱을 처음 보는 사람처럼 진행하세요. 점검 중에는 코드를 읽지 말고, 망설인 지점을 메모하세요.

| # | 단계 | 기대 결과 |
|---|---|---|
| 1 | Google로 로그인 | 워크스페이스에 들어가고, 이전 계정의 데이터가 남아 있지 않음 |
| 2 | 지시 전송 | 단계가 하나씩 나타남 |
| 3 | 승인 카드 열기 | 무엇이, 어느 서비스에서 바뀌는지, 확인되지 않은 것이 무엇인지 알 수 있음 |
| 4 | 승인을 **한 번** 누름 | 상태 줄이 5개 상태 중 하나를 보여 줌 |
| 5 | 승인을 **빠르게 두 번** 탭 | 변경은 한 번만 일어남. 두 번째 탭은 아무 일도 안 하거나 저장된 같은 결과를 보여 줌 |
| 6 | 작업 중 홈 버튼, 다시 복귀 | 상태가 정확하고 "running"에 멈춰 있지 않음 |
| 7 | 화면을 1분간 끄고 복귀 | 같음 |
| 8 | 앱을 스와이프로 종료 후 다시 열기 | 조회로 작업을 다시 찾고 정확한 상태를 보여 줌 |
| 9 | 작업 중 비행기 모드 켰다 끄기 | 연결 문제로 표시하고, 추측으로 상태를 보여 주지 않음 |
| 10 | 한국어/영어 전환 | 상태 줄과 승인 카드가 모두 번역됨 |
| 11 | 글꼴 크기 최대, 화면 회전 | 승인 버튼에 닿을 수 있고 잘린 곳이 없음 |
| 12 | 로그아웃 | 데이터가 사라지고, 다른 계정으로 로그인해도 이전 계정의 것이 안 보임 |

결과를 판단하는 규칙:
- 접수됐지만 끝나지 않은 변경은 진행 중(`pending`)으로 읽혀야 합니다. 거절로 읽히면 안 됩니다.
- `unknown`은 "결과를 알 수 없음, 서비스를 확인하세요"로 읽혀야 하며, 다시 보내는 재시도 버튼이 있으면 안 됩니다.
- 앱의 상태와 웹 콘솔이 다르면 **서버가 맞습니다**. 버그로 보고하세요.

### 결과 기록

`docs/EVALUATION.md`에 "Physical device run" 섹션을 추가합니다. 날짜, 기기 모델과 Android 버전(**시리얼 번호·IMEI·계정 이름은 쓰지 않습니다**), 위 표의 통과/실패, 발견한 결함과 고친 내용을 적으세요. 스크린샷은 합성 데이터이거나 민감하지 않은 화면만 사용하세요(로그인 카드에는 실제 서버 주소가 보이니 공개 금지).

## 8. 코드 위치

| 필요한 것 | 파일 |
|---|---|
| 실행 상태 파싱과 표시 | `apps/android/core/.../Agent.kt`(`executionState`), `apps/android/app/.../AgentScreen.kt` |
| 재전송하지 않는 작업 폴링 | `Agent.kt`의 polling coordinator |
| 로그인과 토큰 처리 | `AndroidFirebaseIdentity.kt`, `core/.../FirebaseIdentity.kt`, `LiveAccess.kt` |
| 문자열(한국어/영어) | `strings.xml`이 아니라 Kotlin 화면 코드 안(`MobileOpsApp.kt`, `AgentScreen.kt`)에 있음. 두 언어를 같이 고치세요 |
| 색과 타이포(웹과 공유) | `design/tokens.json` → `npm run generate:tokens` |
| 서버 계약 | `packages/contracts`, `apps/gateway/src` |

계약이나 토큰을 바꾸면 `npm run generate:tokens`와 `make check`를 실행하세요. 어긋나면 검사가 실패합니다.

## 9. 규칙

- **커밋:** 무엇을 푸시할지는 소유자가 정합니다. 브랜치에서 작업하고 커밋은 작게 하며, `main`에 푸시하기 전에는 먼저 물어보세요. 푸시 전에 `make check`와 `npm run check:publishable`을 실행합니다.
- Git과 메시지에 **절대** 넣지 마세요: 토큰, API 키, 비공개 설정 파일, 키스토어, 실제 프로젝트·리소스 ID, Google 계정 이름.
- 의존성이나 SDK를 묻지 않고 추가하지 마세요(`firebase-messaging`은 이미 있습니다. 실제 푸시는 배포에서 꺼져 있고 검증되지 않았습니다).
- 본인이나 다른 사람의 대회 이전 프로젝트 코드를 복사하지 마세요. 대회는 2026-09-07~10-18 사이에 만든 작업만 인정합니다. 아이디어는 되지만 코드는 안 됩니다. 무언가를 추가하면 `docs/THIRD_PARTY.md`의 출처 표기도 갱신하세요.
- 소유자가 시키는 경우가 아니면, 앱을 통하는 것 외의 방법으로 실제 Cloud Run 서비스에 명령을 보내지 마세요.
- 실패한 상태를 숨겨서 "고치지" 마세요. 화면에 보이는 `unknown`이 올바른 동작입니다.

## 10. 막혔을 때

| 증상 | 가능한 원인 |
|---|---|
| `SDK location not found` | `ANDROID_HOME`이 설정되지 않음. 3단계 참고 |
| `Unsupported class file major version` | JDK 21이 아님 |
| 로그인: "not registered to use OAuth2.0" | 내 SHA-1이 아직 등록되지 않음(6단계 2번) |
| 로그인은 되는데 지시가 `crew_not_entitled`로 거부됨 | 내 계정이 서비스에 아직 허용되지 않음(6단계 3번) |
| 로그인 카드가 "설정이 잘못됨"을 표시 | `mobileops-agent.json`이 자리표시자이거나 수정됨. 소유자에게 파일을 다시 받으세요 |
| `make check-android-core`가 오프라인에서 실패 | 의존성이 아직 안 받아짐. 네트워크가 되는 상태에서 `assembleDebug`를 한 번 실행 |
| `adb devices`가 `unauthorized` | 폰에서 USB 디버깅 허용 창을 수락 |
| 서버 통합 테스트가 skip됨 | `:core:test`를 직접 실행함. `make check-android-core`를 사용 |

Google Cloud, Firebase, 대회 포털의 변경이 필요한 일은 직접 하지 말고 소유자에게 요청하세요.

## 차량·지도 후보의 추가 점검

새 후보에서 최초 안내 건너뛰기/완료/다시 보기, 기기 한국어/영어/미지원 언어 기본 영문, 화면 회전을 확인합니다. 해당 APK의 SHA-1로 제한된 `AIDE_ANDROID_MAPS_KEY`를 빌드 환경에 받습니다(키를 채팅·Git·로그에 기록하지 않습니다). 기본값은 지도 SDK 미구성입니다.

배포 후보가 준비되면 내 차량 초기화 → 충전 연결 오류 → AI 보고 → 명시적 조치 또는 24시간 정책 → 과열/모르는 문제의 무조치 보고를 확인합니다. 지도에서 자연어 요청 → Google Maps 출처 → 첫 목적지 선택 → 동일 맥락 기억/Favorite → 재요청 → 이동 취소를 확인합니다. 차와 운전은 시뮬레이션입니다. 지도/검색 실패, 권한 회수와 로그아웃 때 이전 위치가 남지 않는지 봅니다. 현재의 직선 시뮬레이션을 실제 도로 안내로 기록하지 않습니다.

## Mobility candidate check (15 October)

The current private debug APK is built from uncommitted source; the remote checkout does not yet contain all of this work. Do not put Firebase settings, the Maps key or the APK into Git. The owner can hand over the APK privately. The package and registered signing restrictions are unchanged.

1. Install the candidate, open it and complete or skip the three-page introduction. Use the phone language to verify Korean/English resources; the app has no manual language selector.
2. Sign in to the personal vehicle workspace, connect the simulated Aide EV, and reopen the app to check server persistence after signing in again. The private actor twin is distinct from organization work and other accounts.
3. From the vehicle home, choose a charger or dinner. Verify genuine Google tiles and source-linked Maps search, choose the first destination, save a Favorite, and cancel/arrive in the clearly labelled straight-line simulation. Refreshing or an uncertain step must pause automatic continuation; only an explicit Continue action may restart it. Availability may remain unknown; no GPS or physical steering permission is requested.
4. In Aide assistance, expand the simulator and introduce an unfamiliar charging-link symptom. Expect a read-only report and five safety checks. Review and run one guided simulated reconnection; verify the 72 kW read-back and a candidate case.
5. Promote the candidate separately. Promotion must leave automatic response off and execute nothing. Explicitly enable the bounded 24-hour policy, introduce a fresh matching symptom, and verify one remedy/report. Disable the policy after the test.
6. Revoke the case or introduce overheating. Expect human assistance, no automatic remedy, and no repeat after refresh/reopen. A busy AI provider leaves the incident unknown and does not retry automatically.
7. Separately sign in to the organization workspace for Cloud operations. Existing operator/reviewer membership is server verified. Read-only investigation is appropriate first; a real Cloud Run change requires an actual reviewer decision. Do not confuse the simulation policy with cloud mutation authority.

Record device/OS, APK SHA-256, language, each outcome and observed defects privately. Emulator/core/browser results and certificate registration are already verified; physical-phone login, tiles, backgrounding and the complete workflow remain unverified until this checklist is run.
