# 우왕톤 · 충북 단체여행 프론트엔드

React + TypeScript + Vite + Tailwind 기반의 프론트엔드 레포지토리입니다.
현재는 공통 UI 확인 화면과 개발·에이전트 작업 환경을 구성한 초기 단계입니다.
여행방 생성, 사용자 인증, AI 일정 생성과 서버 저장은 아직 연결하지 않았습니다.

## 시작하기

- 개발 기준: Node.js 24.15.0, npm 11.12.1
- 지원 범위: Node.js 24.x (`package.json`의 `engines` 참고)
- 패키지 관리자: npm. `package-lock.json`을 함께 관리합니다.
- `.node-version`은 사용하지 않습니다. `engines`는 버전 안내이며 Node를 설치하거나 전환하지 않습니다.

```sh
npm ci
npm run dev
```

터미널에 표시되는 로컬 주소에서 공통 버튼·입력·모달을 확인합니다.
초기 화면은 백엔드 없이 실행됩니다. API 연결이 필요한 시점에 `.env.example`을 `.env.local`로 복사하고 `VITE_API_BASE_URL`을 설정합니다.
`VITE_` 변수는 브라우저에 공개되므로 비밀키를 넣지 않습니다.

## 명령

| 명령 | 역할 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run typecheck` | 앱·설정 TypeScript 검사 |
| `npm run lint` | Oxlint 검사 |
| `npm run build` | 타입 검사 후 배포용 `dist/` 생성 |
| `npm run preview` | 빌드 결과 로컬 확인 |
| `npm run check` | 타입·lint·빌드 순서대로 실행 |

GitHub CI는 추가하지 않습니다. Codex가 로컬 검사와 변경에 필요한 기능·브라우저 검증을 실행하고 PR에 결과를 기록합니다.
빌드 통과와 브라우저 검증은 별개입니다.

## 구조

```text
src/
  app/             앱 진입과 화면 조립
  pages/           화면
  components/ui/   공통 버튼·입력·모달
  styles/          디자인 토큰·전역 스타일
```

실제 기능을 구현할 때 `features/trip`, `features/profile`, `features/plan`과 공통 유틸 `lib/`를 필요에 따라 추가합니다. Mantine 참고 예제는 앱에 포함하지 않았습니다.

## 팀 작업과 에이전트

기능 구현·버그 수정의 기본 완료 범위는 **이슈 연결 → 작업 브랜치 → 구현·검증 → 커밋·푸시 → PR 제출**입니다. 병합은 사람이 합니다. 설명 요청과 명시적인 로컬 작업은 해당 범위를 따릅니다.

- [AGENTS.md](AGENTS.md): 항상 적용할 작업 규칙
- [GitHub 작업 절차](docs/github-workflow.md): 이슈·브랜치·검증·PR 보고서
- [에이전트 역할](docs/orchestration.md): Astra medium 설계·통합·검토, Luna high 탐색·구현·검증, 동시 하위 에이전트 최대 2개
- [팀 스킬](docs/skills.md): implement-feature, review-ui, deliver-pr
- [UI 기준](docs/ui-guide.md): 색상·공통 컴포넌트·상태
- [API 계약](docs/api-contract.md): 백엔드와 합의할 항목
- [초기 구성](docs/bootstrap.md): 구성 방법과 검증
- [결정 기록](docs/decisions.md): 초기 구성 선택과 근거
- [초기 검토 기록](docs/bootstrap-review.md): 이번 구성의 검증 결과와 남은 확인

GitHub에서 이슈가 생성될 때 자동으로 Codex를 시작하는 별도 자동화는 포함하지 않습니다.
프로젝트 설정이 현재 채팅의 모델을 즉시 변경하지는 않습니다. 새 세션에서 지침·스킬·모델 접근과 실제 역할 실행을 확인합니다.

## 최초 참여자가 확인할 것

1. 위 Node/npm 환경에서 `npm ci`와 `npm run check`를 실행합니다.
2. 이 레포를 Codex 프로젝트로 열고 AGENTS.md와 팀 스킬 인식을 확인합니다.
3. PR 제출을 위해 GitHub CLI를 설치하고 `gh auth login`으로 로그인합니다. `gh auth status`와 레포 쓰기 권한을 확인합니다. 토큰은 레포에 저장하지 않습니다.
4. 레포 관리자는 main의 PR·리뷰 보호 정책을 확인합니다. CI 필수 검사는 이 초기 구성에 포함하지 않습니다.
5. API 계약은 기능별로 백엔드와 합의합니다. 합의 전 화면 데이터는 mock으로 구분합니다.
