> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP Cloud Run 관측 어댑터

갱신: 2026-10-10. 서버 고정 읽기와 공통 근거 변환을 구현했다. HTTP/한·영 관측 화면은 합성 통합했다. 실제 GCP 인증/API·Gemini·모바일·배포를 완료한 것은 아니다. [웹/API 사용법](web.md)

## 이번에 구현한 범위

이 문서는 기본 metadata 수집 계약이다. 명시적 설정으로 붙이는 [로그/지표 관측](telemetry.md)은 별도 세 쿼리를 추가하며 기존 metadata 실행 계획에는 포함하지 않는다.

`CloudRunCollector`는 신뢰된 서버 설정의 owner/workspace/environment와 한 project/location/service UID/revision을 사용한다. 브라우저 요청으로 프로젝트·revision·URL·자격증명을 덮어쓰지 않는다. 기존 GCP target에 더해 완전한 Cloud Run 서비스 경로와 revision 이름을 검사한다.

수집 순서는 **서비스 조회 → 지정 revision 조회 → 서비스 재조회**다. 서비스 이름/UID·revision 이름/부모를 비교하고 다른 범위나 재생성된 서비스를 거절한다. 조회 전후 서비스의 선택된 메타데이터가 달라지면 두 관측을 남기고 `changed`/partial로 표시한다. 동일한 응답도 원자적 스냅샷이나 서비스 정상의 증거는 아니다.

Cloud Run v2의 준비 상태, generation/observedGeneration, 최근 생성/준비 revision, 실제 트래픽 배분과 시각을 사용한다. `reconciling` 중의 상태와 실패한 배포 뒤 남은 serving 상태는 구분해야 한다. 준비 상태 성공을 요청 오류율·응답 시간·복구 성공으로 해석하지 않는다. [서비스 필드](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services) · [Condition 상태](https://docs.cloud.google.com/run/docs/reference/rest/v2/Condition)

revision은 서비스가 참조하는 최신 이름을 따라 자동 변경하지 않고 서버가 지정한 이름 하나만 조회한다. 응답의 부모 서비스와 전체 이름을 검증한다. [Revision 조회](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services.revisions/get) · [Revision 필드](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services.revisions)

## 호출과 데이터 제한

- REST 목적지는 `https://run.googleapis.com/v2/`로 고정한다. GET과 두 리소스 경로만 지원하고 리디렉션·재시도·서비스 URL 호출은 하지 않는다. [Service 조회 API](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/get)
- 최대 3개 resource API 요청, 전체 수집 15초, 응답당 128 KiB, 트래픽 100항목·revision condition 32항목으로 제한한다. 권한 확인/인증 토큰 갱신의 내부 호출은 별도 인증 어댑터의 범위다.
- `fields`로 필요한 값만 요청하고 로컬에서도 다시 추린다. 환경 변수·비밀·컨테이너 구성·라벨/annotation·condition message·원문 오류·URI·토큰을 저장하거나 브라우저에 보내지 않는다.
- 필드가 빠졌거나 새로운 condition 값이면 null/unknown·missingFields로 보존한다. traffic 누락을 0으로, HTTP 404를 삭제 확정으로 표시하지 않는다. 403/404/429/기타 실패는 거절/누락/미수집으로 구분한다.
- 서비스 식별을 확인하지 못하면 revision/재조회는 skipped다. 실제 호출하지 않은 API를 수집 출처로 만들지 않는다. revision만 거절되면 서비스 관측을 유지한다. 재조회 실패 시 기존 관측도 partial이다.
- 로그·지표·요청 probe·변경 이력은 이번 수집에 포함하지 않는다. 근거에 미수집을 명시하며 `serviceAssessment`는 unknown이다. 전체 해커톤 시나리오의 로그/지표·Gemini 분석을 대체하지 않는다.

## 인증과 조립

`createCloudRunRestTransport`에는 명시적 enabled/offline 상태, 고정 binding, 예상 principal/session과 `CloudRunCredentials`를 주입한다. 기본 ADC/gcloud 계정이나 브라우저 토큰을 자동 사용하지 않는다. `MOBILEOPS_OFFLINE_TEST=1`에서는 live transport 생성/collector 사용을 거절한다. 실제 자격증명 조립과 프로젝트/서비스/비용 범위가 정해지기 전 실호출하지 않는다.

인증 어댑터는 실제로 확인한 effective principal/session에 access token을 묶어 반환해야 한다. 문자열 라벨을 받아 비교하는 것만으로 신원을 입증한 것이 아니다. [서비스 계정 인증 어댑터](server.md)는 metadata와 명시적 사용자 위임 방식으로 구현했고 합성 프로토콜 검증을 마쳤다. 실제 토큰/IAM은 미검증이다. 토큰 갱신은 같은 principal/session에서 허용하지만 주체·세션이 바뀌면 결과를 폐기한다. 인증 API의 원문 오류/토큰은 공개 오류에 포함하지 않는다.

웹 신원과 GCP 수집 주체는 별개다. `collect(context, { revalidate, signal })`의 revalidate는 현재 웹 신원·membership/역할을 다시 확인해야 한다. live 수집은 이 callback을 필수로 요구하며 처음과 반환 직전에 scope/actor를 재검사한다. 조직 멤버십이 수집용 서비스 계정 권한을 자동 부여하지 않는다. 같은 owner/workspace 검사는 개인/조직·GCP 모바일에서도 적용한다.

`cloudRunEvidence(snapshot)`는 공통 CloudEvidence로 변환한다. `CloudWorkflow.saveEvidence`에 서버 내부에서 저장하면 기존 owner namespace·불변 근거·digest 계약을 사용한다. 이 저장 자체가 계획·검토·실행을 생성하지 않는다. 관측 HTTP는 replay/CloudEvidence/snapshot을 원자 저장하며 웹에서 결과를 표시한다. metadata 전용 CloudReadAdapter를 [명시적 실행 흐름](workflow.md)에 연결했으며 기동 구성은 구현했으며 실제 Google 인증 검증은 남았다.

## 검증과 다음 작업

`apps/gateway/test/cloud-run.test.ts`의 합성 검증 13개는 고정 GET/필드·비밀 제거·거절/누락·불완전/새 상태·owner/모바일·서비스 교체/다른 범위·도중 배포 변경·주체/세션 변경·취소/동시성·128 KiB·원문 오류 비노출·공통 SQLite 근거 저장을 확인한다. 실제 API 호출이나 IAM 검증은 아니다.

인증된 GCP HTTP/화면·재시도·membership 철회·이전 데이터 제거와 분석·고정 계획/검토·metadata 실행/결과·인계를 합성 검증했다. 제한된 로그/지표 관측도 합성 통합했고 다음은 확장 고정 실행·GCP 모바일로 이어간다. 실제 로그인/프로젝트 접근·Google API 필드/권한·비용·기기·배포는 별도 실검증이 필요하다.
