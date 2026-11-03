# Frontend rules

## 프로젝트
- React + TypeScript + Vite + Tailwind 기반 충북 단체여행 플래너다.
- 초기 앱은 공통 UI 확인 화면이다. 실제 여행방·일정 API 기능과 구분한다.
- 현재 상태와 명령은 package.json 및 README에서 확인한다.

## 기준 문서
- 디자인·컴포넌트: docs/ui-guide.md
- 작업 분리·모델: docs/orchestration.md
- API·미합의 항목: docs/api-contract.md
- 스킬·출처: docs/skills.md
- GitHub 작업·완료 기준: docs/github-workflow.md
- 관련 문서만 읽는다. 최신 코드와 합의된 계약을 기준으로 한다.

## 구현
- pages는 화면 조립, features는 기능 UI·상태·API, components/ui는 공통 기반이다.
- 스타일 값은 src/styles/theme.css의 토큰을 사용한다.
- 연두색 포인트와 기존 공통 컴포넌트를 재사용한다.
- 입력 유지, 로딩·오류·빈 상태, 재확인·버전 충돌을 다룬다.
- 개인 원문은 본인 전용이다. 프론트에서 DB·AI 비밀키를 다루지 않는다.
- 합의되지 않은 API는 mocks와 실제 연결을 구분한다.

## 에이전트
- 복합 구현은 implement-feature 스킬과 docs/orchestration.md를 따른다.
- root는 설계·분리·통합·최종 검증을 맡는다. 명확한 구현은 Luna worker에 위임한다.
- 작은 문구·토큰 수정과 단순 질문은 root가 처리할 수 있다.
- 파일별 작성자를 지정한다. 공통 theme·Button·API 타입을 동시에 수정하지 않는다.
- 사용자가 지정한 작업 범위와 모델 선택을 우선한다.
- 요청한 모델을 사용할 수 없으면 대체 실행을 숨기지 않는다.

## 검증·보고
- package.json에 등록된 typecheck·lint·build와 관련 검사를 실행한다.
- Node 지원 범위는 package.json의 engines, 개발 기준 버전은 README를 따른다. .node-version은 사용하지 않는다.
- UI 변경은 대표 화면 크기·입력 오류·키보드·모달 동작을 확인한다.
- 실행 못 한 검사는 이유를 기록한다. 빌드만으로 UI 검수가 끝났다고 하지 않는다.
- 규칙·API·컴포넌트 계약 변경은 관련 docs와 함께 반영한다.
- 완료 시 변경 파일·검증 결과·남은 사항을 짧게 보고한다.

## 기본 작업 단위: PR 제출
- 이 레포의 기능 구현·버그 수정 요청은 별도 제한이 없으면 이슈 연결, 작업 브랜치, 구현·검증·수정, 커밋·push, PR 보고서와 Codex 검증 결과 제출까지 포함한다.
- 설명·조사만 요청한 경우 이슈·브랜치·PR을 만들지 않는다. 사용자가 로컬 작업만 요구하면 그 범위를 따른다.
- docs/github-workflow.md와 deliver-pr 스킬에 따라 root가 GitHub 작업을 담당한다. worker는 별도 지시 없이 커밋·push하지 않는다.
- 대상 레포·remote·기준 브랜치·GitHub 권한을 확인한다. 사용자 변경을 섞어 커밋하지 않는다.
- Codex가 필요한 검사·UI 검증·검토를 마쳐야 Ready PR로 제출한다. 미해결·필수 검증 미실행이면 Draft로 남기고 정확한 이유를 보고한다.
- GitHub CI는 초기 구성에서 제외한다. 사용자 요청 없이 워크플로를 추가하거나 CI 통과를 완료 조건으로 요구하지 않는다. 기존 레포의 CI·보호 규칙은 별도 승인 없이 제거하지 않는다.
- 마지막 코드 변경 후 검증하고 최종 head 커밋을 PR에 기록한다.
- PR 링크 없이 PR 제출 완료라고 하지 않는다. 자동 병합·main 직접 push·force push는 기본 범위에 포함하지 않는다.
