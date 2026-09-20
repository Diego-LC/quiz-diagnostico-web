export const DIAGNOSTIC_SESSION_VERSION = 3 as const;
export const DIAGNOSTIC_STORAGE_KEY = "brujula-tic:diagnostic-session";

export type AnswerOption = "A" | "B" | "C" | "D";
export type AnswerConfidence = "guess" | "unsure" | "sure";
export type RouteMode = "panorama" | "recommended" | "deep" | "focused";

export type DiagnosticPhase =
  | "intro"
  | "route-select"
  | "essential"
  | "confirmation"
  | "interest"
  | "select-applied"
  | "applied"
  | "select-deepening"
  | "deepening"
  | "results";

export interface QuestionResponse {
  questionId: string;
  selectedOption: AnswerOption;
  correct: boolean;
  awardedPoints: number;
  maxPoints: number;
  itemVersion: number;
  bankVersion: string;
  itemType: "single-best" | "graded-judgment" | "practical";
  optionOrder: AnswerOption[];
  confidence: AnswerConfidence;
  activeSeconds: number;
  startedAt: string;
  answeredAt: string;
}

export interface RoutePlanEntry {
  questionId: string;
  itemVersion: number;
  phase: Exclude<DiagnosticPhase, "intro" | "route-select" | "interest" | "select-applied" | "select-deepening" | "results">;
  areaId: string;
  reason: string;
  isConfirmation: boolean;
}

export type InterestScore = 1 | 2 | 3 | 4 | 5;

export interface AreaInterest {
  enjoyed: InterestScore;
  learnMore: InterestScore;
  projectInterest: InterestScore;
  updatedAt: string;
}

export interface DiagnosticSessionState {
  version: typeof DIAGNOSTIC_SESSION_VERSION;
  sessionId: string;
  /** Nombre visible del perfil; se guarda únicamente en el dispositivo. */
  profileName: string;
  phase: DiagnosticPhase;
  routeMode: RouteMode | null;
  bankVersion: string;
  routePlan: RoutePlanEntry[];
  routeCursor: number;
  responses: Record<string, QuestionResponse>;
  interests: Record<string, AreaInterest>;
  selectedAreas: {
    applied: string[];
    deepening: string[];
  };
  currentQuestionId: string | null;
  /** IDs de preguntas de comprobación adaptativa de la etapa actual. */
  confirmationIds: string[];
  confirmationLevel: "essential" | "applied" | "deepening" | null;
  confirmationReturnPhase: "essential" | "applied" | "deepening" | null;
  activeSecondsTotal: number;
  paused: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionProgress {
  answered: number;
  total: number;
  remaining: number;
  percentage: number;
  currentIndex: number | null;
  nextUnansweredId: string | null;
}

export interface SessionStorageReader {
  getItem(key: string): string | null;
}

export interface SessionStorageWriter {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type UnknownRecord = Record<string, unknown>;

const PHASES = new Set<DiagnosticPhase>([
  "intro",
  "route-select",
  "essential",
  "confirmation",
  "interest",
  "select-applied",
  "applied",
  "select-deepening",
  "deepening",
  "results",
]);

const CONFIDENCE_ALIASES: Record<string, AnswerConfidence> = {
  guess: "guess",
  random: "guess",
  unsure: "unsure",
  doubtful: "unsure",
  sure: "sure",
  confident: "sure",
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `diagnostic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function asIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function asNonNegativeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function asNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asPhase(value: unknown): DiagnosticPhase {
  return typeof value === "string" && PHASES.has(value as DiagnosticPhase)
    ? (value as DiagnosticPhase)
    : "intro";
}

function asAnswerOption(value: unknown): AnswerOption | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized === "A" || normalized === "B" || normalized === "C" || normalized === "D"
    ? normalized
    : null;
}

function asRouteMode(value: unknown): RouteMode | null {
  return typeof value === "string" && ["panorama", "recommended", "deep", "focused"].includes(value)
    ? (value as RouteMode)
    : null;
}

function asItemType(value: unknown): QuestionResponse["itemType"] {
  return value === "graded-judgment" || value === "practical" ? value : "single-best";
}

function asConfidence(value: unknown): AnswerConfidence | null {
  if (typeof value !== "string") return null;
  return CONFIDENCE_ALIASES[value.trim().toLowerCase()] ?? null;
}

function asInterestScore(value: unknown): InterestScore | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return null;
  return rounded as InterestScore;
}

function asUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      ).map((item) => item.trim()),
    ),
  );
}

function normalizeResponses(
  value: unknown,
  createdAt: string,
  updatedAt: string,
): Record<string, QuestionResponse> {
  if (!isRecord(value)) return {};

  const responses: Record<string, QuestionResponse> = {};
  for (const [recordKey, rawResponse] of Object.entries(value)) {
    if (!isRecord(rawResponse)) continue;

    const questionId = asNonEmptyString(rawResponse.questionId, recordKey);
    const selectedOption = asAnswerOption(rawResponse.selectedOption);
    const confidence = asConfidence(rawResponse.confidence);
    if (!questionId || !selectedOption || !confidence) {
      continue;
    }

    const awardedPoints = asNonNegativeNumber(
      rawResponse.awardedPoints,
      rawResponse.correct === true ? 1 : 0,
    );
    const maxPoints = Math.max(1, asNonNegativeNumber(rawResponse.maxPoints, 1));
    const correct = typeof rawResponse.correct === "boolean"
      ? rawResponse.correct
      : awardedPoints >= maxPoints;
    const rawOrder = Array.isArray(rawResponse.optionOrder)
      ? rawResponse.optionOrder.map(asAnswerOption).filter((value): value is AnswerOption => Boolean(value))
      : [];

    responses[questionId] = {
      questionId,
      selectedOption,
      correct,
      awardedPoints: Math.min(awardedPoints, maxPoints),
      maxPoints,
      itemVersion: Number.isInteger(rawResponse.itemVersion) && Number(rawResponse.itemVersion) > 0
        ? Number(rawResponse.itemVersion)
        : 1,
      bankVersion: asNonEmptyString(rawResponse.bankVersion, "v1-legacy"),
      itemType: asItemType(rawResponse.itemType),
      optionOrder: Array.from(new Set(rawOrder)),
      confidence,
      activeSeconds: asNonNegativeNumber(rawResponse.activeSeconds),
      startedAt: asIsoDate(rawResponse.startedAt, createdAt),
      answeredAt: asIsoDate(rawResponse.answeredAt, updatedAt),
    };
  }

  return responses;
}

function normalizeInterests(
  value: unknown,
  updatedAt: string,
): Record<string, AreaInterest> {
  if (!isRecord(value)) return {};

  const interests: Record<string, AreaInterest> = {};
  for (const [areaId, rawInterest] of Object.entries(value)) {
    if (!areaId.trim() || !isRecord(rawInterest)) continue;

    const enjoyed = asInterestScore(rawInterest.enjoyed);
    const learnMore = asInterestScore(rawInterest.learnMore);
    const projectInterest = asInterestScore(rawInterest.projectInterest);
    if (!enjoyed || !learnMore || !projectInterest) continue;

    interests[areaId.trim()] = {
      enjoyed,
      learnMore,
      projectInterest,
      updatedAt: asIsoDate(rawInterest.updatedAt, updatedAt),
    };
  }

  return interests;
}

/**
 * Creates a new diagnostic session. Passing `now` and `sessionId` makes the
 * result deterministic for tests; defaults are safe in both browser and SSR.
 */
export function createInitialSession(options: {
  now?: string;
  sessionId?: string;
} = {}): DiagnosticSessionState {
  const timestamp = asIsoDate(options.now, nowIso());

  return {
    version: DIAGNOSTIC_SESSION_VERSION,
    sessionId: asNonEmptyString(options.sessionId, createSessionId()),
    profileName: "",
    phase: "intro",
    routeMode: null,
    bankVersion: "v2",
    routePlan: [],
    routeCursor: 0,
    responses: {},
    interests: {},
    selectedAreas: {
      applied: [],
      deepening: [],
    },
    currentQuestionId: null,
    confirmationIds: [],
    confirmationLevel: null,
    confirmationReturnPhase: null,
    activeSecondsTotal: 0,
    paused: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Converts current or legacy/unversioned data to the current schema. Unknown
 * future versions are rejected instead of being rewritten destructively.
 */
export function normalizeSession(
  rawValue: unknown,
  fallbackNow = nowIso(),
): DiagnosticSessionState | null {
  if (!isRecord(rawValue)) return null;

  // Accept a file produced by exportSessionJson as well as a raw session.
  const raw = isRecord(rawValue.session) ? rawValue.session : rawValue;
  const rawVersion = raw.version ?? raw.schemaVersion ?? 0;
  if (
    typeof rawVersion !== "number" ||
    !Number.isInteger(rawVersion) ||
    rawVersion < 0 ||
    rawVersion > DIAGNOSTIC_SESSION_VERSION
  ) {
    return null;
  }

  const safeNow = asIsoDate(fallbackNow, nowIso());
  const createdAt = asIsoDate(raw.createdAt, safeNow);
  const updatedAt = asIsoDate(raw.updatedAt, createdAt);
  const selectedAreas = isRecord(raw.selectedAreas) ? raw.selectedAreas : {};

  // Version 0 used `answers`, `interestRatings` and separate selection fields.
  const responseSource = raw.responses ?? raw.answers;
  const interestSource = raw.interests ?? raw.interestRatings;
  const appliedSource = selectedAreas.applied ?? raw.selectedAppliedAreas;
  const deepeningSource = selectedAreas.deepening ?? raw.selectedDeepeningAreas;

  return {
    version: DIAGNOSTIC_SESSION_VERSION,
    sessionId: asNonEmptyString(raw.sessionId, createSessionId()),
    profileName: asNonEmptyString(raw.profileName, ""),
    phase: asPhase(raw.phase),
    routeMode: asRouteMode(raw.routeMode),
    bankVersion: asNonEmptyString(raw.bankVersion, rawVersion >= 3 ? "v2" : "v1-legacy"),
    routePlan: Array.isArray(raw.routePlan)
      ? raw.routePlan.flatMap((entry): RoutePlanEntry[] => {
          if (!isRecord(entry) || typeof entry.questionId !== "string" || typeof entry.areaId !== "string") return [];
          const phase = entry.phase === "essential" || entry.phase === "applied" || entry.phase === "deepening" ? entry.phase : "essential";
          return [{
            questionId: entry.questionId,
            itemVersion: Number.isInteger(entry.itemVersion) && Number(entry.itemVersion) > 0 ? Number(entry.itemVersion) : 1,
            phase,
            areaId: entry.areaId,
            reason: asNonEmptyString(entry.reason, "Ruta seleccionada"),
            isConfirmation: entry.isConfirmation === true,
          }];
        })
      : [],
    routeCursor: Math.max(0, Math.floor(asNonNegativeNumber(raw.routeCursor))),
    responses: normalizeResponses(responseSource, createdAt, updatedAt),
    interests: normalizeInterests(interestSource, updatedAt),
    selectedAreas: {
      applied: asUniqueStringArray(appliedSource),
      deepening: asUniqueStringArray(deepeningSource),
    },
    currentQuestionId:
      typeof raw.currentQuestionId === "string" && raw.currentQuestionId.trim()
        ? raw.currentQuestionId.trim()
        : null,
    confirmationIds: asUniqueStringArray(raw.confirmationIds),
    confirmationLevel:
      raw.confirmationLevel === "essential" || raw.confirmationLevel === "applied" || raw.confirmationLevel === "deepening"
        ? raw.confirmationLevel
        : null,
    confirmationReturnPhase:
      raw.confirmationReturnPhase === "essential" || raw.confirmationReturnPhase === "applied" || raw.confirmationReturnPhase === "deepening"
        ? raw.confirmationReturnPhase
        : null,
    activeSecondsTotal: asNonNegativeNumber(
      raw.activeSecondsTotal ?? raw.totalActiveSeconds,
    ),
    paused: typeof raw.paused === "boolean" ? raw.paused : false,
    createdAt,
    updatedAt,
  };
}

export function serializeSession(state: DiagnosticSessionState): string {
  return JSON.stringify({
    ...state,
    version: DIAGNOSTIC_SESSION_VERSION,
  });
}

export function deserializeSession(
  serialized: string | null | undefined,
  fallbackNow?: string,
): DiagnosticSessionState | null {
  if (!serialized) return null;

  try {
    return normalizeSession(JSON.parse(serialized) as unknown, fallbackNow);
  } catch {
    return null;
  }
}

/** Storage is injected so importing this module never touches localStorage. */
export function loadSession(
  storage: SessionStorageReader,
): DiagnosticSessionState | null {
  try {
    return deserializeSession(storage.getItem(DIAGNOSTIC_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Storage is injected so callers decide when browser persistence is allowed. */
export function saveSession(
  storage: SessionStorageWriter,
  state: DiagnosticSessionState,
): boolean {
  try {
    storage.setItem(DIAGNOSTIC_STORAGE_KEY, serializeSession(state));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(storage: SessionStorageWriter): boolean {
  try {
    storage.removeItem(DIAGNOSTIC_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function exportSessionJson(
  state: DiagnosticSessionState,
  exportedAt = nowIso(),
): string {
  return JSON.stringify(
    {
      format: "brujula-tic-diagnostic",
      version: DIAGNOSTIC_SESSION_VERSION,
      exportedAt: asIsoDate(exportedAt, nowIso()),
      session: state,
    },
    null,
    2,
  );
}

/** Computes progress against the question IDs that belong to the active route. */
export function getSessionProgress(
  state: DiagnosticSessionState,
  questionIds: readonly string[],
): SessionProgress {
  const uniqueIds = Array.from(new Set(questionIds));
  const answered = uniqueIds.reduce(
    (count, questionId) => count + (state.responses[questionId] ? 1 : 0),
    0,
  );
  const total = uniqueIds.length;
  const remaining = Math.max(0, total - answered);
  const currentIndex = state.currentQuestionId
    ? uniqueIds.indexOf(state.currentQuestionId)
    : -1;

  return {
    answered,
    total,
    remaining,
    percentage: total === 0 ? 0 : Math.round((answered / total) * 100),
    currentIndex: currentIndex >= 0 ? currentIndex : null,
    nextUnansweredId:
      uniqueIds.find((questionId) => !state.responses[questionId]) ?? null,
  };
}
