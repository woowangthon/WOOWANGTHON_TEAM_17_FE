import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Plan } from './generationApi';
import { isValidWgs84, verifiedEdgeGeometry } from './mapUtils';

declare global { interface Window { kakao?: any; __kakaoMapPromise?: Promise<any> } }

type CourseNode = Plan['document']['days'][number]['nodes'][number];
type CourseEdge = Plan['document']['days'][number]['edges'][number];
type MapNode = Pick<CourseNode, 'id' | 'title' | 'coordinate'>;
type Props = { nodes: CourseNode[]; edges: CourseEdge[]; selectedId: string | null; onSelect: (id: string) => void; fallbackConnections?: 'schematic' | 'none'; presentation?: 'generation' | 'summary'; focusRequest?: number };
type MapMarker = { overlay: any; button: HTMLButtonElement; onClick: () => void };
type Point = { x: number; y: number };

function loadKakao(): Promise<any> {
  if (window.kakao?.maps) return Promise.resolve(window.kakao);
  const key = import.meta.env.VITE_KAKAO_JAVASCRIPT_KEY;
  if (!key) return Promise.reject(new Error('지도 키가 설정되지 않았어요. 코스 순서 도식으로 표시해요.'));
  const current = window.__kakaoMapPromise;
  if (current) return current;

  const promise = new Promise<any>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('지도 응답이 지연되어 코스 순서 도식으로 표시해요.')), 15000);
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.onload = () => {
      if (!window.kakao?.maps?.load) { window.clearTimeout(timer); reject(new Error('지도를 초기화하지 못했어요. 코스 순서 도식으로 표시해요.')); return; }
      window.kakao.maps.load(() => { window.clearTimeout(timer); resolve(window.kakao); });
    };
    script.onerror = () => { window.clearTimeout(timer); reject(new Error('지도를 불러오지 못해 코스 순서 도식으로 표시해요.')); };
    document.head.appendChild(script);
  });
  window.__kakaoMapPromise = promise;
  void promise.catch(() => { window.__kakaoMapPromise = undefined; });
  return promise;
}

function routePath(points: Point[]): string {
  if (points.length < 2) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middleX = (previous.x + current.x) / 2;
    const controlY = (previous.y + current.y) / 2;
    path += ` Q ${middleX} ${controlY} ${current.x} ${current.y}`;
  }
  return path;
}

function formatTime(value: string | null) {
  if (!value) return '시간 미정';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '시간 미정' : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
}

export default function ResultMap({ nodes, edges, selectedId, onSelect, fallbackConnections = 'schematic', presentation = 'generation', focusRequest = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markers = useRef<MapMarker[]>([]);
  const polylines = useRef<any[]>([]);
  const selectedIdRef = useRef(selectedId);
  const priorSelectedIdRef = useRef(selectedId);
  const priorFocusRequestRef = useRef(focusRequest);
  const onSelectRef = useRef(onSelect);
  useLayoutEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useLayoutEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);
  const [mapState, setMapState] = useState({ signature: '', error: '' });
  const [mapRevision, setMapRevision] = useState(0);

  const courseNodes = useMemo(() => nodes.filter((node) => node.kind === 'PLACE'), [nodes]);
  const courseIds = useMemo(() => new Set(courseNodes.map((node) => node.id)), [courseNodes]);
  const courseEdges = useMemo(() => edges.filter((edge) => courseIds.has(edge.fromNodeId) && courseIds.has(edge.toNodeId)), [courseIds, edges]);
  const selected = courseNodes.find((node) => node.id === selectedId) ?? null;
  const locationsAvailable = courseNodes.some((node) => isValidWgs84(node.coordinate));
  const mapSignature = JSON.stringify(nodes.filter((node) => node.kind === 'PLACE').map(({ id, title, coordinate }) => ({ id, title, coordinate })));
  const mapNodes = useMemo(() => JSON.parse(mapSignature) as MapNode[], [mapSignature]);
  const mapAvailable = locationsAvailable && mapState.signature === mapSignature && !mapState.error;
  const summaryMessage = courseNodes.length === 0 ? '이 날짜에는 표시할 여행 코스가 없어요.' : !locationsAvailable ? '장소 위치 정보가 없어 지도를 표시할 수 없어요.' : mapAvailable ? '' : mapState.signature === mapSignature && mapState.error ? '지도를 불러오지 못했어요. 장소 목록과 상세는 계속 볼 수 있어요.' : '지도를 불러오고 있어요.';

  useEffect(() => {
    let active = true;
    const mapHost = host.current;
    mapRef.current = null;
    if (!locationsAvailable) return () => { active = false; };

    void loadKakao().then((sdk) => {
      if (!active || !host.current) return;
      const centerNode = mapNodes.find((node) => isValidWgs84(node.coordinate));
      if (!centerNode || !isValidWgs84(centerNode.coordinate)) throw new Error('장소 위치 정보를 확인할 수 없어 코스 순서 도식으로 표시해요.');
      const map = new sdk.maps.Map(host.current, { center: new sdk.maps.LatLng(centerNode.coordinate.latitude, centerNode.coordinate.longitude), level: 8 });
      mapRef.current = map;
      const bounds = new sdk.maps.LatLngBounds();

      for (const node of mapNodes) {
        if (!isValidWgs84(node.coordinate)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        const initiallySelected = node.id === selectedIdRef.current;
        button.className = `itinerary-map-marker${initiallySelected ? ' is-selected' : ''}${presentation === 'summary' ? ' itinerary-map-marker--summary' : ''}`;
        const markerNumber = String(mapNodes.indexOf(node) + 1);
        if (presentation === 'summary') {
          const pin = document.createElement('span');
          pin.className = 'itinerary-map-marker-pin';
          const shape = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          shape.classList.add('itinerary-map-marker-shape');
          shape.setAttribute('viewBox', '0 0 44 44');
          shape.setAttribute('aria-hidden', 'true');
          shape.setAttribute('focusable', 'false');
          const outline = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          outline.setAttribute('d', 'M22 43C18 37 7 28 7 18a15 15 0 1 1 30 0c0 10-11 19-15 25Z');
          shape.appendChild(outline);
          const number = document.createElement('span');
          number.className = 'itinerary-map-marker-number';
          number.textContent = markerNumber;
          pin.append(shape, number);
          button.appendChild(pin);
        } else {
          button.textContent = markerNumber;
        }
        button.setAttribute('aria-label', `${mapNodes.indexOf(node) + 1}번 코스, ${node.title}`);
        button.dataset.courseId = node.id;
        button.setAttribute('aria-pressed', String(initiallySelected));
        const overlay = new sdk.maps.CustomOverlay({ position: new sdk.maps.LatLng(node.coordinate.latitude, node.coordinate.longitude), content: button, yAnchor: presentation === 'summary' ? 1 : 0.5, xAnchor: 0.5, zIndex: initiallySelected ? 100 : 1 });
        bounds.extend(new sdk.maps.LatLng(node.coordinate.latitude, node.coordinate.longitude));
        overlay.setMap(map);
        const onClick = () => onSelectRef.current(node.id);
        button.addEventListener('click', onClick);
        markers.current.push({ overlay, button, onClick });
      }

      if (mapNodes.filter(node => isValidWgs84(node.coordinate)).length > 1) map.setBounds(bounds);
      setMapRevision(value => value + 1);
      setMapState({ signature: mapSignature, error: '' });
    }).catch((error: unknown) => {
      if (active) setMapState({ signature: mapSignature, error: error instanceof Error ? error.message : '지도를 불러오지 못했어요. 코스 순서 도식으로 표시해요.' });
    });

    return () => {
      active = false;
      const sdk = window.kakao;
      for (const marker of markers.current) { marker.button.removeEventListener('click', marker.onClick); marker.overlay.setMap(null); }
      markers.current = [];
      for (const line of polylines.current) line.setMap(null);
      polylines.current = [];
      sdk?.maps?.event?.clearListeners?.(mapRef.current);
      mapRef.current = null;
      mapHost?.replaceChildren();
    };
  }, [locationsAvailable, mapNodes, mapSignature, presentation]);

  useEffect(() => {
    for (const line of polylines.current) line.setMap(null);
    polylines.current = [];
    const sdk = window.kakao;
    const map = mapRef.current;
    if (!sdk?.maps || !map || !mapAvailable) return;
    for (const edge of courseEdges) {
      const geometry = verifiedEdgeGeometry(edge);
      if (!geometry) continue;
      polylines.current.push(new sdk.maps.Polyline({ map, path: geometry.map((point) => new sdk.maps.LatLng(point.latitude, point.longitude)), strokeWeight: 4, strokeColor: '#93b329', strokeOpacity: 0.82, strokeStyle: 'solid' }));
    }
  }, [courseEdges, mapAvailable, mapRevision]);

  useEffect(() => {
    const map = mapRef.current;
    const element = host.current;
    if (!map || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const center = map.getCenter?.();
      const level = map.getLevel?.();
      map.relayout?.();
      if (center) map.setCenter?.(center);
      if (typeof level === 'number') map.setLevel?.(level, { animate: false });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mapRevision, mapSignature, presentation]);

  useEffect(() => {
    const changed = priorSelectedIdRef.current !== selectedId || priorFocusRequestRef.current !== focusRequest;
    priorSelectedIdRef.current = selectedId;
    priorFocusRequestRef.current = focusRequest;
    for (const item of markers.current) {
      const isSelected = item.button.dataset.courseId === selectedId;
      item.button.setAttribute('aria-pressed', String(isSelected));
      item.button.classList.toggle('is-selected', isSelected);
      item.overlay.setZIndex(isSelected ? 100 : 1);
      if (changed && isSelected && mapRef.current) mapRef.current.panTo(item.overlay.getPosition());
    }
  }, [courseNodes, focusRequest, mapAvailable, selected, selectedId]);

  const validCoordinates = courseNodes.filter((node) => isValidWgs84(node.coordinate));
  const fitAllLocations = () => {
    const sdk = window.kakao;
    const map = mapRef.current;
    if (!sdk?.maps || !map) return;
    const points = [...validCoordinates.map(node => node.coordinate), ...courseEdges.flatMap(edge => verifiedEdgeGeometry(edge) ?? [])].filter((point): point is NonNullable<typeof point> => Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180));
    if (!points.length) return;
    if (points.length === 1) { map.setCenter(new sdk.maps.LatLng(points[0].latitude, points[0].longitude)); return; }
    const bounds = new sdk.maps.LatLngBounds();
    for (const point of points) bounds.extend(new sdk.maps.LatLng(point.latitude, point.longitude));
    map.setBounds(bounds);
  };
  const centerSelected = () => {
    const node = courseNodes.find(item => item.id === selectedId);
    if (node && isValidWgs84(node.coordinate) && window.kakao?.maps) mapRef.current?.panTo?.(new window.kakao.maps.LatLng(node.coordinate.latitude, node.coordinate.longitude));
  };

  const schematicPoints = useMemo(() => courseNodes.map((_, index) => ({
    x: courseNodes.length === 1 ? 50 : 13 + (74 * index) / (courseNodes.length - 1),
    y: 50 + Math.sin(index * 1.7) * Math.min(21, 21 * Math.sqrt(courseNodes.length / 4)),
  })), [courseNodes]);
  const missingCoordinateCount = courseNodes.filter(node => !isValidWgs84(node.coordinate)).length;
  const mapAnnouncement = presentation === 'summary' ? summaryMessage || '지도가 표시됐어요. 지도 표시를 선택하면 일정 목록과 상세가 함께 바뀌어요.' : courseNodes.length === 0 ? '이 날짜에는 표시할 여행 코스가 없어요.' : !locationsAvailable ? '장소 위치 정보를 확인할 수 없어 코스 순서 도식을 표시해요.' : mapAvailable ? '지도 표시를 선택하면 선택한 코스와 상세가 함께 바뀌어요.' : mapState.signature === mapSignature ? mapState.error : '지도를 불러오고 있어요. 코스 순서 도식을 먼저 표시해요.';

  return (
    <div className="itinerary-map-wrap">
      <div className={`itinerary-map ${mapAvailable ? 'is-live-map' : presentation === 'summary' ? 'is-map-unavailable' : 'is-course-schematic'}`}>
        {presentation !== 'summary' && <div className="itinerary-map-grid" aria-hidden="true" />}
        <div ref={host} className={`itinerary-map-canvas ${mapAvailable ? '' : 'is-hidden'}`} role="region" aria-label="선택한 날짜의 여행 장소 지도" />
        {presentation === 'summary' && summaryMessage && <p className="itinerary-map-summary-message">{summaryMessage}</p>}
        {presentation !== 'summary' && !mapAvailable && courseNodes.length > 0 && <div className="itinerary-map-schematic" role="group" aria-label={fallbackConnections === 'none' ? '장소 위치가 표시되지 않은 코스 목록' : '실제 지리가 아닌 코스 순서 도식'}>
          {fallbackConnections === 'schematic' && <svg className="itinerary-map-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d={routePath(schematicPoints)} /></svg>}
          {courseNodes.map((node, index) => <button key={node.id} type="button" className={`itinerary-map-node ${node.id === selectedId ? 'is-selected' : ''}`} style={{ left: `${schematicPoints[index].x}%`, top: `${schematicPoints[index].y}%` }} aria-pressed={node.id === selectedId} aria-label={`${index + 1}번 코스 선택: ${node.title}`} onClick={() => onSelect(node.id)}>{index + 1}</button>)}
        </div>}
        {presentation !== 'summary' && courseNodes.length === 0 && <div className="itinerary-map-empty"><span aria-hidden="true">○</span><p>코스가 추가되면 이곳에 표시돼요.</p></div>}
        {presentation !== 'summary' && <span className="itinerary-map-note">{mapAvailable ? `장소 위치 정보${missingCoordinateCount ? ` · 위치 미확인 ${missingCoordinateCount}곳` : ''} · 확인된 경로만 선으로 표시해요` : fallbackConnections === 'none' ? `지도 경로를 표시할 수 없어요${missingCoordinateCount ? ` · 위치 미확인 ${missingCoordinateCount}곳` : ''}` : '코스 순서 도식 · 실제 이동 경로가 아니에요'}</span>}
        {presentation !== 'summary' && selected && <div className="itinerary-map-selected"><span>{courseNodes.findIndex((node) => node.id === selected.id) + 1}</span><div><strong>{selected.title}</strong><small>{formatTime(selected.estimatedStartAt)} · 일정에서 선택됨</small></div></div>}
      </div>
      <p className="visually-hidden" role="status">{mapAnnouncement}</p>
      {presentation === 'summary' && <div className="itinerary-map-summary-controls" aria-label="지도 보기 조작"><button type="button" disabled={!mapAvailable || !selected || !isValidWgs84(selected.coordinate)} onClick={centerSelected}>선택 장소 위치</button><button type="button" disabled={!mapAvailable || validCoordinates.length === 0} onClick={fitAllLocations}>전체 경로 보기</button></div>}
      {presentation !== 'summary' && courseNodes.length > 0 && <nav className="itinerary-map-index" aria-label="지도에서 여행 코스 선택">{courseNodes.map((node, index) => <button key={node.id} type="button" className={node.id === selectedId ? 'is-selected' : ''} aria-pressed={node.id === selectedId} onClick={() => onSelect(node.id)}><span>{index + 1}</span>{node.title}</button>)}</nav>}
    </div>
  );
}
