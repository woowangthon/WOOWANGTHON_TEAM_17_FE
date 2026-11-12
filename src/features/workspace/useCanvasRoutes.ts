import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasHttpError, getCanvasRoute } from './canvasApi.ts';
import { canvasRouteKey, collectCanvasRouteRequests, formatCanvasRouteLabel, type CanvasRoute, type CanvasRouteInput, type CanvasRouteRequest, type CanvasTravelMode } from './canvasRoutes.ts';
import { CanvasRouteController as RouteController } from './canvasRoutes.ts';
import type { CanvasDocument } from './canvasModel.ts';

type RouteState = { scope: string; phase: 'loading' | 'ready' | 'error' | 'stale'; route: CanvasRoute | null };
type RoutePlan = { scope: string; requests: CanvasRouteRequest[] };

export type CanvasRoutePreviewState = { phase: 'idle' | 'loading' | 'ready' | 'error' | 'stale'; route: CanvasRoute | null; errorCode?: string };

/** A single uncached preview request. Selection changes abort the prior leg and stale completions are ignored. */
export function useCanvasRoutePreview(input: CanvasRouteInput | null, enabled = true): CanvasRoutePreviewState {
  const inputJson = enabled && input ? JSON.stringify(input) : '';
  const request = useMemo(() => inputJson ? JSON.parse(inputJson) as CanvasRouteInput : null, [inputJson]);
  const [result, setResult] = useState<{ request: CanvasRouteInput; state: CanvasRoutePreviewState } | null>(null);

  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    void getCanvasRoute(request, controller.signal).then(route => {
      if (!controller.signal.aborted) setResult({ request, state: { phase: 'ready', route } });
    }).catch(error => {
      if (controller.signal.aborted) return;
      const code = error instanceof CanvasHttpError ? error.code : 'NETWORK_ERROR';
      setResult({ request, state: {
        phase: code === 'STALE_ROUTE_INPUT' ? 'stale' : 'error', route: null, errorCode: code,
      } });
    });
    return () => controller.abort();
  }, [request]);

  if (!request) return { phase: 'idle', route: null };
  return result?.request === request ? result.state : { phase: 'loading', route: null };
}

export function useCanvasRoutes(
  tripId: string, conditionsVersion: number | null, mode: CanvasTravelMode,
  document: CanvasDocument | null, activeDayId: string | null, preview: boolean,
  effectiveModeForEdge?: (edgeId: string) => CanvasTravelMode,
  includeGeometry = false,
) {
  const planJson = JSON.stringify({
    scope: JSON.stringify([tripId, conditionsVersion, mode, preview, includeGeometry]),
    requests: preview ? [] : collectCanvasRouteRequests(tripId, conditionsVersion, mode, document, activeDayId, effectiveModeForEdge),
  });
  const plan = useMemo(() => JSON.parse(planJson) as RoutePlan, [planJson]);
  const controller = useMemo(() => new RouteController<{ route: CanvasRoute | null; errorCode?: string }>(2), []);
  const [states, setStates] = useState<Map<string, RouteState>>(new Map());
  const currentPlanRef = useRef(plan);
  const scopeGeneration = useRef(0);

  useEffect(() => { currentPlanRef.current = plan; }, [plan]);

  useEffect(() => {
    controller.setScope(plan.scope);
    const generation = ++scopeGeneration.current;
    return () => {
      if (scopeGeneration.current === generation) scopeGeneration.current += 1;
      controller.setScope(`${plan.scope}:closed`);
    };
  }, [controller, plan.scope]);

  useEffect(() => {
    let active = true;
    controller.retainKeys(new Set(plan.requests.map(canvasRouteKey)));
    if (preview || !plan.requests.length) return () => { active = false; };
    for (const request of plan.requests) {
      const key = canvasRouteKey(request);
      void controller.load(key, async signal => {
        try { return { route: await getCanvasRoute(request, signal, { routeGeometry: includeGeometry }) }; }
        catch (error) {
          if (signal.aborted) return { route: null, errorCode: 'ABORTED' };
          return { route: null, errorCode: error instanceof CanvasHttpError ? error.code : 'NETWORK_ERROR' };
        }
      }).then(outcome => {
        const current = currentPlanRef.current;
        if (!active || current.scope !== plan.scope || !current.requests.some(item => canvasRouteKey(item) === key)) return;
        setStates(previous => {
          const next = new Map(previous);
          if (outcome?.route) next.set(key, { scope: plan.scope, phase: 'ready', route: outcome.route });
          else if (outcome?.errorCode === 'ABORTED') next.delete(key);
          else next.set(key, { scope: plan.scope, phase: outcome?.errorCode === 'STALE_ROUTE_INPUT' ? 'stale' : 'error', route: null });
          return next;
        });
      });
    }
    return () => { active = false; };
  }, [controller, plan, preview, includeGeometry]);

  const retry = useCallback(() => {
    const generation = scopeGeneration.current;
    const scope = currentPlanRef.current.scope;
    for (const request of currentPlanRef.current.requests) {
      const key = canvasRouteKey(request);
      controller.retry(key);
      setStates(previous => new Map(previous).set(key, { scope, phase: 'loading', route: null }));
      void controller.load(key, async signal => {
        try { return { route: await getCanvasRoute(request, signal, { routeGeometry: includeGeometry }) }; }
        catch (error) {
          if (signal.aborted) return { route: null, errorCode: 'ABORTED' };
          return { route: null, errorCode: error instanceof CanvasHttpError ? error.code : 'NETWORK_ERROR' };
        }
      }).then(outcome => {
        const current = currentPlanRef.current;
        if (scopeGeneration.current !== generation || current.scope !== scope) return;
        if (!current.requests.some(item => canvasRouteKey(item) === key)) return;
        setStates(previous => {
          const next = new Map(previous);
          if (outcome?.route) next.set(key, { scope, phase: 'ready', route: outcome.route });
          else if (outcome?.errorCode === 'ABORTED') next.delete(key);
          else next.set(key, { scope, phase: outcome?.errorCode === 'STALE_ROUTE_INPUT' ? 'stale' : 'error', route: null });
          return next;
        });
      });
    }
  }, [controller, includeGeometry]);

  const labels = useMemo(() => {
    const byEdge = new Map<string, string>();
    for (const request of plan.requests) {
      const state = states.get(canvasRouteKey(request));
      const currentState = state?.scope === plan.scope ? state : undefined;
      const label = formatCanvasRouteLabel(currentState?.route, !currentState || currentState.phase === 'loading');
      for (const edgeId of request.edgeIds) byEdge.set(edgeId, label);
    }
    return byEdge;
  }, [plan, states]);
  const hasIssue = plan.requests.some(request => {
    const candidate = states.get(canvasRouteKey(request));
    const state = candidate?.scope === plan.scope ? candidate : undefined;
    return state?.phase === 'error' || state?.phase === 'stale' || state?.route?.status === 'unknown';
  });
  const routesByEdge = useMemo(() => {
    const byEdge = new Map<string, CanvasRoute>();
    for (const request of plan.requests) {
      const state = states.get(canvasRouteKey(request));
      const currentState = state?.scope === plan.scope ? state : undefined;
      if (currentState?.phase === 'ready' && currentState.route) for (const edgeId of request.edgeIds) byEdge.set(edgeId, currentState.route);
    }
    return byEdge;
  }, [plan, states]);
  return { labels, routesByEdge, hasIssue, retry, routeCount: plan.requests.length };
}
