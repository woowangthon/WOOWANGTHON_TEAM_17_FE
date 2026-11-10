import type { Plan } from './generationApi';

export type PlanDay = Plan['document']['days'][number];
export type CourseNode = PlanDay['nodes'][number];
export type CourseEdge = PlanDay['edges'][number];

export function courseNodesForDay(day: PlanDay | null | undefined): CourseNode[] {
  return day?.nodes.filter((node) => node.kind === 'PLACE') ?? [];
}

export function courseEdgesForPlaces(day: PlanDay | null | undefined, nodes: CourseNode[]): CourseEdge[] {
  if (!day || nodes.length < 2) return [];
  const placeIds = new Set(nodes.map((node) => node.id));
  return day.edges.filter((edge) => placeIds.has(edge.fromNodeId) && placeIds.has(edge.toNodeId));
}

export function selectCourseDay(days: PlanDay[], activeDate: string | null): PlanDay | null {
  if (days.length === 0) return null;
  return days.find((day) => day.date === activeDate) ?? days[0];
}

export function resolveSelectedCourse(nodes: CourseNode[], selectedId: string | null): CourseNode | null {
  if (nodes.length === 0) return null;
  return nodes.find((node) => node.id === selectedId) ?? nodes[0];
}

export function totalBudgetSummary(totalCostKrw: number | null, budget: number | null) {
  if (totalCostKrw === null || !Number.isFinite(totalCostKrw)) {
    return { label: '전체 추정 비용 확인 필요', amount: null, remainder: null };
  }
  return {
    label: '전체 추정 비용',
    amount: totalCostKrw,
    remainder: budget === null ? null : budget - totalCostKrw,
  };
}
