export const DIAGNOSTIC_LEVELS = [
  "essential",
  "applied",
  "deepening",
] as const;

export type DiagnosticLevel = (typeof DIAGNOSTIC_LEVELS)[number];
export type Confidence = "guess" | "doubtful" | "sure";
export type LikertValue = 1 | 2 | 3 | 4 | 5;

export interface DiagnosticResponse {
  questionId?: string;
  areaId: string;
  level: DiagnosticLevel;
  isCorrect: boolean;
  awardedPoints?: number;
  maxPoints?: number;
  itemType?: "single-best" | "graded-judgment" | "practical";
  subcompetencyId?: string;
  confidence: Confidence;
  activeSeconds: number;
}

export interface AreaInterest {
  areaId: string;
  enjoyed: LikertValue;
  learn: LikertValue;
  project: LikertValue;
}

export interface ResponseMetrics {
  correct: number;
  total: number;
  earnedPoints: number;
  possiblePoints: number;
  scorePercent: number | null;
  accuracyPercent: number | null;
  highConfidenceWrong: number;
  uncertain: number;
  uncertaintyPercent: number | null;
  averageActiveSeconds: number | null;
  medianActiveSeconds: number | null;
}

export interface AreaMetrics {
  areaId: string;
  overall: ResponseMetrics;
  byLevel: Record<DiagnosticLevel, ResponseMetrics>;
}

export interface SuggestionComponents {
  interest: number;
  essentialPerformance: number;
  appliedPerformance: number | null;
  uncertainty: number;
}

export interface AreaSuggestion {
  areaId: string;
  score: number;
  components: SuggestionComponents;
  reasons: string[];
}

export type AreaQuadrant =
  | "strength-and-interest"
  | "strength-for-support"
  | "learning-opportunity"
  | "lower-priority";

export interface AreaProfile {
  areaId: string;
  areaName: string;
  domainScore: number;
  domainPercent: number;
  interestScore: number;
  interestAverage: number;
  quadrant: AreaQuadrant;
  answered: number;
}

export interface ProfileOptions {
  domainThreshold?: number;
  interestThreshold?: number;
}

export interface AreaRecommendation {
  areaId: string;
  areaName: string;
  score: number;
  message: string;
}

export interface DiagnosticRecommendations {
  projectCandidates: AreaRecommendation[];
  learningPriorities: AreaRecommendation[];
  supportStrengths: AreaRecommendation[];
  exploreLater: AreaRecommendation[];
}

const EMPTY_METRICS: ResponseMetrics = {
  correct: 0,
  total: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  scorePercent: null,
  accuracyPercent: null,
  highConfidenceWrong: 0,
  uncertain: 0,
  uncertaintyPercent: null,
  averageActiveSeconds: null,
  medianActiveSeconds: null,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const summarize = (
  responses: readonly DiagnosticResponse[],
): ResponseMetrics => {
  if (responses.length === 0) return { ...EMPTY_METRICS };

  const times = responses.map((response) =>
    Number.isFinite(response.activeSeconds)
      ? Math.max(0, response.activeSeconds)
      : 0,
  );
  const correct = responses.filter((response) => response.isCorrect).length;
  const earnedPoints = responses.reduce((total, response) => {
    const max = Number.isFinite(response.maxPoints) && (response.maxPoints ?? 0) > 0
      ? response.maxPoints ?? 1
      : 1;
    const earned = Number.isFinite(response.awardedPoints)
      ? Math.min(max, Math.max(0, response.awardedPoints ?? 0))
      : response.isCorrect ? max : 0;
    return total + earned;
  }, 0);
  const possiblePoints = responses.reduce((total, response) => {
    const max = Number.isFinite(response.maxPoints) && (response.maxPoints ?? 0) > 0
      ? response.maxPoints ?? 1
      : 1;
    return total + max;
  }, 0);
  const highConfidenceWrong = responses.filter(
    (response) => !response.isCorrect && response.confidence === "sure",
  ).length;
  // Incluye dudas explícitas y errores seguros: ambas señales justifican revisar.
  const uncertain = responses.filter(
    (response) =>
      response.confidence !== "sure" ||
      (!response.isCorrect && response.confidence === "sure"),
  ).length;

  return {
    correct,
    total: responses.length,
    earnedPoints: round(earnedPoints, 2),
    possiblePoints: round(possiblePoints, 2),
    scorePercent: possiblePoints > 0 ? round((earnedPoints / possiblePoints) * 100) : null,
    accuracyPercent: round((correct / responses.length) * 100),
    highConfidenceWrong,
    uncertain,
    uncertaintyPercent: round((uncertain / responses.length) * 100),
    averageActiveSeconds: round(
      times.reduce((total, time) => total + time, 0) / times.length,
    ),
    medianActiveSeconds: round(median(times) ?? 0),
  };
};

const stableAreaIds = (
  responses: readonly DiagnosticResponse[],
  requestedAreaIds?: readonly string[],
) => {
  const source = requestedAreaIds ?? responses.map((response) => response.areaId);
  return [...new Set(source)].sort((left, right) =>
    left.localeCompare(right, "es"),
  );
};

export function calculateMetricsByArea(
  responses: readonly DiagnosticResponse[],
  areaIds?: readonly string[],
): AreaMetrics[] {
  return stableAreaIds(responses, areaIds).map((areaId) => {
    const areaResponses = responses.filter(
      (response) => response.areaId === areaId,
    );
    const byLevel = Object.fromEntries(
      DIAGNOSTIC_LEVELS.map((level) => [
        level,
        summarize(
          areaResponses.filter((response) => response.level === level),
        ),
      ]),
    ) as Record<DiagnosticLevel, ResponseMetrics>;

    return {
      areaId,
      overall: summarize(areaResponses),
      byLevel,
    };
  });
}

export function calculateOverallMetrics(
  responses: readonly DiagnosticResponse[],
): ResponseMetrics {
  return summarize(responses);
}

const interestAverage = (interest?: AreaInterest) => {
  if (!interest) return 3;
  return (interest.enjoyed + interest.learn + interest.project) / 3;
};

const normalizedInterest = (interest?: AreaInterest) =>
  clamp01((interestAverage(interest) - 1) / 4);

const accuracyScore = (metric: ResponseMetrics, fallback = 0.5) =>
  metric.scorePercent === null ? fallback : metric.scorePercent / 100;

const uncertaintyScore = (metric: ResponseMetrics) =>
  metric.uncertaintyPercent === null ? 0.5 : metric.uncertaintyPercent / 100;

const reasonList = (
  interest: number,
  performance: number,
  uncertainty: number,
) => {
  const reasons: string[] = [];
  if (interest >= 0.75) reasons.push("interés alto");
  if (performance >= 0.6) reasons.push("buen desempeño previo");
  if (uncertainty >= 0.4) reasons.push("conviene reunir más evidencia");
  if (reasons.length === 0) reasons.push("amplía el diagnóstico");
  return reasons;
};

const sortSuggestions = (suggestions: AreaSuggestion[]) =>
  suggestions.sort(
    (left, right) =>
      right.score - left.score ||
      right.components.interest - left.components.interest ||
      left.areaId.localeCompare(right.areaId, "es"),
  );

export function suggestAppliedAreas(
  areaIds: readonly string[],
  responses: readonly DiagnosticResponse[],
  interests: readonly AreaInterest[],
  limit = 4,
): AreaSuggestion[] {
  const metrics = new Map(
    calculateMetricsByArea(responses, areaIds).map((metric) => [
      metric.areaId,
      metric,
    ]),
  );
  const interestMap = new Map(
    interests.map((interest) => [interest.areaId, interest]),
  );

  const suggestions = areaIds.map((areaId): AreaSuggestion => {
    const metric = metrics.get(areaId);
    const essentialPerformance = accuracyScore(
      metric?.byLevel.essential ?? EMPTY_METRICS,
    );
    const interest = normalizedInterest(interestMap.get(areaId));
    const uncertainty = uncertaintyScore(
      metric?.byLevel.essential ?? EMPTY_METRICS,
    );
    const rawScore =
      0.45 * interest + 0.35 * essentialPerformance + 0.2 * uncertainty;

    return {
      areaId,
      score: round(rawScore * 100),
      components: {
        interest: round(interest * 100),
        essentialPerformance: round(essentialPerformance * 100),
        appliedPerformance: null,
        uncertainty: round(uncertainty * 100),
      },
      reasons: reasonList(interest, essentialPerformance, uncertainty),
    };
  });

  return sortSuggestions(suggestions).slice(0, Math.max(0, limit));
}

export function suggestDeepeningAreas(
  areaIds: readonly string[],
  responses: readonly DiagnosticResponse[],
  interests: readonly AreaInterest[],
  limit = 2,
): AreaSuggestion[] {
  const metrics = new Map(
    calculateMetricsByArea(responses, areaIds).map((metric) => [
      metric.areaId,
      metric,
    ]),
  );
  const interestMap = new Map(
    interests.map((interest) => [interest.areaId, interest]),
  );

  const suggestions = areaIds.map((areaId): AreaSuggestion => {
    const metric = metrics.get(areaId);
    const essentialPerformance = accuracyScore(
      metric?.byLevel.essential ?? EMPTY_METRICS,
    );
    const appliedPerformance = accuracyScore(
      metric?.byLevel.applied ?? EMPTY_METRICS,
    );
    const interest = normalizedInterest(interestMap.get(areaId));
    const uncertainty = uncertaintyScore(
      metric?.byLevel.applied.total
        ? metric.byLevel.applied
        : (metric?.byLevel.essential ?? EMPTY_METRICS),
    );
    const combinedPerformance =
      essentialPerformance * 0.15 + appliedPerformance * 0.3;
    const rawScore =
      0.4 * interest + combinedPerformance + 0.15 * uncertainty;

    return {
      areaId,
      score: round(rawScore * 100),
      components: {
        interest: round(interest * 100),
        essentialPerformance: round(essentialPerformance * 100),
        appliedPerformance: round(appliedPerformance * 100),
        uncertainty: round(uncertainty * 100),
      },
      reasons: reasonList(
        interest,
        essentialPerformance * 0.33 + appliedPerformance * 0.67,
        uncertainty,
      ),
    };
  });

  return sortSuggestions(suggestions).slice(0, Math.max(0, limit));
}

const domainScore = (metric: AreaMetrics) => {
  const weights: Record<DiagnosticLevel, number> = {
    essential: 0.35,
    applied: 0.4,
    deepening: 0.25,
  };
  let totalWeight = 0;
  let weightedAccuracy = 0;

  for (const level of DIAGNOSTIC_LEVELS) {
    const levelMetric = metric.byLevel[level];
    if (levelMetric.scorePercent === null) continue;
    totalWeight += weights[level];
    weightedAccuracy += (levelMetric.scorePercent / 100) * weights[level];
  }

  return totalWeight === 0 ? 0 : weightedAccuracy / totalWeight;
};

export function classifyAreaProfiles(
  areaIds: readonly string[],
  responses: readonly DiagnosticResponse[],
  interests: readonly AreaInterest[],
  areaNames: Readonly<Record<string, string>> = {},
  options: ProfileOptions = {},
): AreaProfile[] {
  const domainThreshold = options.domainThreshold ?? 0.6;
  const interestThreshold = options.interestThreshold ?? 4;
  const metricMap = new Map(
    calculateMetricsByArea(responses, areaIds).map((metric) => [
      metric.areaId,
      metric,
    ]),
  );
  const interestMap = new Map(
    interests.map((interest) => [interest.areaId, interest]),
  );

  return areaIds.map((areaId) => {
    const metric = metricMap.get(areaId) ?? {
      areaId,
      overall: { ...EMPTY_METRICS },
      byLevel: Object.fromEntries(
        DIAGNOSTIC_LEVELS.map((level) => [level, { ...EMPTY_METRICS }]),
      ) as Record<DiagnosticLevel, ResponseMetrics>,
    };
    const domain = domainScore(metric);
    const averageInterest = interestAverage(interestMap.get(areaId));
    const highDomain = domain >= domainThreshold;
    const highInterest = averageInterest >= interestThreshold;
    let quadrant: AreaQuadrant;

    if (highDomain && highInterest) quadrant = "strength-and-interest";
    else if (highDomain) quadrant = "strength-for-support";
    else if (highInterest) quadrant = "learning-opportunity";
    else quadrant = "lower-priority";

    return {
      areaId,
      areaName: areaNames[areaId] ?? areaId,
      domainScore: round(domain, 3),
      domainPercent: round(domain * 100),
      interestScore: round(normalizedInterest(interestMap.get(areaId)), 3),
      interestAverage: round(averageInterest, 2),
      quadrant,
      answered: metric.overall.total,
    };
  });
}

const recommendation = (
  profile: AreaProfile,
  score: number,
  message: string,
): AreaRecommendation => ({
  areaId: profile.areaId,
  areaName: profile.areaName,
  score: round(score * 100),
  message,
});

const projectFit = (profile: AreaProfile) =>
  profile.interestScore * 0.58 + profile.domainScore * 0.42;

const ranked = (items: AreaRecommendation[], limit: number) =>
  items
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.areaName.localeCompare(right.areaName, "es"),
    )
    .slice(0, Math.max(0, limit));

export function buildRecommendations(
  profiles: readonly AreaProfile[],
  limit = 3,
): DiagnosticRecommendations {
  const projectPool = profiles
    .filter(
      (profile) =>
        profile.quadrant === "strength-and-interest" ||
        profile.quadrant === "learning-opportunity",
    )
    .map((profile) =>
      recommendation(
        profile,
        projectFit(profile),
        profile.quadrant === "strength-and-interest"
          ? "Buen cruce entre dominio e interés para explorar un proyecto."
          : "Interés alto; conviene acotar el proyecto y reforzar fundamentos.",
      ),
    );

  // Si nadie supera el umbral de interés, igualmente entrega alternativas comparables.
  if (projectPool.length === 0) {
    projectPool.push(
      ...profiles.map((profile) =>
        recommendation(
          profile,
          projectFit(profile),
          "Es una alternativa inicial; contrástala con una actividad práctica breve.",
        ),
      ),
    );
  }

  const learningPriorities = profiles
    .filter((profile) => profile.quadrant === "learning-opportunity")
    .map((profile) =>
      recommendation(
        profile,
        profile.interestScore * 0.65 + (1 - profile.domainScore) * 0.35,
        "Hay motivación, pero faltan bases: prioriza ejercicios guiados y vuelve a medir.",
      ),
    );

  const supportStrengths = profiles
    .filter((profile) => profile.quadrant === "strength-for-support")
    .map((profile) =>
      recommendation(
        profile,
        profile.domainScore,
        "Es una fortaleza útil para apoyar al equipo, aunque hoy no sea tu principal interés.",
      ),
    );

  const exploreLater = profiles
    .filter((profile) => profile.quadrant === "lower-priority")
    .map((profile) =>
      recommendation(
        profile,
        profile.interestScore * 0.5 + profile.domainScore * 0.5,
        "No parece prioridad inmediata; revísala más adelante o si el proyecto la requiere.",
      ),
    );

  return {
    projectCandidates: ranked(projectPool, limit),
    learningPriorities: ranked(learningPriorities, limit),
    supportStrengths: ranked(supportStrengths, limit),
    exploreLater: ranked(exploreLater, limit),
  };
}
