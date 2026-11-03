type ConditionCardProps = {
  title: string;
  description?: string;
  items: readonly { label: string; value: string }[];
  notice?: string;
  onEdit?: () => void;
  editDisabled?: boolean;
};

export default function ConditionCard({ title, description, items, notice, onEdit, editDisabled = false }: ConditionCardProps) {
  return (
    <section className="condition-card" aria-label={title}>
      <header className="condition-card-header">
        <div className="condition-card-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>
        {onEdit && <button type="button" className="btn btn-secondary condition-edit" onClick={onEdit} disabled={editDisabled}>조건 수정</button>}
      </header>
      <dl className="condition-list">
        {items.map(({ label, value }, index) => <div className="condition-row" key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {notice && <p className="condition-notice">{notice}</p>}
    </section>
  );
}
