# GCP 전용 웹/API 배포 후보

갱신: 2026-10-10. **로컬 빌드·합성 API/브라우저·독립 실행 검증용 후보**다. 실제 Cloud Run/Firebase/Gemini/Firestore 연결, Docker 이미지 빌드와 출품 적격성·공개 배포는 미검증이다. 전체 로컬 앱과 AWS 회사 후보는 그대로 유지한다.

## 생성과 검증

```bash
npm run build:gcp
npm run test:gcp-hosted
```

Node.js 24 이상과 준비된 의존성/Chromium을 사용한다. 첫 명령은 `dist-gcp-web/`와 `dist-gcp/`를 만든다. 최종 후보는 새 staging에서 완성하고 자신이 만든 `candidate.json`이 있는 기존 산출물만 교체한다. 설정·자격증명·`.data/`는 복사하지 않는다. `make check`에도 두 명령을 포함한다.

두 번째 명령은 후보와 잠긴 의존성을 저장소 밖의 임시 폴더로 복사하고, 원본 SDK를 참조하는 symlink 없이 세 SDK import·기동 차단·실제 번들 HTTP·한영/모바일·종료를 시험한다. 합성 identity/store/collector/model port만 사용한다. 실제 Firebase 브라우저 로그인은 가짜로 바꾸지 않으며, 브라우저는 미설정 진입과 명시적 합성 체험을 검증한다. 실제 로그인/토큰/원격 저장과 Docker 내부의 `npm ci`를 검증한 것은 아니다.

| 산출물 | 역할 |
| --- | --- |
| `server.mjs` | GCP만 기동하는 Node entry. Firebase/Gemini는 명시적 구성으로 조립한다. |
| `web/` | GCP 전용 웹·해시가 있는 정적 파일 목록. 같은 서버가 제공한다. |
| `runtime.mjs` | 검증·신뢰된 플랫폼 조립용 export. HTTP로 제공하지 않으며 컨테이너에도 복사하지 않는다. |
| `package.json` / `package-lock.json` | 직접 runtime 의존성 3개와 기존 lock에서 추적한 173개 resolution. 새 버전을 탐색하지 않는다. |
| `module-inputs.json` / `candidate.json` | 포함 소스·산출물/lock digest·한계. HTTP로 제공하지 않는다. |
| `Dockerfile` / `.dockerignore` | Node 24·non-root 실행 recipe. 실제 build/pull은 수행하지 않았다. |

API runtime 의존성은 `firebase-admin`, `@google-cloud/firestore`, `google-auth-library`다. 웹 Firebase SDK는 정적 산출물에 포함된다. AWS/On-Prem/Azure adapter·registry·개인 CLI·SQLite/데모 기동·회사 worker·평가 fixture는 빌드 graph에서 제외한다. 공통 domain의 provider 식별자까지 삭제하는 것은 아니다.

## 진입과 HTTP 경계

- `/`에서 개인용/조직용을 선택한다. `/#/personal/gcp`와 `/#/organization/gcp`만 GCP 모듈을 연다. 선택은 로그인/권한 부여가 아니다. AWS·데모·다른 공급자 해시는 찾을 수 없는 페이지다.
- GCP config/개인·조직·모바일 API만 기존 handler로 전달한다. `/api/aws/*`, `/api/state`, AWS 조직 config, Docker/worker API는 없다. 웹 신원·owner/workspace/membership·역할·Origin/Host·고정 대상 검사를 유지한다.
- 정적 파일은 기동 때 읽은 한정된 manifest와 hash를 대조한다. 임의 경로·설정·소스 map·package/manifest 파일을 요청해도 제공하지 않는다. 파일별 8 MiB/전체 32 MiB와 512개 한도이며 HTML로 임의 경로를 대체하지 않는다.
- `GET /healthz`는 서버/정적 자산 준비 상태일 뿐 Google 인증·관측 대상의 상태나 모델 가용성을 점검하지 않는다. 설정된 Host가 필요하며 별도의 플랫폼 probe 구성을 자동으로 만들지 않는다.
- 브라우저 합성 체험은 연결 없이 가능하고 서버 기록·Google 호출을 만들지 않는다. 실제 연결은 [서버 구성](../server.md)과 [운영 흐름](../workflow.md)을 따른다.

## 실제 환경에 제공할 설정

별도의 비공개 서버 파일에 [합성 예시](../server.example.json)를 참고해 실제 설정을 준비한다. 파일을 이미지에 포함하지 않고 런타임에서 읽을 절대 경로로 제공한다. `node` 실행 사용자에게 읽기 권한이 있어야 한다.

| 환경 값 | 의미 |
| --- | --- |
| `MOBILEOPS_GCP_HOSTED_ENABLED=1` | 이 전용 entry를 명시적으로 활성화 |
| `MOBILEOPS_GCP_ENABLED=1` | GCP 구성 활성화 |
| `MOBILEOPS_GCP_CONFIG=/absolute/runtime/config.json` | strict 서버 구성 파일 |
| `PORT` | 수신 포트. 미지정 시 8080, 정수 1–65535 |

실기동은 `node server.mjs`다. `MOBILEOPS_OFFLINE_TEST=1`이거나 flag/경로/PORT가 잘못되면 기동하지 않는다. 별도 `MOBILEOPS_CLOUD_ENABLED`는 기존 다중 provider entry용으로 이 후보에는 필요하지 않다. publicOrigin은 정확한 HTTPS origin이어야 하며 credential은 고정 프로젝트·이메일의 `metadata` 방식만 받는다. 로컬 사용자 위임 파일이 필요한 개발은 기존 `npm run dev` 경로를 사용한다.

Cloud Run은 ingress container가 `0.0.0.0:$PORT`에서 수신하도록 요구하고 TLS를 플랫폼에서 종료한다. 이 서버는 내부 HTTP를 사용하면서 외부 HTTPS origin의 Host/Origin을 검사한다. 실제 proxy가 이 값을 보존하는지는 배포 환경에서 확인해야 한다. [Cloud Run 컨테이너 계약](https://docs.cloud.google.com/run/docs/container-contract)

런타임 service identity는 배포하는 사람의 계정과 구분한다. 구성에 명시한 서비스 계정의 metadata 토큰과 별도의 웹 사용자 Firebase ID token을 혼용하지 않는다. 실제 역할·Firebase 허용 도메인·membership·ingress/invoker 접근은 지정 프로젝트에서 검토하며 앱이 자동 부여하지 않는다. [Cloud Run 서비스 신원](https://docs.cloud.google.com/run/docs/securing/service-identity)

필요한 고정 읽기·Firebase/Firestore·선택적 Gemini 권한은 [기존 권한 표](../server.md#실제-연결에서-확인할-권한과-비용)를 따른다. Firebase 앱 로그인은 Cloud Run의 IAM 서비스 호출 인증과 별개이며, 실제 외부 접근 정책/인증 경로를 확정해야 한다. 배포·IAM 변경·공개 명령은 이 패키지에서 실행하지 않는다.

## 종료와 저장

SIGTERM/SIGINT 수신 후 새 요청을 막고, HTTP 연결과 진행 중 handler를 기다린 다음 credential·Firestore·Firebase 자원을 한 번 닫는다. 응답 완료 후 유휴 keep-alive 연결도 정리한다. 이미 브라우저가 끊겨도 서버 handler는 추적한다.

8초 안에 정리되면 `drained`/exit 0이다. 기한 초과는 연결을 끊고 `deadline`/exit 1, 자원 정리 실패는 `failed`/exit 1이다. 기한 초과 시 작업 완료를 보증하거나 다시 실행하지 않는다. Cloud Run의 SIGTERM 이후 강제 종료 전 10초 계약 안에서 끝내기 위한 앱의 8초 한도이며, 실제 런타임 종료는 별도 검증이 필요하다. [공식 종료 계약](https://docs.cloud.google.com/run/docs/container-contract#shutdown)

지속 상태는 기존 Firestore adapter를 사용한다. 로컬 파일을 저장소로 사용하지 않고, 저장된 모델 reservation/실행 intent의 만료·unknown·무재전송 규칙을 유지한다. Cloud Run 파일 시스템은 인스턴스 종료 후 보존되지 않는다. 로컬 메모리 port 검증을 원격 Firestore 지속성으로 표현하지 않는다. [파일 시스템 계약](https://docs.cloud.google.com/run/docs/container-contract#file_system)

## 실제 배포 전 남은 확인

대상 프로젝트·리전·서비스·모델과 비용 범위, Firebase/Firestore·조직 멤버십, 공개 origin/접근 정책을 정해야 한다. Docker build 권한 답변 뒤 Linux 이미지/설치·실행 UID와 구성 파일 읽기·기동/종료를 검증하고 base image digest를 고정한다. 현재 recipe의 `node:24-bookworm-slim`은 실제 이미지 해시를 검증한 표기가 아니다.

이후 허용된 범위에서 실제 로그인→단일 서비스 근거→Gemini 해석/검토→명시적 읽기→인계/재접속을 확인한다. 종료/재시작 후 원격 저장과 중복 방지·사용량도 대조한다. [의미 평가 자료](../evaluation.md)는 실제 모델 평가와 별도로 준비돼 있다. 앱 프로세스 기동, 테스트 통과, Docker recipe 작성은 배포·공개/제출 완료가 아니다.
