# 기능 요청부터 PR까지

## 기본 흐름

이슈 연결 → 작업 브랜치 → 계획 → 구현 → Codex 검사·수정·재검증 → 커밋·push → PR 보고서 → 사람의 리뷰·병합.

**GitHub CI는 사용하지 않는다.** Codex가 타입·lint·빌드·관련 기능 검사와 필요한 UI 검증을 실행한다. 설명·조사만 요청하거나 로컬 작업만 지정하면 해당 범위를 따른다.

## 새 레포에서 한 번 할 일

1. 초기 앱·package-lock.json·typecheck/lint/build scripts를 준비한다.
2. AGENTS.md, .agents/, .codex/, docs/, .github/의 이슈·PR 양식을 적용한다.
3. Git·Node·GitHub CLI를 설치하고 작업할 계정으로 gh auth login을 수행한다.
4. gh auth status, git remote -v, gh repo view로 계정·대상 레포·권한을 확인한다. 토큰을 출력하지 않는다.
5. Git commit identity와 push 인증을 확인한다.
6. 지원되는 경우 main 보호에 PR 경유·사람의 리뷰를 설정한다. CI 필수 검사 조건은 추가하지 않는다.

대상 레포는 https://github.com/woowangthon/WOOWANGTHON_TEAM_17_FE 이다. 로컬 origin과 main 추적 연결은 확인했다. 원격 최신 상태·인증·쓰기 권한·브랜치 보호는 전달 시점에 확인한다. 이미 운영 중인 워크플로·보호 규칙을 별도 승인 없이 삭제하거나 우회하지 않는다.

## 기록 규칙

|항목|규칙|
|---|---|
|이슈|기존 이슈 우선. 없으면 목적·완료 조건으로 1개 생성|
|브랜치|codex/<이슈번호>-<짧은-목적>|
|커밋|feat/fix/refactor/test/docs/chore: 변경 목적|
|PR|작업당 1개. 후속 수정은 같은 브랜치·PR에 추가|
|보고서|PR 본문에 최신 결과와 검증한 최종 head SHA 기록|
|이슈 종료|완료된 기능은 기본 브랜치 대상 PR에 Closes #번호. 일부 진행은 Refs #번호|

## 작업 절차

### 시작·구현

- 대상 레포·remote·base·기존 브랜치·PR을 확인한다. 여러 작업은 별도 worktree나 clone을 사용한다.
- 사용자 변경을 보존하고 이번 작업과 분리한다. 원격 기준을 확인한 작업 브랜치에서 진행한다.
- Astra는 범위·완료 기준을 정하고 Luna에 파일 소유권을 지정한다. worker는 별도 지시 없이 커밋·push하지 않는다.
- 미합의 API는 mocks와 실제 연결을 구분한다.

### Codex 검증

- 마지막 코드 변경 후 package.json의 typecheck·lint·build 및 관련 기능 검사를 실행한다.
- UI 변경은 브라우저에서 대상 화면·입력 오류·반응형·키보드·모달 등의 실제 동작을 확인한다.
- 검토에서 찾은 문제를 수정하고 영향받는 검사를 다시 실행한다.
- 명령별 결과, 브라우저 확인 방법, 증거, 미실행 이유를 기록한다. 빌드 통과를 UI 검증으로 대신하지 않는다.
- 필수 검증이 불가능하거나 같은 원인으로 반복 실패하면 원인과 남은 작업을 정리한다.

### PR 제출

- root가 최종 diff와 포함 파일을 확인하고 작업 파일만 stage한다. git add .로 관계없는 사용자 변경을 섞지 않는다.
- 의도한 브랜치에 커밋·push한다. 최종 코드가 검증 대상과 같은지 확인하고 head SHA를 기록한다.
- .github/pull_request_template.md로 Draft PR을 작성하거나 기존 PR을 갱신한다. 결과가 불명확하면 재생성 전에 존재 여부부터 조회한다.
- 필요한 검사·기능/UI 확인·중요한 검토 지적이 해결되면 Ready for review로 전환한다. CI 유무·결과는 완료 판단에 사용하지 않는다.
- 필수 검증 미실행·미해결 문제는 Draft에 이유를 남긴다. GitHub 인증·네트워크로 PR 생성이 막히면 로컬 결과와 필요한 조치를 보고한다.
- PR에 올라간 코드가 이후 변경되면 변경 범위의 검증과 보고서를 갱신한다. 검증 SHA와 PR의 최신 head가 다르면 그 차이를 설명한다.

## PR 보고서

변경 목적, 관련 이슈, 주요 변경, 타입·lint·빌드·기능·브라우저 검사 결과, 검증 SHA, 독립 검토 결과, 화면 증거·재현 방법, 남은 사항을 작성한다. 통과·실패·미실행·해당없음을 구분하고, 필수 항목의 미실행은 Ready로 제출하지 않는다.

로컬 파일 경로를 GitHub에서 볼 수 있는 캡처 링크처럼 적지 않는다. 실제로 공유 가능한 첨부·프리뷰나 재현 방법을 제공한다. 이슈·PR 본문은 구조화 인수 또는 임시 본문 파일로 전달한다.

## 명령 예시

실제 remote·base·head·번호를 확인한 뒤 사용한다.

```sh
gh auth status
git status --short
git remote -v

# 구현·검증 후 관련 파일만 stage·commit
git diff --check
git diff --cached
git push -u origin codex/12-room-invite
git rev-parse HEAD
gh pr create --base main --head codex/12-room-invite --draft --title "feat: 초대 코드로 여행방 참여" --body-file .agent-work/pr-body.md

# Codex 검사와 검토 완료 후
gh pr ready 34
```

.agent-work/는 임시 기록용이며 Git에 올리지 않는다. 자동 병합·main 직접 push·force push는 기본 작업 범위에 포함하지 않는다. 사람만 리뷰·병합한다.

PR·이슈 이벤트가 발생했을 때 AI가 자동으로 시작되는 기능은 별도 자동화이며 이 설정에는 포함하지 않는다.

참고: [PR 생성](https://cli.github.com/manual/gh_pr_create), [이슈 연결](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).
