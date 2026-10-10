> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 관측 API와 웹

갱신: 2026-10-10. 실제 HTTP 처리기·인증/저장 port·Cloud Run 수집기·한/영 화면을 합성 인증과 Google 응답으로 연결해 검증했다. 실제 Google/Firebase 로그인·자격증명·프로젝트 접근·배포 검증은 아니다.

## 지금 웹에서 볼 수 있는 것

`/#/personal/gcp` 또는 `/#/organization/gcp` → **합성 관측 예시**를 누르면 배포 준비 실패와 이전 revision의 트래픽, revision 조회 거절을 함께 살펴볼 수 있다. 모든 관측은 합성 표시를 하며 실제 수집·계획·실행 요청으로 보낼 수 없다. 예시 닫기/새로고침 때 이 화면의 관측을 지운다.

서버에 서비스를 주입한 환경에서는 **GCP 웹 로그인 → 서비스 선택 → 메타데이터 조회**로 사용한다. 한 프로젝트/리전의 고정 서비스·revision만 조회하며 서비스 준비 상태·트래픽·시각·출처·누락을 보여준다. 새 조회를 시작하면 이전 관측을 지우고, 사용자 전환·401/403·로그아웃·모듈 전환에서도 제거한다. 언어 선택 외 토큰/관측은 브라우저 저장소에 남기지 않는다.

연결된 화면 상단은 **대상·근거·현재 계획**을 요약한다. 현재 선택/열린 기록의 상태이며 전체 조직의 정상 서비스 수가 아니다. **근거 / 계획 / 저장** 탭으로 관측 상세, 검토·실행·결과, 최근 계획 목록을 오간다. 오른쪽 분석은 같은 관측에 연결되며 좁은 화면에서는 아래로 배치한다. 탭·검색·페이지 이동·언어 전환은 새 관측/모델/실행을 시작하지 않는다. 저장 목록은 최대 50개를 6개씩 표시하고, 열지 않은 계획의 검토/실행 상태를 추정하지 않는다.

기본 개발/hosted 기동에는 GCP 서비스가 아직 주입되지 않았다. 따라서 로그인/조회 연결은 미설정이며 합성 예시만 볼 수 있다. 테스트용 신원·fixture HTTP route를 제품 기동이나 배포에 넣지 않는다.

## 서버 조립 경계

- `GcpWebAccess(verifier, store)`는 서명/issuer/audience/만료/회수를 실제 검증하는 `WebIdentityVerifier`를 받는다. 기존 Firebase verifier를 주입할 수 있지만 이번 브라우저 검증은 합성 verifier다. 브라우저용 Firebase factory는 기존 공통 인터페이스를 재사용한다.
- 조직은 관리자가 준비한 versioned membership을 검사한다. 개인은 검증한 actorId를 owner.userId로 고정하고 그 사용자의 서버 등록 자원만 찾는다. 개인 operator/reviewer는 자기 자원에 한정된 앱 역할이며 GCP IAM 권한을 부여하지 않는다.
- `GcpObservations(store, access, registrations)`의 각 등록은 id·label·고정 binding·dataMode·collector다. collector는 [수집 계약](gcp-cloud-run.md)에 따른 실제 인증 어댑터가 필요하다. 웹 신원 토큰을 Cloud Run API 토큰으로 재사용하지 않는다.
- 등록 목록은 서버 composition만 만든다. 사용자가 브라우저에서 프로젝트·리전·UID·revision·credential·role·명령을 등록하는 API는 없다. 등록 id는 최대 100개이며 owner/workspace별로 필터한다. 구성 변경 시 digest가 달라진다.
- `GcpApiServices`에 access·observations·publicOrigin과 개인/조직별 web config를 넣는다. `createCloudApiServer({ organization?, gcp? })`는 hosted 조립점이며 개인 AWS CLI/데모를 import하지 않는다. 회사 AWS 빌드는 GCP를 포함하지 않는다.
- 로컬 `createApiServer`는 다섯 번째 인자로 GCP 서비스를 받으며 기존 개인 AWS/데모 가드를 유지한다. 로컬/hosted entry의 명시적 loader·credential provider는 [서버 설정](gcp-server.md)에 구현했으며 기본 비활성이다. 임의로 현재 gcloud 계정/프로젝트를 승계하지 않는다.

## HTTP 계약

| 경로 | 내용 |
|---|---|
| `GET /api/gcp/config/{personal|organization}` | 공개 화면/인증 구성. 미설정이면 `{configured:false}` |
| `/api/personal/v1/workspaces/{workspaceId}/gcp` | 검증한 사용자 개인 namespace |
| `/api/organizations/v1/{organizationId}/workspaces/{workspaceId}/gcp` | 현재 조직 membership namespace |
| `GET {base}/resources` | 이 owner/workspace에 등록된 서비스 목록 |
| `POST {base}/observations` | `{resourceId}`와 UUID `Idempotency-Key`, 관측 수집/저장 |
| `GET {base}/observations/{id}` | 저장된 관측과 근거 digest. 새 클라우드 호출 없음 |

web API는 지정된 동일 출처 Host/Origin·Bearer를 검사하고 demo 헤더/개인 AWS cookie를 인증으로 사용하지 않는다. JSON 32 KiB, 엄격 필드, query override 거부, no-store를 적용한다. GET의 Origin이 없으면 same-origin Fetch Metadata가 필요하다. 별도 [모바일 HTTP](gcp-mobile.md)는 bearer 기반 native 요청을 지원한다. Android 앱은 아직 없다.

개인/조직 owner가 다르면 동일 workspace나 resource 이름으로 서로의 기록을 조회할 수 없다. 조직 관측은 허용된 같은 workspace 멤버가 읽는 공용 근거이며 AWS 개인별 SSO cache 공유를 뜻하지 않는다. 수집은 operator, 기존 관측 조회는 viewer 이상이다. 수집 전후 웹 신원·membership version을 재검사하고 저장 transaction에서도 다시 확인한다.

## 재시도와 지속 저장

같은 owner/workspace/actor·요청 키와 같은 resource/configuration digest는 기존 결과를 반환한다. 완료 관측·공통 CloudEvidence·완료 replay를 한 transaction으로 저장한다. 토큰·인증 session 전체는 저장하지 않는다. provider I/O는 transaction 밖이다.

수집 전 pending reservation을 저장한다. 다른 프로세스의 동일 요청은 `collection_in_progress`이며 재수집하지 않는다. reservation은 30초이고 만료되면 unknown으로 바꿔 이후 같은 키를 재실행하지 않는다. 늦은 응답도 unknown을 완료로 바꾸지 않는다. provider 수집에는 별도로 15초 제한이 있다. 호스트 재시작 후도 지속 store의 같은 규칙을 따른다.

응답 유실 시 화면의 **같은 요청 확인**은 원래 키를 재사용한다. 네트워크 단절 뒤 완료된 서버 결과도 이 경로로 회수한다. 웹 연결이 끊겼다고 접수한 수집을 재시작하지 않는다. 새 목록/대상 선택은 이전 재시도 정보를 지우며, 사용자의 새 **메타데이터 조회**는 별도 관측을 만든다. expired/unknown 작업을 성공으로 표시하지 않는다.

API 200은 관측 기록을 돌려줬다는 뜻이다. 내부 service/revision이 denied/missing일 수 있고 `serviceAssessment`는 unknown이다. 이 API는 Gemini 호출·계획/검토·점검 실행을 시작하지 않는다.

## 검증

- `server/gcp-observations.test.ts`: 실제 HTTP·인증 port·SQLite·collector 연결, 7개. 개인/조직·viewer·권한 철회·동시 reservation·unknown/늦은 결과·설정 변경·위조 응답·부분 거절을 검증한다.
- `server/gcp-web-client.test.ts`: 동일 키 재시도·지연 응답·사용자 전환/로그아웃·scope/비밀 필드 거부·관측/분석/계획과 목록 검증.
- `npm run test:gcp-web`: 실제 위 처리기를 임시 합성 서버에서 사용한다. 개인/조직 로그인→조회→도중 변경→거절→사용자 전환→권한 회수→로그아웃/새로고침, 영문 390px/axe. fake backend 결과만 렌더하는 검사가 아니다. 웹 identity와 Google API 응답은 합성이다.
- 일반 E2E는 합성 예시 opt-in·한/영·모바일·새로고침과 기본 미설정 경로를 확인한다. 캡처/DB는 테스트 경로에만 저장한다.

분석·고정 계획·검토/명시적 실행·결과/인계를 HTTP/한·영 화면으로 합성 통합했다. metadata만 있는 상태에서 로그/지표 원인이나 서비스 정상을 판정하지 않는다. 선택적 [제한된 로그/지표](gcp-telemetry.md) 관측·저장·화면/분석 연결도 합성 통합했다. 실제 인증/프로젝트/비용·Android/FCM·배포는 계속 남은 범위다.

## 분석과 계획

`GcpApiServices.analyses`를 주입하면 관측 다음에 한·영 분석/고정 계획을 준비하고 오른쪽 패널에서 출처를 확인한다. `/analyses` 계약·지속 요청 예약·모델 한도·실연결 한계는 [분석 구성](gcp-analysis.md)을 따른다. 기본 기동의 실제 모델/인증은 미설정이다.

`GcpApiServices.operations`를 같은 저장소/등록 목록으로 주입하면 검토 요청·판단·명시적 metadata/제한된 로그·지표 실행·결과/인계가 이어진다. 로그인 후 최근 50개 계획에서 저장된 결과를 다시 연다. 재조회/검토는 클라우드 읽기를 시작하지 않는다. [workflow 구성과 사용법](gcp-workflow.md)

기본 비활성 화면의 **합성 워크플로 체험**은 브라우저 안의 미리 작성한 근거/해석을 사용한다. 실제 API/인증/모델과 연결되지 않으며 닫기/새로고침/시나리오 전환 시 메모도 사라진다. [체험 순서](gcp-workflow.md)
