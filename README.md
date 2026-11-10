# 우왕톤 · 충북 단체여행 프론트엔드

검수한 여행방 시작 HTML/JavaScript와 React + TypeScript 공통 UI를 Vite로 함께 빌드하는 프론트엔드입니다. 기본 `/`는 확정된 여행방 화면이며 요청된 하단 푸터만 제거했습니다. 같은 출처의 BE API로 기기 세션·방 생성·초대 참여·방 진입 화면의 재접속을 처리합니다. `?preview=ui`는 기존 React 공통 UI 확인 화면을 엽니다.

서버는 별도로 실행해야 합니다. 기기 쿠키 방식으로 본인을 식별합니다. 방 생성·참여 후 `/room.html`에서 여행 준비와 내 취향 화면을 사용합니다. 방 정보·공통 여행 조건·전체 참여자 준비 상태와 본인의 개인 조건 저장·AI 해석·준비 완료는 기존 BE API에 연결합니다. 방장만 공통 조건을 수정하며, 개인 원문·취향은 본인 전용입니다. 취향 분석은 원문 저장 → AI 해석 → 결과 저장 순서이며, 준비 완료는 사용자가 현재 조건과 취향을 확인한 뒤 별도로 요청합니다. 실행 DB에는 BE migration 002의 준비 기능 테이블이 필요하고 AI 해석에는 BE의 AI 설정이 필요합니다. FE에서 migration을 실행하거나 비밀키를 관리하지 않습니다.

일정 캔버스는 비개인 예시 데이터를 사용하는 로컬 미리보기입니다. 캔버스의 공동 편집·서버 저장은 연결하지 않았습니다. 실제 코스 생성은 준비 화면의 ‘일정 만들기’에서 기존 일정 API를 사용합니다. 최근 여행 목록은 제공하지 않습니다. 서버 없이 `/room.html?preview=room`에서 시안을 볼 수 있으며 실제 저장과 구분합니다. 기존 화면·연동 문서는 당시 단계의 기록입니다. 이전 `src/features/entry` mock은 보존된 예시이며 기본 화면에서 사용하지 않습니다. 규격 원본은 [Notion 여행방 시작](https://app.notion.com/p/40ee977e49088105a9b4ce4df0aef6f8), [여행 준비·개인 조건](https://app.notion.com/p/412e977e49088197b345d73603c6a27f), [공통 규칙](https://app.notion.com/p/40ee977e49088189b512e6e817984d48)입니다.

현재 브랜치는 친구의 준비·취향·일정 캔버스와 기존 실제 일정 생성 화면을 함께 보존합니다. 준비 화면의 `일정 만들기`·`여행 일정 보기` 또는 `/room.html?tripId=...&view=generation`에서 기존 생성·검토·저장·지도 화면으로 이어집니다. 캔버스와 생성 결과는 서로 연결되지 않습니다. 실제 생성에는 BE migration 003과 AI 설정이 추가로 필요하며, 지도는 공개 `VITE_KAKAO_JAVASCRIPT_KEY` 설정을 사용합니다. 자세한 조건은 [일정 생성](docs/generation.md), [일정 표시](docs/itinerary-screen.md)를 참고하세요. `preview=room&view=generation`은 API를 호출하지 않는 안내 화면입니다.

준비 화면에서 공통 조건과 각자의 취향을 저장하고 준비 완료한 뒤, 본인이 일정 반영 조건을 검토합니다. 방장의 ‘일정 만들기’가 최신 준비 상태를 다시 확인해 생성 작업을 요청합니다. 실제 생성된 결과만 기존 여행방 헤더·참여자 사이드바와 날짜별 목록·지도 화면에 표시합니다. 일정이 없는 방에는 가짜 코스나 빈 지도 결과를 출력하지 않습니다. 준비·취향·캔버스 화면은 친구 버전의 구성을 사용합니다.

## 시작하기

- 개발 기준: Node.js 24.15.0, npm 11.12.1
- 지원 범위: Node.js 24.x (`package.json`의 `engines` 참고)
- 패키지 관리자: npm. `package-lock.json`을 함께 관리합니다.
- `.node-version`은 사용하지 않습니다. `engines`는 버전 안내이며 Node를 설치하거나 전환하지 않습니다.

```sh
npm ci
npm run dev
```

개발 주소는 `http://127.0.0.1:5173/`입니다. `/api` 요청은 인접 BE의 `http://127.0.0.1:8000`으로 전달됩니다. BE 개인 설정의 `ALLOWED_ORIGINS`에 `http://127.0.0.1:5173`을 포함하고 API 서버를 먼저 켭니다. 서버 없이도 화면은 보이지만 생성·참여는 완료되지 않습니다. DB/AI 비밀값을 FE에 넣지 않습니다.

파이참에서 화면과 BE를 함께 확인하려면 이 FE에서 `npm run build`한 다음 인접 BE의 `run.py`를 실행하고 `http://127.0.0.1:8017/`을 엽니다. 폴더 배치와 자세한 수동 검수는 [여행방 시작 실행 안내](docs/trip-entry.md)를 따릅니다. `dist/`는 생성물이며 Git에 올리지 않습니다.

## 명령

| 명령 | 역할 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run typecheck` | 앱·설정 TypeScript 검사 |
| `npm run lint` | Oxlint 검사 |
| `npm run build` | 타입 검사 후 시작·방 진입·공통 UI 세 페이지를 `dist/`에 생성 |
| `npm run preview` | 빌드 결과 로컬 확인 |
| `npm run check` | 타입·lint·빌드 순서대로 실행 |
| `npm test` | 공통 UI mock 및 여행방 API adapter의 입력·세션·재시도 검사 |

GitHub CI는 추가하지 않습니다. Codex가 로컬 검사와 변경에 필요한 기능·브라우저 검증을 실행하고 PR에 결과를 기록합니다.
빌드 통과와 브라우저 검증은 별개입니다.

## 구조

```text
src/
  app/             앱 진입과 화면 조립
  pages/           화면
  components/ui/   공통 버튼·입력·모달
  components/trip/ 조건·참여 상태·일정 카드와 상세
  features/ui-preview/ 미리보기 전용 상태·비동기 mock
  styles/          디자인 토큰·전역 스타일
```

실제 기능을 구현할 때 `features/trip`, `features/profile`, `features/plan`과 공통 유틸 `lib/`를 필요에 따라 추가합니다. Mantine 참고 예제는 앱에 포함하지 않았습니다.

## 팀 작업과 에이전트

기능 구현·버그 수정의 기본 완료 범위는 **이슈 연결 → 작업 브랜치 → 구현·검증 → 커밋·푸시 → PR 제출**입니다. 병합은 사람이 합니다. 설명 요청과 명시적인 로컬 작업은 해당 범위를 따릅니다.

- [AGENTS.md](AGENTS.md): 항상 적용할 작업 규칙
- [GitHub 작업 절차](docs/github-workflow.md): 이슈·브랜치·검증·PR 보고서
- [에이전트 역할](docs/orchestration.md): 비단순 작업은 GPT-6.1 Sol high planner가 선행 계획, 세션 선택 모델의 root가 조정·통합·최종 검사·Git 작업, Luna high가 구현·검증; 동시 하위 에이전트 최대 2개
- [팀 스킬](docs/skills.md): implement-feature, review-ui, deliver-pr
- [UI 기준](docs/ui-guide.md): 색상·공통 컴포넌트·상태
- [공통 UI 사용법](docs/common-ui.md): 컴포넌트 적용·테마 수정·미리보기 동작
- [API 계약](docs/api-contract.md): 백엔드와 합의할 항목
- [초기 구성](docs/bootstrap.md): 구성 방법과 검증
- [결정 기록](docs/decisions.md): 초기 구성 선택과 근거
- [초기 검토 기록](docs/bootstrap-review.md): 이번 구성의 검증 결과와 남은 확인

GitHub에서 이슈가 생성될 때 자동으로 Codex를 시작하는 별도 자동화는 포함하지 않습니다.
프로젝트 설정이 현재 채팅의 모델을 즉시 변경하지는 않습니다. 새 세션에서 지침·스킬·모델 접근과 실제 역할 실행을 확인합니다.

첫 요청 예시: “여행 일정 편집 중 날짜를 바꾸면 항목이 사라지는 문제를 고쳐 주세요.” 비단순 버그는 먼저 별도 GPT-6.1 Sol high planner가 파일 범위·상태·작업 분리·검사 기준을 정리하고, root가 그 계획을 확인한 뒤 구현을 배정합니다. 완료 보고에는 실제로 실행된 planner·worker·reviewer 모델을 구분해 적습니다. 역할 설정만으로 실행을 주장하지 않습니다.

## 최초 참여자가 확인할 것

1. 위 Node/npm 환경에서 `npm ci`와 `npm run check`를 실행합니다.
2. 이 레포를 Codex 프로젝트로 열고 AGENTS.md와 팀 스킬 인식을 확인합니다.
3. PR 제출을 위해 GitHub CLI를 설치하고 `gh auth login`으로 로그인합니다. `gh auth status`와 레포 쓰기 권한을 확인합니다. 토큰은 레포에 저장하지 않습니다.
4. 레포 관리자는 main의 PR·리뷰 보호 정책을 확인합니다. CI 필수 검사는 이 초기 구성에 포함하지 않습니다.
5. API 계약은 기능별로 백엔드와 합의합니다. 합의 전 화면 데이터는 mock으로 구분합니다.
