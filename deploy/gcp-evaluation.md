> Imported implementation notes. Root README and docs/STATUS.md define this repository's commands and current status. Some notes remain Korean pending submission editing.

# GCP 해석 평가 준비와 기록

갱신: 2026-10-10. **합성 관측·평가 도구를 준비한 상태다. 실제 Gemini 응답, 의미 정확도, 수행 시간 개선은 아직 측정하지 않았다.** 프로젝트/리전/모델·비용 범위가 정해지기 전에는 원격 호출하지 않는다.

## 자료 준비

Node.js 24 이상과 설치된 repo 의존성으로 실행한다.

```bash
npm run prepare:gcp-evaluation
```

새 임시 폴더의 경로만 출력한다. 매번 별도 디렉터리를 만들며 JSON/검토 문서는 0600이다. `.env`·ADC·gcloud·앱 DB를 읽거나 모델/클라우드 API를 호출하지 않는다.

| 파일 | 용도 |
| --- | --- |
| `pack.json` | 합성 원본 응답 → 실제 collector projection → snapshot → 공통 근거, 판단 기준과 digest |
| `pack.json`의 `requests[].body` | 제품의 `geminiRequestBody`와 동일한 한영 요청 본문 16개. 이것만 모델 입력에 해당한다. |
| `runs-template.json` | 16개 응답 기록의 빈 양식. 모두 `not_run`이며 모델/지역/시간/응답은 비어 있다. |
| `REVIEW.md` | 사례별 요구 판단·금지 주장·대조 출처와 검토 절차 |

검토자용 `raw`, `criteria`, `comparison`을 모델 입력에 섞지 않는다. 예측할 내용을 정답과 함께 주는 평가가 되기 때문이다. 모델의 실행용 자격증명이나 HTTP Authorization 헤더는 파일에 넣지 않는다. 준비 도구는 호출 기능이 없으며 live 실행기/제품 인증·reservation 통합을 대체하지 않는다.

## 여덟 사례

| 사례 | 구분할 판단 |
| --- | --- |
| metadata-ready | 서비스/revision 준비 완료와 로그·지표 미수집 |
| ready-with-errors | 현재 준비 완료와 과거 503 표본의 공존 |
| empty-samples | 빈 로그/지표 표본과 명시적인 수치 0의 차이 |
| denied-signals | 로그/지연 권한 거절과 요청 no_data의 차이 |
| changed-during-read | 첫 failed → 뒤 succeeded, 순차 조회와 changed/partial |
| recovery-before | 준비 실패·오류 표본을 구체적으로 식별하는 대조 |
| recovery-after | 같은 대상의 이후 준비 완료·명시적 503=0 표본, 완전 회복은 미확인 |
| log-injection | 합성 로그 payload/URL/IP의 canary가 제거되고 허용 metadata만 전달되는지 |

회복 사례의 시각/지표 창은 서로 다르다. 모델에는 각각 한 snapshot만 보낸다. 두 응답을 사람이 나란히 대조해 실패와 이후 관측 개선을 구분하는지 확인한다. 모델이 이전 snapshot이나 변경 원인을 알고 있다고 주장하면 근거가 없는 판단이다. 로그 사례는 입력 투영을 검증하며 실제 모델의 prompt-injection 방어 성능을 증명하지 않는다.

## 기록된 출력과 사람의 검토

실제 모델 실행이 별도로 허용·검증된 후 `runs-template.json`의 해당 한 항목을 `RUN.json`으로 복사한다. 요청/사례/언어/digest를 유지하고 모델·리전·설정 digest, 시작/종료 시각과 응답 원문 JSON 문자열을 기록한다. `provenance: recorded-unverified`는 가져온 파일의 출처를 이 도구가 독립 검증하지 못한다는 뜻이다. 도구 대조용 응답은 `synthetic-control`로 표시한다. 응답이 없거나 완료를 확인하지 못하면 각각 `failed`/`unknown`, `rawResponse: null`로 남긴다. 자동 재호출 기능은 없다.

```bash
npm run prepare:gcp-evaluation -- --record /absolute/path/RUN.json
npm run prepare:gcp-evaluation -- --record /absolute/path/RUN.json /absolute/path/REVIEW.json
```

첫 명령은 새 폴더에 원문 기록, `assessment.json`, 빈 `review-template.json`을 만든다. 검토 양식에 검토자/시각과 **모든 항목의 pass/fail/unknown/unreviewed·설명·관련 출처 ID**를 기입한 후 두 번째 명령으로 확인한다. 실제 판단의 진실성이나 검토자 신원은 별도 확인이 필요하다. 검토 필수 항목을 없애거나 응답·프롬프트·언어·근거를 바꾸면 이전 검토를 재사용할 수 없다.

`contract: passed`는 제품과 공유하는 JSON/출처 존재 검사 통과뿐이다. 사실과 반대되는 문장도 존재하는 출처 ID를 붙이면 통과할 수 있다. 사람 검토 전에는 `semantics: unreviewed`다. 명시적 판정은 `human_pass`/`human_fail`/`unknown`으로 남고 합성/미확인 provenance는 바뀌지 않는다. 자유형 문장 안의 건강/원인 확정 주장을 자동으로 이해해 차단했다고 표현하지 않는다. 제품은 해석 뒤 누락 근거를 결정적으로 추가하지만, 여기서는 그 전의 모델 원문 자체를 평가한다.

## 실제 품질과 시간 측정

실호출마다 승인된 범위 안에서 모델/설정·입력/출력·시각·비용 근거를 보존하고, 검토자가 원본 관측과 각 주장/출처를 대조한다. 두 언어를 별개 결과로 보고 미실행·실패·미확인·미검토를 분모에서 임의로 빼지 않는다. 필요하면 독립 검토자의 불일치를 기록하고 합의 전 unknown으로 남긴다.

`modelLatencyMs`는 기록된 모델 요청의 시작/종료 차이일 뿐 운영 작업 시간은 아니다. 같은 사례에서 시작점(대상/과제 제시)과 끝점(근거 확인·계획 검토·결과/미확인 사항 인계)을 미리 정하고 수동 경로/앱 경로를 각각 측정한다. 학습 효과를 줄이도록 수행 순서를 바꾸고 같은 근거 범위를 사용한다. 측정 전 `manualTaskTimeMs`/`appTaskTimeMs`는 null이다. 준비 도구나 합성 대조의 통과율을 Gemini 정확도·성능 개선율로 게시하지 않는다.

소스: `server/modules/gcp/evaluation/` · `server/gcp-evaluation.test.ts`. 제품 호출/저장 경계는 [분석 계약](gcp-analysis.md)을 따른다. 실제 Google/Firebase 인증·모바일 기기·원격 저장·배포·출품은 별도 검증이다.
