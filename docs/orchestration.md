# 에이전트 운영

## 역할

|역할|모델|책임|
|---|---|---|
|root|세션에서 선택된 모델|요구사항·조정·인수 기준·통합·최종 검사·Git 작업|
|planner|Astra medium|비단순 기능·동작·버그 작업의 선행 계획|
|explorer|Luna high|관련 코드·수정 범위 확인|
|worker|Luna high|정해진 파일의 구현|
|tester|Luna high|타입·빌드·기능·브라우저 검사|
|reviewer|Astra medium|독립 검토와 문제 보고|

비단순 기능·동작 변경·버그 수정은 root 모델이 Astra여도 별도 Astra medium planner가 먼저 계획한다. root는 결과를 받은 뒤에만 Luna 구현 작업을 배정한다. 동시 하위 에이전트는 최대 2개로 유지하고, 단계가 다른 planner와 worker는 순차 실행한다. 작은 문구·토큰·단일 요소 수정과 설명 요청에는 planner를 두지 않는다. 사용자 지정 범위와 모델을 우선한다. 별도 researcher 역할은 두지 않는다.

## 작업 분리

- 작은 문구·토큰·단일 요소 수정, 설명 요청: root 직접 처리 가능.
- 비단순 기능·동작 변경·버그 수정: 별도 Astra medium planner → root가 계획 확인·작업 분배 → Luna high 구현 → 필요한 검증·독립 검토 → root 통합.
- API·개인정보·확정·저장 버전 변경: 독립 검토를 추가.
- 병렬 작업: 독립된 파일일 때만. theme.css·Button·공통 타입은 한 작성자만 수정.

planner는 사용자에게 보이는 결과, 대상 파일, API/mock 제약, UI 상태와 접근성 위험, 파일 소유권·의존성이 정해진 작업, 인수 기준·검사, 열린 질문을 반환한다. root는 이 결과를 바탕으로 작업자별 목표·파일 범위·유지할 동작·데이터 계약·완료 기준을 정한다. 작업자는 결과·파일·검사·미해결 사항만 간결하게 root에 보고한다.

planner·worker·tester·reviewer는 하위 에이전트를 다시 만들거나 전체 PR 절차를 반복하지 않는다. root만 오케스트레이션을 시작하고 인수·통합·최종 검사·Git 전달을 책임진다. planner 역할 TOML은 실제 Astra medium 모델을 고정한다. `.codex/config.toml`의 root 기본값은 세션에서 선택된 root 모델을 전환하지 않는다.

planner 역할 호출을 지원하지 않으면 planner.toml의 지침을 적용해 Astra medium을 명시적으로 선택한 별도 하위 에이전트로 실행하고 해당 대체 경로를 보고한다. 명명된 역할 또는 명시적 Astra medium planner 실행이 모두 불가능하면 정확한 제한을 보고하고, 독립된 읽기 전용 탐색만 계속한다. 계획에 의존하는 구현은 시작하지 말고 사용자에게 수정된 진행 방식을 요청한다. 사용자가 명시한 모델·범위는 우선한다.

## 설정과 문서의 차이

API 작업에서 FE root는 docs/api-contract.md에 따라 Notion 조회·규격 작성·적용 기준 판단을 맡는다. planner·worker·tester·reviewer는 root가 제공한 명세 내용과 상태를 사용하고 필요한 변경·문제를 root에 보고한다. FE는 담당이 겹치면 API별 작성자를 정하며, BE는 규격 본문을 임의 변경하지 않고 구현·검증과 상태·BE PR 링크 갱신을 맡는다. 의미 있는 명세 변경은 root가 영향을 확인하고 해당 부분의 수정·재검증을 조정한다.

- 루트 AGENTS.md: 언제·어떻게 위임할지.
- .codex/config.toml: root·기본 하위 모델·동시 실행 수.
- .codex/agents/*.toml: 역할별 모델·추론 수준·지침.
- .agents/skills/: 선택한 작업의 절차.

문서에 모델 이름을 쓰는 것만으로 해당 모델이 실행되는 것은 아니다. 새 세션에서 적용된 모델과 실제 하위 에이전트 기록을 확인한다. 설정이 동작하는 Codex 버전·신뢰된 프로젝트·모델 접근 권한이 필요하다.

권한·sandbox는 부모 실행 환경을 따른다. planner·reviewer의 '수정하지 않음'은 행동 지침이며 역할 TOML 하나로 읽기 전용 sandbox가 보장되는 것으로 취급하지 않는다. 팀 공용 설정은 개인 승인·보안 설정을 변경하지 않는다.

## 원본과 차이

[참고 저장소](https://github.com/donvito/codex-astra-luna-orchestrator)의 역할 분리 개념을 참고했다. 원본 스킬·설치기는 복사하지 않았다. 이 세트는 작은 프론트 팀용으로 별도 작성했다.

- Luna 기본 추론은 max 대신 high로 시작.
- 동시 하위 에이전트 2개.
- 작은 편집·설명 요청까지 일괄 위임하지 않음.
- 실제 확인하지 않은 모델 실행이나 UI 검증을 보고하지 않음.

스킬과 에이전트를 늘리기보다 작업 결과를 보고 필요한 역할만 추가한다. 이 설정의 비용·속도 우위는 실측 전 확정할 수 없다.

공식 기준: [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Skills](https://learn.chatgpt.com/docs/build-skills).
