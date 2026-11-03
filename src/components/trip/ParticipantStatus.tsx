export type ParticipantState = 'writing' | 'confirmed';

type ParticipantStatusProps = { name: string; status: ParticipantState; isSelf?: boolean };

export default function ParticipantStatus({ name, status, isSelf = false }: ParticipantStatusProps) {
  const isConfirmed = status === 'confirmed';
  return (
    <div className={`participant-status ${isConfirmed ? 'is-confirmed' : 'is-writing'}`}>
      <span className="participant-status-name">{name}{isSelf && <span className="participant-self">나</span>}</span>
      <span className="participant-status-label">{isConfirmed ? '확정 완료' : '작성중'}</span>
    </div>
  );
}
