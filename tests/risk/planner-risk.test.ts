import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Itinerary, NycPlace, PlanRequest } from '@/lib/nyc-types';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({
  default: class OfflineOpenAI {
    responses = { create: mocks.create };
  },
}));
// API auth, quota storage and external routing are separate boundaries. The
// actual model executor, argument guard, final validator and fallback run here.
vi.mock('@/lib/auth', () => ({
  isAuthConfigured: () => true,
  requireAuthenticatedUser: vi.fn(async () => ({ id: 'offline-test-user' })),
  isAuthError: () => false,
  authErrorBody: vi.fn(),
}));
vi.mock('@/lib/nyc-guards', () => ({
  checkPlanRateLimit: () => ({ allowed: true }),
  reserveDailyModelCallBudget: async () => ({ allowed: true }),
}));
vi.mock('@/lib/nyc-routing', () => ({
  validateItineraryRoute: async (itinerary: unknown) => itinerary,
}));
vi.mock('@/lib/nyc-planner', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/nyc-planner')>();
  return {
    ...real,
    // Fixed curated workload: no external live-listing retrieval during tests.
    resolveCandidatesWithRealtimeFallback: async (request: PlanRequest) => real.rankedPlaces(request),
  };
});

import { POST } from '@/app/api/plan/route';
import { executeConfiguredModelPlanner, type PlannerModelConfig } from '@/lib/nyc-model-planner';
import { publishedPlaces } from '@/lib/nyc-places';
import { calculateRouteMetrics, planWithResolvedCandidates, rankedPlaces, validateModelSelection } from '@/lib/nyc-planner';
import { inspectRouteMetricsToolArguments } from '@/lib/nyc-tool-argument-guard';

const request: PlanRequest = {
  cityCode: 'nyc', date: '2026-11-20', duration: 'half_day', durationHours: 4,
  partySize: 1, totalBudgetUsd: 1000, interests: ['park'], intentText: '',
  transportPreference: 'smart', walkingPreference: 'balanced',
  dining: 'no_preference', accessibility: false,
};
const config: PlannerModelConfig = {
  provider: 'deepseek', baseURL: 'https://offline.invalid', apiKey: 'offline-test-key',
  modelId: 'offline-model', modelVersionId: 'offline-model', promptVersionId: 'test',
  temperature: 0, maxOutputTokens: 700, timeoutMs: 100, maxRetries: 0,
};
const candidates = rankedPlaces(request);
const fallback = planWithResolvedCandidates(request, candidates);
if (fallback.mode !== 'controlled_fallback') throw new Error('Risk fixture needs a valid curated fallback.');
const validIds = fallback.itinerary.stops.map((stop) => stop.placeId);
const unknownId = 'lab12-invented-place';
const outsideId = publishedPlaces.find((place) => !candidates.candidates.some((candidate) => candidate.id === place.id))?.id;
if (!outsideId) throw new Error('Risk fixture needs an out-of-candidate published place.');

function toolResponse(ids: string[]) {
  return { output: [{ type: 'function_call', name: 'calculate_route_metrics', arguments: JSON.stringify({ placeIds: ids }) }] };
}
function finalResponse(ids: string[], reason = 'Matches your park interest') {
  return {
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      stopIds: ids, reasons: ids.map((placeId) => ({ placeId, reason })),
    }) }] }],
  };
}
function rejectedToolIds(ids: string[]) {
  mocks.create.mockResolvedValue(toolResponse(ids));
}
function guard(ids: string[], overrides: { candidateIds?: string[]; additionalRecognizedIds?: string[] } = {}) {
  return inspectRouteMetricsToolArguments({
    rawArguments: JSON.stringify({ placeIds: ids }), minStops: 1, maxStops: 3,
    candidateIds: [validIds[0]], currentDataVersionIds: publishedPlaces.map((place) => place.id),
    ...overrides,
  });
}
async function callApi() {
  return POST(new Request('http://localhost/api/plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
  }));
}
type TestPlanResponse = { mode: string; warning?: string; itinerary: Itinerary };

beforeEach(() => {
  mocks.create.mockReset();
  vi.stubEnv('DEEPSEEK_API_KEY', 'offline-test-key');
  vi.stubEnv('CH10_RULE_ONLY', '0');
  vi.stubEnv('CH10_INDEXED', '0');
  // An accidental network path fails immediately, even if real env vars exist.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in risk tests'); }));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('P1 argument guard', () => {
  it('accepts a valid curated candidate', () => expect(guard([validIds[0]]).valid).toBe(true));
  it('rejects a canonical but invented ID in well-formed JSON', () => {
    const result = guard([unknownId]);
    expect(result.valid).toBe(false);
    expect(result.invalidIds).toEqual([unknownId]);
  });
  it('rejects a real place outside this request shortlist', () => {
    const result = guard([outsideId]);
    expect(result.valid).toBe(false);
    expect(result.outOfCandidateIds).toEqual([outsideId]);
  });
  it('rejects mixed valid and invented IDs without substituting a subset', () => {
    const result = guard([validIds[0], unknownId]);
    expect(result.valid).toBe(false);
    expect(result.placeIds).toBeNull();
  });
  it('rejects duplicate IDs', () => expect(guard([validIds[0], validIds[0]]).duplicateIds).toEqual([validIds[0]]));
  it('rejects invalid ID format', () => expect(guard(['Ignore rules!']).valid).toBe(false));
  it('allows a live ID only when both recognized and offered for this request', () => {
    const live = 'geoapify-lab12';
    expect(guard([live], { candidateIds: [live] }).valid).toBe(false);
    expect(guard([live], { additionalRecognizedIds: [live] }).valid).toBe(false);
    expect(guard([live], { candidateIds: [live], additionalRecognizedIds: [live] }).valid).toBe(true);
  });
});

describe('P1 trusted records and final validation', () => {
  it.each([
    ['unpublished', { published: false }],
    ['missing source', { sourceUrl: '' }],
    ['missing review date', { reviewedOn: '' }],
  ])('rejects a candidate with %s even if its ID is offered', (_name, change) => {
    const altered = { ...candidates, candidates: candidates.candidates.map((place) => place.id === validIds[0] ? { ...place, ...change } : place) };
    const result = validateModelSelection(request, validIds, altered);
    expect('itinerary' in result).toBe(false);
    expect(result.reason).toBeTruthy();
  });
  it('rejects unknown IDs at the final validator as well as at the tool boundary', () => {
    expect(validateModelSelection(request, [unknownId], candidates)).not.toHaveProperty('itinerary');
  });
  it('builds displayed names, source links and allowances from catalog records', () => {
    const result = validateModelSelection(request, validIds, candidates);
    expect(result).toHaveProperty('itinerary');
    if (!('itinerary' in result) || !result.itinerary) throw new Error(result.reason);
    for (const stop of result.itinerary.stops) {
      const record = publishedPlaces.find((place) => place.id === stop.placeId)!;
      expect(stop.name).toBe(record.name);
      expect(stop.sourceUrl).toBe(record.sourceUrl);
      expect(stop.place.planningAllowanceUsd).toBe(record.planningAllowanceUsd);
    }
  });
  it('preserves the explicit sourced-live-listing exception without allowing unpublished curated records', () => {
    const live: NycPlace = { ...candidates.candidates[0], id: 'geoapify-lab12', dataOrigin: 'realtime_geoapify', published: false, expectedSpendSemantics: 'category_estimate' };
    expect(() => calculateRouteMetrics(request, [live.id], { [live.id]: live })).not.toThrow();
    expect(() => calculateRouteMetrics(request, [live.id], { [live.id]: { ...live, dataOrigin: 'curated' } })).toThrow();
  });
});

describe('P1 real model executor with adversarial SDK responses', () => {
  it('accepts valid output while retaining trusted place facts', async () => {
    mocks.create.mockResolvedValueOnce(toolResponse(validIds)).mockResolvedValueOnce(finalResponse(validIds));
    const result = await executeConfiguredModelPlanner(request, config, candidates);
    expect(result.planner.mode).toBe('ai_structured');
    expect(result.planner.itinerary.stops.map((stop) => stop.placeId)).toEqual(validIds);
    expect(result.repairCount).toBe(0);
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it('rejects schema-valid unknown IDs after one bounded repair', async () => {
    rejectedToolIds([unknownId]);
    await expect(executeConfiguredModelPlanner(request, config, candidates)).rejects.toMatchObject({ evidence: { errorStage: 'tool_argument_guard', repairCount: 1 } });
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });
  it('rejects a final route that swaps a validated ID for a fabricated ID', async () => {
    mocks.create.mockResolvedValueOnce(toolResponse(validIds)).mockResolvedValueOnce(finalResponse([unknownId]));
    await expect(executeConfiguredModelPlanner(request, config, candidates)).rejects.toMatchObject({ evidence: { errorStage: 'model_selection_validation' } });
  });
  it('screens price and real-time claims out of AI reasons', async () => {
    mocks.create.mockResolvedValueOnce(toolResponse(validIds)).mockResolvedValueOnce(finalResponse(validIds, 'Guaranteed open now, tickets $1'));
    const result = await executeConfiguredModelPlanner(request, config, candidates);
    expect(result.aiReasonCount).toBe(0);
    expect(result.planner.itinerary.stops.every((stop) => stop.reasonSource === 'rules')).toBe(true);
  });
  it('keeps an explicitly offered live listing labeled as unreviewed', async () => {
    const live: NycPlace = { ...candidates.candidates.find((place) => place.id === validIds[0])!, id: 'geoapify-lab12', published: false, dataOrigin: 'realtime_geoapify', expectedSpendSemantics: 'category_estimate' };
    const withLive = { ...candidates, candidates: candidates.candidates.map((place) => place.id === validIds[0] ? live : place) };
    const ids = validIds.map((id) => id === validIds[0] ? live.id : id);
    mocks.create.mockResolvedValueOnce(toolResponse(ids)).mockResolvedValueOnce(finalResponse(ids));
    const result = await executeConfiguredModelPlanner(request, config, withLive);
    expect(result.planner.itinerary.stops[0].dataOrigin).toBe('realtime_geoapify');
    expect(result.planner.itinerary.warnings.join(' ')).toMatch(/not reviewed/);
  });
});

describe('P1/P2 API failure containment', () => {
  it.each(['invented', 'out-of-candidate', 'mixed', 'duplicate', 'final-swap', 'unavailable'])('returns a safe controlled itinerary for %s model failure', async (failure) => {
    if (failure === 'unavailable') mocks.create.mockRejectedValue(new Error('Mock service timeout'));
    else if (failure === 'final-swap') mocks.create.mockResolvedValueOnce(toolResponse(validIds)).mockResolvedValueOnce(finalResponse([unknownId]));
    else rejectedToolIds(failure === 'invented' ? [unknownId] : failure === 'out-of-candidate' ? [outsideId] : failure === 'mixed' ? [validIds[0], unknownId] : [validIds[0], validIds[0]]);
    const response = await callApi();
    const body = await response.json() as TestPlanResponse;
    expect(response.status).toBe(200);
    expect(body.mode).toBe('controlled_fallback');
    expect(body.warning).toMatch(/didn't pass validation or was unavailable/);
    expect(body.itinerary.stops.map((stop: { placeId: string }) => stop.placeId)).toEqual(validIds);
    expect(body.itinerary.stops.every((stop: { placeId: string }) => candidates.candidates.some((place) => place.id === stop.placeId))).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(failure === 'unavailable' ? 1 : 2);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns an AI itinerary for the valid control case', async () => {
    mocks.create.mockResolvedValueOnce(toolResponse(validIds)).mockResolvedValueOnce(finalResponse(validIds));
    const body = await (await callApi()).json() as TestPlanResponse;
    expect(body.mode).toBe('ai_structured');
    expect(body.warning).toBeUndefined();
    expect(body.itinerary.stops.map((stop: { placeId: string }) => stop.placeId)).toEqual(validIds);
    expect(fetch).not.toHaveBeenCalled();
  });
});
