// Ported verbatim from mvp2 lib/tool-argument-guard.ts.
export type ToolArgumentFailureStage =
  | "tool_arguments_json_parse"
  | "tool_arguments_schema"
  | "tool_argument_guard"
  | "stop_count_policy"
  | "required_tool_missing";

export type RouteMetricsToolArgumentAudit = {
  valid: boolean;
  errorStage: ToolArgumentFailureStage | null;
  minStops: number;
  maxStops: number;
  receivedStopCount: number;
  stopCountValid: boolean;
  rawArguments: string | null;
  parsedArguments: unknown;
  receivedPlaceIds: unknown[];
  duplicateIds: string[];
  invalidIds: string[];
  outOfCandidateIds: string[];
  wrongIdFormatIds: string[];
  otherReasons: string[];
  placeIds: string[] | null;
};

export type RouteMetricsToolArgumentGuardInput = {
  rawArguments: string;
  minStops: number;
  maxStops: number;
  candidateIds: string[];
  currentDataVersionIds: string[];
  /**
   * IDs recognized for this one request beyond the static current-data-
   * version set — specifically, realtime Geoapify fallback candidates
   * (lib/nyc-realtime-poi.ts) that were included in this request"s
   * candidate_pois list. Without this, a legitimately-offered realtime
   * candidate ID would be flagged invalidIds simply for not existing in the
   * static nyc-poi-v1 catalog. Defaults to none, so every existing
   * caller is unaffected.
   */
  additionalRecognizedIds?: string[];
};

const canonicalPlaceId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

/**
 * The model proposes route IDs; this guard is the sole authority for whether
 * they can reach route calculation. It deliberately never deduplicates or
 * substitutes values: invalid input remains model-path failure evidence.
 */
export function inspectRouteMetricsToolArguments({
  rawArguments,
  minStops,
  maxStops,
  candidateIds,
  currentDataVersionIds,
  additionalRecognizedIds = [],
}: RouteMetricsToolArgumentGuardInput): RouteMetricsToolArgumentAudit {
  let parsedArguments: unknown;
  try {
    parsedArguments = JSON.parse(rawArguments);
  } catch {
    return {
      valid: false,
      errorStage: "tool_arguments_json_parse",
      minStops,
      maxStops,
      receivedStopCount: 0,
      stopCountValid: false,
      rawArguments,
      parsedArguments: null,
      receivedPlaceIds: [],
      duplicateIds: [],
      invalidIds: [],
      outOfCandidateIds: [],
      wrongIdFormatIds: [],
      otherReasons: ["tool arguments are not valid JSON"],
      placeIds: null,
    };
  }

  if (
    !parsedArguments ||
    typeof parsedArguments !== "object" ||
    !Array.isArray((parsedArguments as { placeIds?: unknown }).placeIds)
  ) {
    return {
      valid: false,
      errorStage: "tool_arguments_schema",
      minStops,
      maxStops,
      receivedStopCount: 0,
      stopCountValid: false,
      rawArguments,
      parsedArguments,
      receivedPlaceIds: [],
      duplicateIds: [],
      invalidIds: [],
      outOfCandidateIds: [],
      wrongIdFormatIds: [],
      otherReasons: ["placeIds must be an array"],
      placeIds: null,
    };
  }

  const receivedPlaceIds = (parsedArguments as { placeIds: unknown[] }).placeIds;
  const stringIds = receivedPlaceIds.filter(
    (value): value is string => typeof value === "string",
  );
  const duplicateIds = uniqueStrings(
    stringIds.filter((value, index) => stringIds.indexOf(value) !== index),
  );
  const wrongIdFormatIds = uniqueStrings(
    stringIds.filter((value) => !canonicalPlaceId.test(value)),
  );
  const currentDataVersion = new Set(currentDataVersionIds);
  const recognized = new Set(additionalRecognizedIds);
  const candidateSet = new Set(candidateIds);
  const invalidIds = uniqueStrings(
    stringIds.filter(
      (value) =>
        canonicalPlaceId.test(value) &&
        !currentDataVersion.has(value) &&
        !recognized.has(value),
    ),
  );
  const outOfCandidateIds = uniqueStrings(
    stringIds.filter(
      (value) =>
        canonicalPlaceId.test(value) &&
        (currentDataVersion.has(value) || recognized.has(value)) &&
        !candidateSet.has(value),
    ),
  );
  const otherReasons = [
    ...(receivedPlaceIds.some((value) => typeof value !== "string")
      ? ["placeIds contains a non-string value"]
      : []),
    ...(receivedPlaceIds.length < minStops || receivedPlaceIds.length > maxStops
      ? [`placeIds contains ${receivedPlaceIds.length} IDs; allowed range is ${minStops}–${maxStops}`]
      : []),
  ];
  const stopCountValid =
    receivedPlaceIds.length >= minStops && receivedPlaceIds.length <= maxStops;
  const valid =
    otherReasons.length === 0 &&
    duplicateIds.length === 0 &&
    invalidIds.length === 0 &&
    outOfCandidateIds.length === 0 &&
    wrongIdFormatIds.length === 0;

  return {
    valid,
    errorStage: valid
      ? null
      : !stopCountValid
        ? "stop_count_policy"
        : "tool_argument_guard",
    minStops,
    maxStops,
    receivedStopCount: receivedPlaceIds.length,
    stopCountValid,
    rawArguments,
    parsedArguments,
    receivedPlaceIds,
    duplicateIds,
    invalidIds,
    outOfCandidateIds,
    wrongIdFormatIds,
    otherReasons,
    placeIds: valid ? (stringIds as string[]) : null,
  };
}
