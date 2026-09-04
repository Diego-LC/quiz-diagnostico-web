import type { DiagnosticSessionState } from "./session";

export const DIAGNOSTIC_HISTORY_STORAGE_KEY = "brujula-tic:diagnostic-history";
export const DIAGNOSTIC_HISTORY_VERSION = 1 as const;

export interface DiagnosticAttemptRecord {
  id: string;
  version: typeof DIAGNOSTIC_HISTORY_VERSION;
  profileName: string;
  routeMode: DiagnosticSessionState["routeMode"];
  bankVersion: string;
  createdAt: string;
  completedAt: string;
  responseCount: number;
  routePlan: DiagnosticSessionState["routePlan"];
  responses: DiagnosticSessionState["responses"];
  interests: DiagnosticSessionState["interests"];
  selectedAreas: DiagnosticSessionState["selectedAreas"];
}

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function asIso(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function asRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAttempt(value: unknown): DiagnosticAttemptRecord | null {
  if (!asRecord(value)) return null;
  const now = new Date().toISOString();
  const routeMode = value.routeMode === "panorama" || value.routeMode === "recommended" || value.routeMode === "deep" || value.routeMode === "focused"
    ? value.routeMode
    : null;
  const responses = asRecord(value.responses) ? value.responses as DiagnosticSessionState["responses"] : {};
  const interests = asRecord(value.interests) ? value.interests as DiagnosticSessionState["interests"] : {};
  const rawSelectedAreas = asRecord(value.selectedAreas) ? value.selectedAreas : null;
  const selectedAreas = rawSelectedAreas
    ? {
        applied: Array.isArray(rawSelectedAreas.applied) ? rawSelectedAreas.applied.filter((id): id is string => typeof id === "string") : [],
        deepening: Array.isArray(rawSelectedAreas.deepening) ? rawSelectedAreas.deepening.filter((id): id is string => typeof id === "string") : [],
      }
    : { applied: [], deepening: [] };
  const routePlan = Array.isArray(value.routePlan) ? value.routePlan as DiagnosticSessionState["routePlan"] : [];
  const id = typeof value.id === "string" && value.id.trim() ? value.id : null;
  if (!id) return null;
  return {
    id,
    version: DIAGNOSTIC_HISTORY_VERSION,
    profileName: typeof value.profileName === "string" ? value.profileName : "",
    routeMode,
    bankVersion: typeof value.bankVersion === "string" ? value.bankVersion : "v1-legacy",
    createdAt: asIso(value.createdAt, now),
    completedAt: asIso(value.completedAt, now),
    responseCount: Object.keys(responses).length,
    routePlan,
    responses,
    interests,
    selectedAreas,
  };
}

export function loadAttemptHistory(storage: StorageReader): DiagnosticAttemptRecord[] {
  try {
    const raw = storage.getItem(DIAGNOSTIC_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    const values = Array.isArray(parsed) ? parsed : asRecord(parsed) && Array.isArray(parsed.attempts) ? parsed.attempts : [];
    return values.flatMap((value) => {
      const attempt = normalizeAttempt(value);
      return attempt ? [attempt] : [];
    });
  } catch {
    return [];
  }
}

export function saveAttemptHistory(storage: StorageWriter, attempts: readonly DiagnosticAttemptRecord[]): boolean {
  try {
    storage.setItem(
      DIAGNOSTIC_HISTORY_STORAGE_KEY,
      JSON.stringify({ format: "brujula-tic-history", version: DIAGNOSTIC_HISTORY_VERSION, attempts }),
    );
    return true;
  } catch {
    return false;
  }
}

export function makeAttemptRecord(
  session: DiagnosticSessionState,
  completedAt = new Date().toISOString(),
): DiagnosticAttemptRecord {
  return {
    id: session.sessionId,
    version: DIAGNOSTIC_HISTORY_VERSION,
    profileName: session.profileName,
    routeMode: session.routeMode,
    bankVersion: session.bankVersion,
    createdAt: session.createdAt,
    completedAt,
    responseCount: Object.keys(session.responses).length,
    routePlan: session.routePlan,
    responses: session.responses,
    interests: session.interests,
    selectedAreas: session.selectedAreas,
  };
}

export function appendAttemptHistory(
  storage: StorageWriter,
  attempt: DiagnosticAttemptRecord,
): DiagnosticAttemptRecord[] {
  const current = loadAttemptHistory(storage);
  const next = [attempt, ...current.filter((item) => item.id !== attempt.id)];
  saveAttemptHistory(storage, next);
  return next;
}

export function removeAttemptHistory(storage: StorageWriter, attemptId: string): DiagnosticAttemptRecord[] {
  const next = loadAttemptHistory(storage).filter((attempt) => attempt.id !== attemptId);
  saveAttemptHistory(storage, next);
  return next;
}
