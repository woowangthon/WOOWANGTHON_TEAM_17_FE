# 공통 UI 사용법

이 문서는 재사용 가능한 UI와 이를 조립한 미리보기의 경계를 설명한다. `npm run dev`에서 예시 데이터로 입력·선택·확정·실패·재시도를 확인한다. 실제 서버 저장·여행방 생성·지도·인증 기능은 연결하지 않는다.

## 파일 위치

| 위치 | 역할 |
| --- | --- |
| src/components/ui/ | Button, Input, Dialog, AsyncState 기본 요소 |
| src/components/trip/ | ConditionCard, ParticipantStatus, ItineraryCard, ItineraryDetail |
| src/styles/theme.css | 공통 색·간격·모서리·글꼴·상태 토큰 |
| src/styles/components.css | 공통 컴포넌트 스타일 |
| src/styles/preview.css | 미리보기 화면 전용 배치 |
| src/features/ui-preview/ | 예시 데이터·비동기 mock·미리보기 상태 처리 |
| src/pages/UiPreviewPage.tsx | 컴포넌트 조립과 로컬 동작 예제 |

스타일 진입점은 src/styles/globals.css이며 index.html의 head에서 직접 불러온다. 이 경로로 앱 초기 렌더링 전부터 전역 스타일이 적용된다. 공통 색 변경은 theme.css, 전체 버튼 모양 변경은 components.css, 특정 화면 배치는 그 화면 스타일에서 관리한다. 새 디자인 값은 기존 토큰을 우선 재사용한다.

## 참여자 상태

두 상태만 사용한다. 이름·본인 여부·상태만 표시하며 개인 취향·제약 원문은 공유하지 않는다.

```tsx
import ParticipantStatus from '../components/trip/ParticipantStatus';

<ParticipantStatus name="여행자 A" status="writing" isSelf />
<ParticipantStatus name="여행자 B" status="confirmed" />
```

- writing → 작성중
- confirmed → 확정 완료

색과 함께 텍스트를 표시한다. 실제 권한과 확정 상태는 향후 서버 응답을 기준으로 연결한다.

## 공통 조건 카드

```tsx
import ConditionCard from '../components/trip/ConditionCard';

<ConditionCard
  title="함께 정한 여행 조건"
  items={[
    { label: '여행지', value: '충북 단양' },
    { label: '전체 예산', value: '600,000원' },
  ]}
  notice="공통 조건 변경 후에는 참여자 재확인이 필요해요."
  onEdit={() => setEditOpen(true)}
/>
```

onEdit가 있을 때만 수정 버튼을 표시하고 editDisabled로 조작을 잠글 수 있다. 위 예제의 setEditOpen은 호출 화면에서 관리한다. 조건 카드가 직접 API를 호출하지 않는다. 미리보기의 재확인은 본인 예시 상태에 연결되어 있으며 실제 참여자 전체의 상태 동기화는 서버 계약에 따라 구현한다.

## 일정 카드·상세

```tsx
import ItineraryCard from '../components/trip/ItineraryCard';
import ItineraryDetail from '../components/trip/ItineraryDetail';

<ItineraryCard
  item={item}
  selected={selectedId === item.id}
  onSelect={setSelectedId}
  detailId="itinerary-detail"
/>
<ItineraryDetail item={selectedItem} id="itinerary-detail" />
```

item, selectedItem, selectedId와 setSelectedId는 화면이 관리한다. 데이터 형식은 ItineraryCard의 exported ItineraryItem을 따른다. 시간·장소명·기간·분류·설명과 선택적 추정 비용·주의·다음 이동 정보를 제공한다.

카드는 실제 button으로 선택하고 aria-pressed로 선택 상태를 알린다. 이동 설명은 카드 버튼 밖에 표시한다. 목록과 상세는 같은 선택 상태를 참조하고, 목록이 비었으면 상세 대신 빈 상태를 표시한다. 비용에는 전체/1인 기준과 추정 여부를 구분한다.

## 입력·로딩·확인 동작

- Input은 label, hint, error와 접근성 속성을 연결한다. 값 검증·입력 보존·요청 처리는 호출 화면이 맡는다.
- Button의 loading/loadingLabel을 사용하면 진행 문구와 비활성 상태를 함께 표시한다. 빠른 연속 요청을 막는 동기 잠금은 요청 로직에도 둔다.
- Dialog는 open/onClose로 제어하고 onConfirm으로 확인 동작을 연결한다. 기본 확인은 닫기이며, 저장·확정은 호출 화면의 명시적 콜백으로 수행한다.
- Dialog의 pending 동안 버튼과 Escape 종료를 막는다. 완료 후 닫고 원래 버튼으로 포커스를 돌린다. 비동기 작업 후 열 때는 returnFocusRef로 복귀할 버튼을 명시할 수 있다.
- 실패 시 입력을 보존하고 원인을 안내한다. 재시도는 실패한 입력을 기준으로 하며, 입력 변경 후에는 이전 오류·재시도 상태를 초기화한다.

```tsx
<Button type="submit" loading={pending} loadingLabel="저장 중…">
  저장
</Button>

<AsyncState status="loading" title="일정을 불러오는 중이에요" />
<AsyncState status="empty" title="아직 일정이 없어요" />
<AsyncState
  status="error"
  title="일정을 불러오지 못했어요"
  onRetry={retry}
/>
```

pending과 retry는 호출 화면에서 제공한다. 미리보기의 mock은 지연·실패·성공을 재현하는 예시이며 실제 API 계약이 아니다.

## 확인할 동작

- 공백 입력 오류, 수정 후 오류 해제, 요청 중 값 유지와 중복 제출 방지
- 실패 후 재시도, 성공 안내, 확인 동작과 초점 복귀
- 조건 수정 후 재확인 안내, 참여자 상태 변경
- 일정 카드 클릭·Enter·Space 선택과 상세 동기화
- 320px·390px·데스크톱 배치, 긴 이름·제목·설명 줄바꿈
- Tab 이동, Escape, 보이는 포커스, 오류·로딩·선택 상태 알림

컴포넌트를 재사용하는 각 기능에서도 해당 화면의 API·권한·경합·예외 동작을 별도로 검증한다. UI 예제의 완료를 서비스 전체 연결 완료로 취급하지 않는다.

## 개발 체크리스트 적용 범위

아래는 공통 컴포넌트와 로컬 미리보기 기준이다. 실제 서비스 화면의 API·데이터 연결 완료를 의미하지 않는다.

| 항목 | 구현 근거 |
| --- | --- |
| 공통 글자·색상·간격 | theme.css 토큰, components.css 공통 규칙 |
| 입력창·버튼·확인창 | Input, Button, Dialog |
| 조건·참여자 상태·일정 카드 | ConditionCard, ParticipantStatus, ItineraryCard, ItineraryDetail |
| 입력값·오류·로딩 연결 | 미리보기 폼 상태와 지연·실패 mock |
| 카드별 내용·동작 연결 | 조건 수정, 본인 상태 확정, 일정 선택·상세 동기화 |
| 중복 클릭 방지·초점 복원 | 동기 ref 잠금, loading/pending, Dialog 복귀 대상과 실패 후 재시도 초점 |
| 빈 결과·오류·재시도 | AsyncState와 독립 상태 예제 |
| 긴 문구·작은 화면 | 줄바꿈·축소 가능한 grid, 모바일 세로 배치 |
| 키보드·상태 문구 | native 버튼·폼·dialog, aria-pressed/controls, 오류 알림과 polite 상태 안내 |
