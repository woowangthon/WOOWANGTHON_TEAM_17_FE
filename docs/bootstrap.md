# 초기 앱 구성

현재 레포에는 Vite React TypeScript 앱과 Tailwind Vite 플러그인, 공통 UI 확인 화면이 있다. 기존 레포에 create-vite를 다시 실행하지 않는다.

## 구성 순서

1. 기존 README와 Git 이력을 보존하고 codex/frontend-bootstrap 로컬 브랜치에서 작업했다.
2. 공식 Vite react-ts 템플릿을 임시 폴더에 생성한 뒤 package·TypeScript·Vite 설정을 가져오고 Oxlint 검사를 연결했다.
3. Tailwind Vite 플러그인과 src/styles/globals.css의 Tailwind import를 연결했다.
4. src/styles/theme.css에 디자인 토큰을 두고 공통 버튼·입력·모달과 확인 화면을 구성했다.
5. AGENTS.md, .agents/skills, .codex, .github, docs를 적용했다. README와 package.json을 실제 실행 명령에 맞췄다.

## 실행·검증

npm ci로 설치하고 npm run dev로 실행한다. 정적 검사는 npm run check로 수행한다.
브라우저에서는 빈 입력 오류, 입력 수정, 확인 모달 열기·닫기, Escape, 키보드 포커스와 좁은 화면을 확인한다.
검증 결과는 실제 수행 여부와 함께 PR에 기록한다. 공통 UI 예제는 서버 저장이나 실제 방 생성을 수행하지 않는다.

Node 버전은 README와 package.json engines로 안내하며 .node-version은 사용하지 않는다. package-lock.json은 커밋한다.
GitHub CI는 추가하지 않는다. 새 Codex 세션에서 프로젝트 신뢰·지침·스킬·모델 설정 인식을 확인한다.
설정 파일 복사나 TOML 파싱 성공만으로 특정 모델이 실행됐다고 판단하지 않는다.

API·라우터·서버 캐시·폼 라이브러리는 실제 기능 요구와 합의에 따라 추가한다. 원본 Mantine 예제는 포함하지 않는다.

공식 기준: [Vite](https://vite.dev/guide/), [Tailwind Vite 플러그인](https://tailwindcss.com/docs/installation/using-vite).
