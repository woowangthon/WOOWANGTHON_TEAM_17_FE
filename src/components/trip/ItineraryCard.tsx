export type ItineraryItem = {
  id: string;
  startTime: string;
  endTime: string;
  title: string;
  durationLabel: string;
  category: string;
  description: string;
  costLabel?: string;
  notice?: string;
  travelAfter?: string;
};

type ItineraryCardProps = { item: ItineraryItem; selected: boolean; onSelect: (id: string) => void; detailId: string };

export default function ItineraryCard({ item, selected, onSelect, detailId }: ItineraryCardProps) {
  return (
    <article className={`itinerary-entry${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="itinerary-card"
        aria-pressed={selected}
        aria-controls={detailId}
        onClick={() => onSelect(item.id)}
      >
        <span className="itinerary-time"><time>{item.startTime}</time><span aria-hidden="true">–</span><time>{item.endTime}</time></span>
        <span className="itinerary-card-content">
          <span className="itinerary-title">{item.title}</span>
          <span className="itinerary-meta"><span>{item.category}</span><span aria-hidden="true">·</span><span>{item.durationLabel}</span></span>
        </span>
        <span className="itinerary-select-indicator" aria-hidden="true">{selected ? '선택됨' : '상세 보기'}</span>
      </button>
      {item.travelAfter && <p className="itinerary-travel">이동 <span>{item.travelAfter}</span></p>}
    </article>
  );
}
