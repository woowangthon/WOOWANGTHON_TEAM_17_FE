# 에이전트 운영

## 역할

|역할|모델|책임|
|---|---|---|
|root|Astra medium|요구사항·UI 구조·작업 분리·통합·최종 판단|
|explorer|Luna high|관련 코드·수정 범위 확인|
|worker|Luna high|정해진 파일의 구현|
|tester|Luna high|타입·빌드·기능·브라우저 검사|
|reviewer|Astra medium|독립 검토와 문제 보고|

동시 하위 에이전트는 최대 2개로 시작한다. 모든 작업에서 모든 역할을 실행하지 않는다. 별도 researcher 역할은 초기에는 두지 않는다.

## 작업 분리

- 작은 문구·색상·단일 요소 수정: root 직접 처리 가능.
- 여러 파일에 걸친 기능: root가 기준 확정 → Luna 구현 → 필요한 검증 → root 통합.
- API·개인정보·확정·저장 버전 변경: 독립 검토를 추가.
- 병렬 작업: 독립된 파일일 때만. theme.css·Button·공통 타입은 한 작성자만 수정.

위임에는 목표, 파일 범위, 유지할 동작, 데이터 계약, 완료 기준을 적는다. 작업자는 결과·파일·검사·미해결 사항만 간결하게 반환한다.

## 설정과 문서의 차이

- 루트 AGENTS.md: 언제·어떻게 위임할지.
- .codex/config.toml: root·기본 하위 모델·동시 실행 수.
- .codex/agents/*.toml: 역할별 모델·추론 수준·지침.
- .agents/skills/: 선택한 작업의 절차.

문서에 모델 이름을 쓰는 것만으로 해당 모델이 실행되는 것은 아니다. 새 세션에서 적용된 모델과 실제 하위 에이전트 기록을 확인한다. 설정이 동작하는 Codex 버전·신뢰된 프로젝트·모델 접근 권한이 필요하다.

권한·sandbox는 부모 실행 환경을 따른다. reviewer의 '수정하지 않음'은 행동 지침이며 역할 TOML 하나로 읽기 전용 sandbox가 보장되는 것으로 취급하지 않는다. 팀 공용 설정은 개인 승인·보안 설정을 변경하지 않는다.

## 원본과 차이

[참고 저장소](https://github.com/donvito/codex-astra-luna-orchestrator)의 역할 분리 개념을 참고했다. 원본 스킬·설치기는 복사하지 않았다. 이 세트는 작은 프론트 팀용으로 별도 작성했다.

- Luna 기본 추론은 max 대신 high로 시작.
- 동시 하위 에이전트 2개.
- 단순 질문·색상 변경까지 일괄 위임하지 않음.
- 실제 확인하지 않은 모델 실행이나 UI 검증을 보고하지 않음.

스킬과 에이전트를 늘리기보다 작업 결과를 보고 필요한 역할만 추가한다. 이 설정의 비용·속도 우위는 실측 전 확정할 수 없다.

공식 기준: [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Skills](https://learn.chatgpt.com/docs/build-skills).
