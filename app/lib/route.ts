import { diagnosticAreas, diagnosticQuestions, type DiagnosticLevel, type DiagnosticQuestion } from "../data/questions.v2.generated";
import type { DiagnosticSessionState, QuestionResponse, RouteMode, RoutePlanEntry } from "./session";

const LEVELS: DiagnosticLevel[] = ["essential", "applied", "deepening"];

function areaOrder(areaIds: readonly string[]) {
  const selected = new Set(areaIds);
  return diagnosticAreas.filter((area) => selected.has(area.id));
}

export function questionsForStage(
  level: DiagnosticLevel,
  areaIds: readonly string[],
  mode: RouteMode | null,
): DiagnosticQuestion[] {
  if (mode === "panorama" && level !== "essential") return [];
  const count = mode === "deep" || mode === "focused" ? 8 : 4;
  return areaOrder(areaIds).flatMap((area) =>
    area.questions
      .filter((question) => question.level === level)
      .sort((left, right) => Number(right.isAnchor) - Number(left.isAnchor) || left.id.localeCompare(right.id, "es"))
      .slice(0, count),
  );
}

export function fullQuestionsForStage(
  level: DiagnosticLevel,
  areaIds: readonly string[],
): DiagnosticQuestion[] {
  return areaOrder(areaIds).flatMap((area) =>
    area.questions
      .filter((question) => question.level === level)
      .sort((left, right) => left.id.localeCompare(right.id, "es"))
      .slice(0, 8),
  );
}

function normalizedResponse(response: QuestionResponse | undefined) {
  if (!response) return null;
  const max = Math.max(1, response.maxPoints || 1);
  return Math.max(0, Math.min(1, (response.awardedPoints ?? (response.correct ? max : 0)) / max));
}

function shouldConfirm(
  questions: readonly DiagnosticQuestion[],
  responses: DiagnosticSessionState["responses"],
) {
  const answered = questions.filter((question) => responses[question.id]);
  if (answered.length < 4) return false;
  const scores = answered.map((question) => normalizedResponse(responses[question.id]) ?? 0);
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const uncertain = answered.filter((question) => responses[question.id]?.confidence !== "sure").length;
  const contradiction = answered.some((question) => {
    const response = responses[question.id];
    const score = normalizedResponse(response);
    return (response?.confidence === "sure" && score !== null && score <= 1 / 3)
      || (response?.confidence === "guess" && score !== null && score >= 2 / 3);
  });
  return (average >= 0.4 && average <= 0.75) || contradiction || uncertain >= 2;
}

export function chooseConfirmations(
  level: DiagnosticLevel,
  areaIds: readonly string[],
  responses: DiagnosticSessionState["responses"],
): DiagnosticQuestion[] {
  if (!areaIds.length) return [];
  return areaOrder(areaIds).flatMap((area) => {
    const anchors = area.questions
      .filter((question) => question.level === level)
      .sort((left, right) => Number(right.isAnchor) - Number(left.isAnchor) || left.id.localeCompare(right.id, "es"))
      .slice(0, 4);
    if (!shouldConfirm(anchors, responses)) return [];

    const ranked = [...anchors].sort((left, right) => {
      const leftResponse = responses[left.id];
      const rightResponse = responses[right.id];
      const leftScore = normalizedResponse(leftResponse) ?? 0.5;
      const rightScore = normalizedResponse(rightResponse) ?? 0.5;
      const leftConflict = leftResponse?.confidence === "sure" && leftScore <= 1 / 3 ? 1 : 0;
      const rightConflict = rightResponse?.confidence === "sure" && rightScore <= 1 / 3 ? 1 : 0;
      return rightConflict - leftConflict
        || Number(leftResponse?.confidence !== "sure") - Number(rightResponse?.confidence !== "sure")
        || Math.abs(leftScore - 0.5) - Math.abs(rightScore - 0.5);
    });
    const selectedSubcompetencies = new Set(ranked.slice(0, 2).map((question) => question.subcompetencyId));
    return area.questions
      .filter((question) => question.level === level && !question.isAnchor && selectedSubcompetencies.has(question.subcompetencyId))
      .sort((left, right) => left.id.localeCompare(right.id, "es"))
      .slice(0, 2);
  });
}

export function routeBaseEntries(
  mode: RouteMode,
  appliedAreaIds: readonly string[] = [],
  deepeningAreaIds: readonly string[] = [],
): RoutePlanEntry[] {
  const selectedApplied = mode === "focused" ? appliedAreaIds : appliedAreaIds;
  const selectedDeepening = mode === "focused" ? deepeningAreaIds : deepeningAreaIds;
  const stages: Array<[DiagnosticLevel, readonly string[], string]> = [
    ["essential", mode === "focused" ? selectedApplied : diagnosticAreas.map((area) => area.id), "Fundamento ancla"],
    ["applied", selectedApplied, "Aplicación seleccionada"],
    ["deepening", selectedDeepening, "Profundización seleccionada"],
  ];
  if (mode === "panorama") stages.splice(1, 2);
  return stages.flatMap(([level, areaIds, reason]) =>
    questionsForStage(level, areaIds, mode).map((question) => ({
      questionId: question.id,
      itemVersion: question.version,
      phase: level,
      areaId: question.areaId,
      reason,
      isConfirmation: false,
    })),
  );
}

export function routeQuestionIds(session: DiagnosticSessionState): string[] {
  if (session.routePlan.length) return session.routePlan.map((entry) => entry.questionId);
  const applied = session.routeMode === "focused" ? session.selectedAreas.applied : session.selectedAreas.applied;
  return routeBaseEntries(session.routeMode ?? "recommended", applied, session.selectedAreas.deepening).map((entry) => entry.questionId);
}

export function routeBaseCount(
  mode: RouteMode | null,
  appliedCount: number,
  deepeningCount: number,
): number {
  if (mode === "panorama") return 52;
  if (mode === "deep") return 104 + appliedCount * 8 + deepeningCount * 8;
  if (mode === "focused") return (appliedCount || deepeningCount) * 24;
  return 52 + appliedCount * 4 + deepeningCount * 4;
}

export function routeStageForQuestion(questionId: string, session: DiagnosticSessionState): DiagnosticLevel | "confirmation" | null {
  const entry = session.routePlan.find((candidate) => candidate.questionId === questionId);
  return entry?.isConfirmation ? "confirmation" : entry?.phase ?? null;
}

export function isDiagnosticLevel(value: string): value is DiagnosticLevel {
  return LEVELS.includes(value as DiagnosticLevel);
}

export const diagnosticQuestionById = Object.fromEntries(diagnosticQuestions.map((question) => [question.id, question]));

