# 공용 스킬

## 포함됨

|이름|출처|목적|
|---|---|---|
|implement-feature|이 프로젝트 작성|기능 구현·작업 분리·검증|
|review-ui|이 프로젝트 작성|디자인·상태·사용 흐름 검토|
|deliver-pr|이 프로젝트 작성|이슈·브랜치·커밋·PR 보고서·Codex 검증 인계|

공통 지침은 AGENTS.md, 상세 디자인은 ui-guide.md, 모델 설정은 .codex/에서 관리한다. 같은 내용을 각 스킬에 중복하지 않는다.

## 추가 후보 — 아직 미설치

|스킬|원본|도입 시점|
|---|---|---|
|frontend-design|https://github.com/anthropics/skills/tree/main/skills/frontend-design|첫 시각 디자인 작업 전|
|web-design-guidelines|https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines|UI 검토 기준 확장 시|
|shadcn|https://ui.shadcn.com/docs/skills|shadcn/ui 채택 후|

외부 스킬을 가져올 때는 해당 폴더와 필요한 참조·라이선스를 함께 커밋하고 원본 전체 SHA·원본 경로·라이선스·로컬 변경을 아래에 기록한다. 매 작업마다 최신본으로 덮어쓰지 않고 업데이트 PR을 검토한다. 개인 설치본과 같은 이름을 중복 사용하지 않도록 확인한다.

기록 양식: 이름 / 저장소 / 전체 커밋 SHA / 경로 / 라이선스 / 필요 도구 / 로컬 변경.

추가 스킬은 디자인·검토 방법을 보완한다. 모델 라우팅을 바꾸는 별도 오케스트레이터를 여러 개 겹쳐 설치하지 않는다.
