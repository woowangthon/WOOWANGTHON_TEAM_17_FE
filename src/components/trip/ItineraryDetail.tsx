import type { ItineraryItem } from './ItineraryCard';

type ItineraryDetailProps = { item: ItineraryItem; id: string };

export default function ItineraryDetail({ item, id }: ItineraryDetailProps) {
  return (
    <section className="itinerary-detail" id={id} aria-labelledby={`${id}-title`}>
      <header className="itinerary-detail-header">
        <div><p className="itinerary-detail-kicker">{item.category}</p><h2 id={`${id}-title`}>{item.title}</h2></div>
        <p className="itinerary-detail-time"><span className="itinerary-detail-range"><time>{item.startTime}</time>–<time>{item.endTime}</time></span><span>{item.durationLabel}</span></p>
      </header>
      <p className="itinerary-detail-description">{item.description}</p>
      {item.costLabel && <p className="itinerary-detail-cost"><span>예상 비용</span><strong>{item.costLabel}</strong></p>}
      {item.notice && <p className="itinerary-detail-notice">{item.notice}</p>}
    </section>
  );
}
