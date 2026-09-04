"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  diagnosticAreas,
  diagnosticQuestions,
  questionsById,
  type DiagnosticLevel,
  type DiagnosticOptionKey,
  type DiagnosticQuestion,
} from "./data/questions.v2.generated";
import {
  buildRecommendations,
  calculateMetricsByArea,
  calculateOverallMetrics,
  classifyAreaProfiles,
  suggestAppliedAreas,
  suggestDeepeningAreas,
  type AreaInterest as ScoringInterest,
  type DiagnosticResponse as ScoringResponse,
} from "./lib/diagnostic";
import {
  clearSession,
  createInitialSession,
  loadSession,
  saveSession,
  type AnswerConfidence,
  type DiagnosticPhase,
  type DiagnosticSessionState,
  type InterestScore,
} from "./lib/session";
import {
  chooseConfirmations,
  questionsForStage,
  routeBaseEntries,
  routeBaseCount,
} from "./lib/route";
import {
  appendAttemptHistory,
  loadAttemptHistory,
  makeAttemptRecord,
  type DiagnosticAttemptRecord,
} from "./lib/history";
import InlineMarkdown from "./components/InlineMarkdown";

const levelLabels: Record<DiagnosticLevel, string> = {
  essential: "Nivel 1 · Esencial",
  applied: "Nivel 2 · Aplicado",
  deepening: "Nivel 3 · Profundización",
};

const phaseCopy: Record<
  DiagnosticPhase,
  { eyebrow: string; title: string; short: string }
> = {
  intro: {
    eyebrow: "Diagnóstico adaptativo",
    title: "Encuentra tus fortalezas, brechas e intereses en TIC.",
    short: "Preparación",
  },
  essential: {
    eyebrow: "Primera pasada · Mapa general",
    title: "Construyamos tu mapa de fundamentos.",
    short: "Mapa esencial",
  },
  confirmation: {
    eyebrow: "Comprobación adaptativa",
    title: "Verifiquemos una señal antes de decidir.",
    short: "Comprobación",
  },
  "route-select": {
    eyebrow: "Diseña tu recorrido",
    title: "Elige cuánto quieres explorar hoy.",
    short: "Ruta",
  },
  interest: {
    eyebrow: "Pausa de interés",
    title: "El conocimiento es solo una parte del perfil.",
    short: "Interés",
  },
  "select-applied": {
    eyebrow: "Segunda pasada · Decisión",
    title: "Elige dónde comprobar tu conocimiento aplicado.",
    short: "Selección aplicada",
  },
  applied: {
    eyebrow: "Segunda pasada · Aplicación",
    title: "Lleva los fundamentos a situaciones habituales.",
    short: "Aplicación",
  },
  "select-deepening": {
    eyebrow: "Tercera pasada · Decisión",
    title: "Elige tus candidatas para profundizar.",
    short: "Selección avanzada",
  },
  deepening: {
    eyebrow: "Tercera pasada · Profundización",
    title: "Evalúa decisiones con restricciones y compensaciones.",
    short: "Profundización",
  },
  results: {
    eyebrow: "Perfil orientativo",
    title: "Tu mapa está listo para convertirlo en decisiones.",
    short: "Resultados",
  },
};

const confidenceLabels: Record<AnswerConfidence, { label: string; hint: string }> = {
  guess: { label: "Al azar", hint: "No cuento con base suficiente" },
  unsure: { label: "Dudoso", hint: "Reconozco parte del tema" },
  sure: { label: "Seguro", hint: "Podría explicar mi elección" },
};

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "brujula-tic:theme";
type ViewTab = "journey" | "results";

const allAreaIds = diagnosticAreas.map((area) => area.id);
const areaNames = Object.fromEntries(
  diagnosticAreas.map((area) => [area.id, area.name]),
);

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function stableOptionOrder(question: DiagnosticQuestion, seed: string): DiagnosticOptionKey[] {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return [...question.options]
    .sort((left, right) => {
      const leftHash = (hash ^ left.key.charCodeAt(0)) >>> 0;
      const rightHash = (hash ^ right.key.charCodeAt(0)) >>> 0;
      return leftHash - rightHash || left.key.localeCompare(right.key);
    })
    .map((option) => option.key);
}

function toScoringResponses(session: DiagnosticSessionState): ScoringResponse[] {
  return Object.values(session.responses).flatMap((response) => {
    const question = questionsById[response.questionId];
    if (!question) return [];
    return [
      {
        questionId: response.questionId,
        areaId: question.areaId,
        level: question.level,
        isCorrect: response.correct,
        awardedPoints: response.awardedPoints,
        maxPoints: response.maxPoints,
        itemType: response.itemType,
        subcompetencyId: question.subcompetencyId,
        confidence:
          response.confidence === "unsure" ? "doubtful" : response.confidence,
        activeSeconds: response.activeSeconds,
      },
    ];
  });
}

function toScoringInterests(session: DiagnosticSessionState): ScoringInterest[] {
  return Object.entries(session.interests).map(([areaId, interest]) => ({
    areaId,
    enjoyed: interest.enjoyed,
    learn: interest.learnMore,
    project: interest.projectInterest,
  }));
}

function getInterestAverage(session: DiagnosticSessionState, areaId: string) {
  const value = session.interests[areaId];
  if (!value) return null;
  return (value.enjoyed + value.learnMore + value.projectInterest) / 3;
}

function findPendingInterestArea(session: DiagnosticSessionState) {
  return diagnosticAreas.find((area) => {
    if (session.interests[area.id]) return false;
    const essentialIds = session.routePlan.length
      ? session.routePlan
          .filter((entry) => entry.areaId === area.id && entry.phase === "essential" && !entry.isConfirmation)
          .map((entry) => entry.questionId)
      : area.questions.filter((question) => question.level === "essential").slice(0, 4).map((question) => question.id);
    if (essentialIds.length === 0) return false;
    return essentialIds.every((id) => session.responses[id]);
  });
}

function nextUnanswered(
  questions: readonly DiagnosticQuestion[],
  responses: DiagnosticSessionState["responses"],
) {
  return questions.find((question) => !responses[question.id]) ?? null;
}

function routeLength(session: DiagnosticSessionState) {
  if (session.routePlan.length) return session.routePlan.length;
  return routeBaseCount(
    session.routeMode,
    session.selectedAreas.applied.length,
    session.selectedAreas.deepening.length,
  );
}

function phaseQuestionsForSession(session: DiagnosticSessionState): DiagnosticQuestion[] {
  if (session.phase === "confirmation") {
    return session.confirmationIds.flatMap((id) => (questionsById[id] ? [questionsById[id]] : []));
  }
  if (session.phase !== "essential" && session.phase !== "applied" && session.phase !== "deepening") return [];
  const planned = session.routePlan
    .filter((entry) => entry.phase === session.phase && !entry.isConfirmation)
    .map((entry) => questionsById[entry.questionId])
    .filter((question): question is DiagnosticQuestion => Boolean(question));
  if (planned.length) return planned;
  const areaIds = session.phase === "essential" ? allAreaIds : session.phase === "applied" ? session.selectedAreas.applied : session.selectedAreas.deepening;
  return questionsForStage(session.phase, areaIds, session.routeMode ?? "recommended");
}

function repairLoadedSession(session: DiagnosticSessionState) {
  const knownQuestionIds = new Set(diagnosticQuestions.map((question) => question.id));
  const knownAreaIds = new Set(allAreaIds);
  const responses = Object.fromEntries(
    Object.entries(session.responses).filter(([id]) => knownQuestionIds.has(id)),
  );
  const interests = Object.fromEntries(
    Object.entries(session.interests).filter(([id]) => knownAreaIds.has(id)),
  );
  const selectedAreas = {
    applied: session.selectedAreas.applied.filter((id) => knownAreaIds.has(id)).slice(0, session.routeMode === "focused" ? 3 : 4),
    deepening: session.selectedAreas.deepening.filter((id) => knownAreaIds.has(id)).slice(0, session.routeMode === "focused" ? 3 : 2),
  };
  const routeMode = session.routeMode ?? "recommended";
  const routePlan = session.routePlan.length
    ? session.routePlan.filter((entry) => knownQuestionIds.has(entry.questionId))
    : routeBaseEntries(routeMode, selectedAreas.applied, selectedAreas.deepening);
  let currentQuestionId =
    session.currentQuestionId && knownQuestionIds.has(session.currentQuestionId)
      ? session.currentQuestionId
      : null;

  if (currentQuestionId && responses[currentQuestionId]) {
    const currentIds = session.phase === "confirmation"
      ? session.confirmationIds
      : session.phase === "essential" || session.phase === "applied" || session.phase === "deepening"
        ? routePlan.filter((entry) => entry.phase === session.phase && !entry.isConfirmation).map((entry) => entry.questionId)
        : [];
    const nextPending = nextUnanswered(currentIds.flatMap((id) => (questionsById[id] ? [questionsById[id]] : [])), responses);
    currentQuestionId = nextPending?.id ?? null;
  }

  if (!currentQuestionId && (session.phase === "essential" || session.phase === "confirmation")) {
    const ids = session.phase === "confirmation"
      ? session.confirmationIds
      : routePlan.filter((entry) => entry.phase === "essential" && !entry.isConfirmation).map((entry) => entry.questionId);
    currentQuestionId = nextUnanswered(ids.flatMap((id) => (questionsById[id] ? [questionsById[id]] : [])), responses)?.id ?? null;
  }
  if (!currentQuestionId && session.phase === "applied") {
    currentQuestionId =
      nextUnanswered(routePlan.filter((entry) => entry.phase === "applied" && !entry.isConfirmation).flatMap((entry) => (questionsById[entry.questionId] ? [questionsById[entry.questionId]] : [])), responses)?.id ?? null;
  }
  if (!currentQuestionId && session.phase === "deepening") {
    currentQuestionId =
      nextUnanswered(routePlan.filter((entry) => entry.phase === "deepening" && !entry.isConfirmation).flatMap((entry) => (questionsById[entry.questionId] ? [questionsById[entry.questionId]] : [])), responses)?.id ?? null;
  }

  return { ...session, routeMode, routePlan, responses, interests, selectedAreas, currentQuestionId };
}

function ProgressRail({ session }: { session: DiagnosticSessionState }) {
  const currentQuestion = session.currentQuestionId
    ? questionsById[session.currentQuestionId]
    : null;
  const pendingInterest = session.phase === "interest" ? findPendingInterestArea(session) : null;
  const activeAreaId = currentQuestion?.areaId ?? pendingInterest?.id;

  return (
    <aside className="area-rail" aria-label="Progreso por áreas">
      <button className="brand" type="button" aria-label="Brújula TIC">
        <span className="brand-mark">B</span>
        <span>
          <strong>Brújula</strong>
          <small>Diagnóstico TIC</small>
        </span>
      </button>

      <div className="rail-heading">
        <span>{phaseCopy[session.phase].short}</span>
        <strong>{Object.keys(session.responses).length} respuestas</strong>
      </div>

      <ol className="area-list">
        {diagnosticAreas.map((area) => {
          const planned = session.routePlan.filter((entry) => entry.areaId === area.id && !entry.isConfirmation);
          const essential = planned.filter(
            (entry) => entry.phase === "essential" && session.responses[entry.questionId],
          ).length;
          const extra = planned.filter(
            (entry) => entry.phase !== "essential" && session.responses[entry.questionId],
          ).length;
          const plannedEssential = planned.filter((entry) => entry.phase === "essential").length || 0;
          const plannedTotal = planned.length;
          const completed = plannedEssential > 0 && essential === plannedEssential && Boolean(session.interests[area.id]);
          return (
            <li
              className={`${activeAreaId === area.id ? "active" : ""} ${completed ? "complete" : ""}`}
              key={area.id}
            >
              <span>{String(area.number).padStart(2, "0")}</span>
              <div>
                <p>{area.name}</p>
                <small>{plannedTotal === 0 ? "Fuera de esta ruta" : extra > 0 ? `${essential + extra}/${plannedTotal}` : `${essential}/${plannedEssential} esenciales`}</small>
              </div>
              <i aria-hidden="true">{completed ? "✓" : ""}</i>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function SessionHeader({
  session,
  onTogglePause,
  viewTab,
}: {
  session: DiagnosticSessionState;
  onTogglePause: () => void;
  viewTab?: ViewTab;
}) {
  const copy = viewTab === "results"
    ? phaseCopy.results
    : session.profileName
      ? phaseCopy[session.phase]
    : {
        eyebrow: "Perfil local",
        title: "Personaliza tu recorrido diagnóstico.",
        short: "Perfil",
      };
  const answered = Object.keys(session.responses).length;
  const expected = routeLength(session);
  const progress = session.phase === "results" ? 100 : Math.min(100, (answered / expected) * 100);

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
        </div>
        <div className="header-tools">
          {session.profileName && (
            <span className="profile-chip" title="Perfil guardado en este dispositivo">
              Perfil local · {session.profileName}
            </span>
          )}
          {session.phase !== "intro" && (
            <div className="clock-cluster">
              <div
                className={`session-clock ${session.paused ? "paused" : ""}`}
                aria-label={`Tiempo activo de sesión ${formatTime(session.activeSecondsTotal)}`}
              >
                <span className="clock-dot" aria-hidden="true" />
                <div>
                  <small>{session.paused ? "Contador pausado" : "Tiempo activo"}</small>
                  <strong>{formatTime(session.activeSecondsTotal)}</strong>
                </div>
              </div>
              {session.phase !== "results" && (
                <button className="pause-button" type="button" onClick={onTogglePause} title="Atajo de teclado: P">
                  {session.paused ? "Reanudar" : "Pausar"}
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {session.phase !== "intro" && (
        <div className="progress-wrap">
          <div
            className="progress-line"
            role="progressbar"
            aria-label="Progreso aproximado del recorrido"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <small>{answered} de aproximadamente {expected} preguntas</small>
        </div>
      )}
    </>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const dark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-pressed={dark}
      onClick={onToggle}
      title={dark ? "Tema claro" : "Tema oscuro"}
    >
      <span className={`theme-toggle-icon ${dark ? "is-dark" : ""}`} aria-hidden="true">
        {dark ? "☀" : "☾"}
      </span>
      <span>{dark ? "Claro" : "Oscuro"}</span>
    </button>
  );
}

function JourneyCard({ phase }: { phase: DiagnosticPhase }) {
  const position =
    phase === "essential" || phase === "interest" || phase === "intro"
      ? 1
      : phase === "select-applied" || phase === "applied"
        ? 2
        : 3;
  return (
    <aside className="journey-card">
      <span className="eyebrow">Tu recorrido</span>
      <h3>Una ruta amplia primero; profundidad después.</h3>
      <p>
        La aplicación combina conocimiento, confianza e interés. El tiempo solo aporta
        contexto y nunca resta puntaje.
      </p>
      <ol className="journey-steps">
        {[
          ["Mapa esencial", "52 o 104 preguntas base"],
          ["Aplicación", "Hasta cuatro áreas · 4 u 8 por área"],
          ["Profundización", "Hasta dos candidatas · 4 u 8 por área"],
        ].map(([title, detail], index) => (
          <li className={position === index + 1 ? "current" : position > index + 1 ? "done" : ""} key={title}>
            <span>{position > index + 1 ? "✓" : `0${index + 1}`}</span>
            <div>
              <strong>{title}</strong>
              <small>{detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="timer-note">
        <span aria-hidden="true">↗</span>
        <p>
          <strong>Sin límite de tiempo.</strong>
          El contador se detiene al pausar o cambiar de pestaña. Interprétalo como una pista,
          no como una competencia de velocidad.
        </p>
      </div>
    </aside>
  );
}

function ViewTabs({
  activeTab,
  answered,
  onChange,
}: {
  activeTab: ViewTab;
  answered: number;
  onChange: (tab: ViewTab) => void;
}) {
  return (
    <div className="view-tabs" role="tablist" aria-label="Vistas del diagnóstico">
      <button
        className={`view-tab ${activeTab === "journey" ? "active" : ""}`}
        id="journey-tab"
        role="tab"
        aria-controls="journey-panel"
        aria-selected={activeTab === "journey"}
        type="button"
        onClick={() => onChange("journey")}
      >
        <span className="view-tab-icon" aria-hidden="true">↗</span>
        <span>Recorrido</span>
        <small>Responder y avanzar</small>
      </button>
      <button
        className={`view-tab ${activeTab === "results" ? "active" : ""}`}
        id="results-tab"
        role="tab"
        aria-controls="results-panel"
        aria-selected={activeTab === "results"}
        type="button"
        onClick={() => onChange("results")}
      >
        <span className="view-tab-icon" aria-hidden="true">◒</span>
        <span>Resultados</span>
        <small>{answered > 0 ? `${answered} respuestas disponibles` : "Vista parcial disponible"}</small>
      </button>
    </div>
  );
}

function IntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="intro-layout">
      <section className="intro-card">
        <span className="intro-kicker">13 áreas · 3 niveles · 312 preguntas en el banco v2</span>
        <h2>No necesitas responderlo todo para obtener un perfil útil.</h2>
        <p className="intro-lead">
          Primero elegirás una ruta. Tus respuestas, tu confianza y lo que te interese decidirán
          qué módulos conviene explorar después, sin convertir el tiempo en una penalización.
        </p>
        <div className="route-overview">
          <article>
            <span>01</span>
            <strong>Mapa general</strong>
            <p>52 preguntas esenciales y una breve valoración de interés por área.</p>
          </article>
          <article>
            <span>02</span>
            <strong>Aplicación</strong>
            <p>La app propone hasta cuatro áreas; tú conservas la decisión final.</p>
          </article>
          <article>
            <span>03</span>
            <strong>Profundización</strong>
            <p>Dos candidatas para orientar aprendizaje, proyecto o titulación.</p>
          </article>
        </div>
        <div className="intro-callout">
          <strong>Responde sin consultar material.</strong>
          <p>
            Si no sabes, elige una alternativa y marca “Al azar”. Puedes pausar entre áreas;
            el avance queda guardado en este dispositivo.
          </p>
        </div>
        <button className="button-primary button-large" type="button" onClick={onStart}>
          Comenzar el mapa esencial <span aria-hidden="true">→</span>
        </button>
      </section>
      <aside className="principles-card">
        <span className="eyebrow">Qué obtendrás</span>
        <h3>Un mapa, no una nota única.</h3>
        <ul>
          <li><span>01</span><p><strong>Dominio por área</strong>Separado por nivel de dificultad.</p></li>
          <li><span>02</span><p><strong>Confianza calibrada</strong>Aciertos casuales e ideas incorrectas seguras.</p></li>
          <li><span>03</span><p><strong>Interés explícito</strong>Problemas que disfrutas y proyectos que considerarías.</p></li>
          <li><span>04</span><p><strong>Tiempo contextual</strong>Tiempo activo por pregunta, sin penalización.</p></li>
        </ul>
      </aside>
    </div>
  );
}

function ProfileScreen({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="profile-layout">
      <section className="profile-card">
        <span className="intro-kicker">Tu diagnóstico, guardado localmente</span>
        <h2>Antes de comenzar, crea tu perfil.</h2>
        <p className="intro-lead">
          Usaremos este nombre para identificar tu avance y tus resultados en este navegador.
          No se envía a ningún servidor.
        </p>
        <form
          className="profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <label htmlFor="profile-name">¿Cómo quieres que te llamemos?</label>
          <input
            id="profile-name"
            maxLength={60}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Por ejemplo, Diego"
            required
            value={value}
          />
          <button className="button-primary button-large" type="submit" disabled={!value.trim()}>
            Guardar perfil y continuar <span aria-hidden="true">→</span>
          </button>
        </form>
        <p className="profile-note">Puedes borrar el avance completo desde la pantalla de resultados.</p>
      </section>
    </div>
  );
}

function RouteModeScreen({
  selectedMode,
  focusedAreas,
  onSelectMode,
  onToggleFocusedArea,
  onStart,
}: {
  selectedMode: Exclude<DiagnosticSessionState["routeMode"], null>;
  focusedAreas: string[];
  onSelectMode: (mode: Exclude<DiagnosticSessionState["routeMode"], null>) => void;
  onToggleFocusedArea: (areaId: string) => void;
  onStart: () => void;
}) {
  const routeCards: Array<{
    mode: Exclude<DiagnosticSessionState["routeMode"], null>;
    label: string;
    title: string;
    detail: string;
    count: string;
  }> = [
    {
      mode: "panorama",
      label: "Ruta 1 · Panorámica",
      title: "Conocer todas las áreas",
      detail: "Una señal esencial por área para construir una vista amplia.",
      count: "52 preguntas",
    },
    {
      mode: "recommended",
      label: "Ruta 2 · Recomendada",
      title: "Mapa + evidencia adaptativa",
      detail: "Fundamentos de todas las áreas y profundización guiada por tus respuestas.",
      count: "76–114 preguntas",
    },
    {
      mode: "deep",
      label: "Ruta 3 · Profunda",
      title: "Explorar con más detalle",
      detail: "Ocho preguntas por nivel y área seleccionada para un diagnóstico más estable.",
      count: "152 preguntas base",
    },
    {
      mode: "focused",
      label: "Enfoque manual",
      title: "Ir directo a mis áreas",
      detail: "Selecciona de una a tres áreas y responde sus tres niveles.",
      count: "24 por área",
    },
  ];

  return (
    <div className="route-select-layout">
      <section className="route-select-card">
        <span className="intro-kicker">Banco v2 · 13 áreas · 24 preguntas por área</span>
        <h2>Elige una ruta que puedas responder con atención.</h2>
        <p className="intro-lead">
          Las rutas no son notas distintas: cambian la cantidad de evidencia y el tiempo que invertirás.
          El contador es contextual y nunca modifica tu puntaje.
        </p>
        <div className="route-mode-grid">
          {routeCards.map((card) => (
            <button
              className={`route-mode-card ${selectedMode === card.mode ? "selected" : ""}`}
              type="button"
              key={card.mode}
              aria-pressed={selectedMode === card.mode}
              onClick={() => onSelectMode(card.mode)}
            >
              <span className="route-mode-label">{card.label}</span>
              <strong>{card.title}</strong>
              <p>{card.detail}</p>
              <small>{card.count}</small>
            </button>
          ))}
        </div>
        {selectedMode === "focused" && (
          <div className="focused-area-picker">
            <div>
              <span className="eyebrow">Áreas para el enfoque</span>
              <p>Selecciona entre 1 y 3 áreas. Podrás cambiar la selección al comenzar una nueva sesión.</p>
            </div>
            <div className="focus-area-grid">
              {diagnosticAreas.map((area) => {
                const selected = focusedAreas.includes(area.id);
                return (
                  <button
                    type="button"
                    className={`focus-area-chip ${selected ? "selected" : ""}`}
                    key={area.id}
                    aria-pressed={selected}
                    onClick={() => onToggleFocusedArea(area.id)}
                  >
                    <span>{String(area.number).padStart(2, "0")}</span>{area.name}
                  </button>
                );
              })}
            </div>
            <small>{focusedAreas.length} de 3 áreas seleccionadas</small>
          </div>
        )}
        <footer className="route-select-actions">
          <p>{selectedMode === "focused" && focusedAreas.length === 0 ? "Selecciona al menos un área para continuar." : "Puedes pausar y retomar la sesión en cualquier momento."}</p>
          <button className="button-primary button-large" type="button" disabled={selectedMode === "focused" && focusedAreas.length === 0} onClick={onStart}>
            Comenzar esta ruta <span aria-hidden="true">→</span>
          </button>
        </footer>
      </section>
      <aside className="principles-card route-principles-card">
        <span className="eyebrow">Cómo leer las rutas</span>
        <h3>Más preguntas no significa una nota “más verdadera”.</h3>
        <ul>
          <li><span>01</span><p><strong>Panorámica</strong>Sirve para descubrir dónde vale la pena mirar.</p></li>
          <li><span>02</span><p><strong>Recomendada</strong>Añade comprobaciones cuando una señal queda ambigua.</p></li>
          <li><span>03</span><p><strong>Profunda</strong>Reduce el azar con más evidencia por nivel.</p></li>
          <li><span>04</span><p><strong>Enfoque</strong>Útil si ya tienes una hipótesis de especialización.</p></li>
        </ul>
      </aside>
    </div>
  );
}

function QuestionScreen({
  question,
  questionSeconds,
  previousAnswerSeconds,
  selectedOption,
  confidence,
  paused,
  phaseQuestions,
  optionOrder,
  isConfirmation,
  onSelectOption,
  onSelectConfidence,
}: {
  question: DiagnosticQuestion;
  questionSeconds: number;
  previousAnswerSeconds: number | null;
  selectedOption: DiagnosticOptionKey | null;
  confidence: AnswerConfidence | null;
  paused: boolean;
  phaseQuestions: DiagnosticQuestion[];
  optionOrder?: DiagnosticOptionKey[];
  isConfirmation?: boolean;
  onSelectOption: (option: DiagnosticOptionKey) => void;
  onSelectConfidence: (confidence: AnswerConfidence) => void;
}) {
  const index = phaseQuestions.findIndex((item) => item.id === question.id);
  const areaIndex =
    phaseQuestions.filter((item) => item.areaId === question.areaId).findIndex((item) => item.id === question.id) + 1;
  const orderedOptions = optionOrder?.length
    ? optionOrder.flatMap((key) => question.options.find((option) => option.key === key) ?? [])
    : question.options;

  return (
    <div className="content-grid">
      <article className="question-card">
        <div className="question-meta">
          <div>
            <span className="level-pill">{isConfirmation ? "Comprobación · " : ""}{levelLabels[question.level]}</span>
            <span className="question-id">{question.id}</span>
          </div>
          <div className="question-time">
            <div>
              <small>{paused ? "Pausada" : "En esta pregunta"}</small>
              <strong>{formatTime(questionSeconds)}</strong>
            </div>
            <div className="previous-question-time">
              <small>Respuesta anterior</small>
              <strong>{previousAnswerSeconds === null ? "—" : formatTime(previousAnswerSeconds)}</strong>
            </div>
          </div>
        </div>

        <div className="question-position">
          <p className="area-name">{question.areaNumber}. {question.areaName}</p>
          <span>Pregunta {areaIndex} de {phaseQuestions.filter((item) => item.areaId === question.areaId).length} · {index + 1} de {phaseQuestions.length} en esta pasada</span>
        </div>
        <h2><InlineMarkdown text={question.stem} /></h2>

        <fieldset className="answers" disabled={paused}>
          <legend className="sr-only">Selecciona una respuesta</legend>
          {orderedOptions.map((option) => (
            <label className={selectedOption === option.key ? "selected" : ""} key={option.key}>
              <input
                checked={selectedOption === option.key}
                name={`answer-${question.id}`}
                onChange={() => onSelectOption(option.key)}
                type="radio"
                value={option.key}
              />
              <span>{option.key}</span>
              <p><InlineMarkdown text={option.text} /></p>
              <i aria-hidden="true" />
            </label>
          ))}
        </fieldset>

        <fieldset className="confidence-row" disabled={paused}>
          <legend>
            <span>¿Qué confianza tienes en tu respuesta?</span>
            <small>No cambia el puntaje; mejora la interpretación.</small>
          </legend>
          <div className="confidence-options">
            {(Object.keys(confidenceLabels) as AnswerConfidence[]).map((value) => (
              <button
                className={confidence === value ? "selected" : ""}
                key={value}
                type="button"
                onClick={() => onSelectConfidence(value)}
                aria-pressed={confidence === value}
                title={confidenceLabels[value].hint}
              >
                {confidenceLabels[value].label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="shortcut-hint" role="note">
          Atajos: <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd>/<kbd>4</kbd> o <kbd>A</kbd>/<kbd>B</kbd>/<kbd>C</kbd>/<kbd>D</kbd> para responder · <kbd>Q</kbd>/<kbd>G</kbd> al azar · <kbd>W</kbd>/<kbd>D</kbd> dudoso · <kbd>E</kbd>/<kbd>S</kbd> seguro · <kbd>P</kbd> pausar/reanudar.
        </p>

        <footer className="card-actions">
          <p>Al elegir una alternativa y tu nivel de confianza, la respuesta se guarda y avanzas automáticamente. {question.itemType === "graded-judgment" ? "Este escenario admite crédito parcial según la calidad de la decisión." : "La explicación aparecerá al terminar tu recorrido."}</p>
        </footer>
      </article>
      <JourneyCard phase={question.level === "essential" ? "essential" : question.level === "applied" ? "applied" : "deepening"} />
    </div>
  );
}

type InterestDraft = {
  enjoyed: InterestScore | null;
  learnMore: InterestScore | null;
  projectInterest: InterestScore | null;
};

function LikertRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: InterestScore | null;
  onChange: (value: InterestScore) => void;
}) {
  return (
    <fieldset className="likert-row">
      <legend>{label}</legend>
      <div>
        <small>Poco</small>
        {([1, 2, 3, 4, 5] as InterestScore[]).map((score) => (
          <button
            className={value === score ? "selected" : ""}
            type="button"
            key={score}
            aria-pressed={value === score}
            onClick={() => onChange(score)}
          >
            {score}
          </button>
        ))}
        <small>Mucho</small>
      </div>
    </fieldset>
  );
}

function InterestScreen({
  areaName,
  draft,
  completedAreas,
  totalAreas,
  onChange,
  onSubmit,
}: {
  areaName: string;
  draft: InterestDraft;
  completedAreas: number;
  totalAreas: number;
  onChange: (field: keyof InterestDraft, value: InterestScore) => void;
  onSubmit: () => void;
}) {
  const complete = Object.values(draft).every(Boolean);
  return (
    <div className="focus-layout">
      <section className="interest-card">
        <span className="level-pill">Área esencial completada · {completedAreas} de {totalAreas}</span>
        <h2>{areaName}</h2>
        <p>
          Valora tu interés antes de seguir. No buscamos premiar una respuesta: queremos
          separar lo que ya manejas de lo que genuinamente te gustaría explorar.
        </p>
        <div className="likert-stack">
          <LikertRow label="Disfruté el tipo de problemas de esta área." value={draft.enjoyed} onChange={(value) => onChange("enjoyed", value)} />
          <LikertRow label="Me gustaría aprender más, aunque todavía no la domine." value={draft.learnMore} onChange={(value) => onChange("learnMore", value)} />
          <LikertRow label="Consideraría desarrollar un proyecto relacionado." value={draft.projectInterest} onChange={(value) => onChange("projectInterest", value)} />
        </div>
        <footer className="card-actions">
          <p>1 significa “muy poco” y 5 significa “mucho”.</p>
          <button className="button-primary" disabled={!complete} type="button" onClick={onSubmit}>
            Guardar interés y seguir <span aria-hidden="true">→</span>
          </button>
        </footer>
      </section>
      <JourneyCard phase="interest" />
    </div>
  );
}

function AreaSelectionScreen({
  kind,
  session,
  selected,
  suggestionIds,
  suggestionReasons,
  availableAreaIds,
  onToggle,
  onContinue,
}: {
  kind: "applied" | "deepening";
  session: DiagnosticSessionState;
  selected: string[];
  suggestionIds: string[];
  suggestionReasons: Record<string, string[]>;
  availableAreaIds: string[];
  onToggle: (areaId: string) => void;
  onContinue: () => void;
}) {
  const limit = kind === "applied" ? 4 : 2;
  const metrics = calculateMetricsByArea(toScoringResponses(session), allAreaIds);
  const metricMap = new Map(metrics.map((metric) => [metric.areaId, metric]));
  const available = diagnosticAreas.filter((area) => availableAreaIds.includes(area.id));

  return (
    <section className="selection-card">
      <div className="selection-intro">
        <div>
          <span className="level-pill">
            {kind === "applied" ? "Elige entre 1 y 4 áreas" : "Elige entre 1 y 2 áreas"}
          </span>
          <h2>{kind === "applied" ? "Tu segunda pasada" : "Tus candidatas finales"}</h2>
        </div>
        <p>
          {kind === "applied"
            ? "Preseleccionamos cuatro señales combinando fundamentos, interés e incertidumbre. Puedes cambiarlas."
            : "Priorizamos desempeño aplicado e interés. Elige dónde quieres enfrentar decisiones más complejas."}
        </p>
      </div>
      <div className="selection-summary" role="status">
        <span><strong>{selected.length}</strong> de {limit} seleccionadas</span>
        <small>“Sugerida” significa pertinente para medir mejor, no necesariamente que ya la domines.</small>
      </div>
      <div className="area-choice-grid">
        {available.map((area) => {
          const metric = metricMap.get(area.id);
          const baseMetric = kind === "applied" ? metric?.byLevel.essential : metric?.byLevel.applied;
          const interest = getInterestAverage(session, area.id);
          const isSelected = selected.includes(area.id);
          const suggested = suggestionIds.includes(area.id);
          return (
            <button
              className={`area-choice ${isSelected ? "selected" : ""}`}
              key={area.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(area.id)}
              disabled={!isSelected && selected.length >= limit}
            >
              <span className="area-choice-number">{String(area.number).padStart(2, "0")}</span>
              <div>
                <p>{area.name}</p>
                <small>
                  {kind === "applied" ? "Esencial" : "Aplicado"}: {baseMetric?.scorePercent === null || baseMetric?.scorePercent === undefined ? "NE" : `${Math.round(baseMetric.scorePercent)}%`} · Interés {interest?.toFixed(1) ?? "NE"}/5
                </small>
                {suggested && <em>{suggestionReasons[area.id]?.join(" · ") || "Sugerida"}</em>}
              </div>
              <i>{isSelected ? "✓" : suggested ? "Sugerida" : "+"}</i>
            </button>
          );
        })}
      </div>
      <footer className="selection-actions">
        <div className="timer-note compact">
          <span aria-hidden="true">i</span>
          <p>Tu elección siempre prevalece sobre la sugerencia automática.</p>
        </div>
        <button className="button-primary" disabled={selected.length < 1} type="button" onClick={onContinue}>
          Continuar con {selected.length} {selected.length === 1 ? "área" : "áreas"} <span aria-hidden="true">→</span>
        </button>
      </footer>
    </section>
  );
}

type ConfidenceKey = AnswerConfidence;

const confidenceChartLabels: Record<ConfidenceKey, string> = {
  guess: "Al azar",
  unsure: "Dudoso",
  sure: "Seguro",
};

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "NE" : `${Math.round(value)}%`;
}

function medianNumber(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function percentile(values: number[], fraction: number) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.round((ordered.length - 1) * fraction)));
  return ordered[index];
}

function pearsonCorrelation(values: Array<[number, number]>) {
  if (values.length < 3) return null;
  const meanX = values.reduce((sum, [x]) => sum + x, 0) / values.length;
  const meanY = values.reduce((sum, [, y]) => sum + y, 0) / values.length;
  const numerator = values.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
  const denominatorX = Math.sqrt(values.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0));
  const denominatorY = Math.sqrt(values.reduce((sum, [, y]) => sum + (y - meanY) ** 2, 0));
  if (!denominatorX || !denominatorY) return null;
  return numerator / (denominatorX * denominatorY);
}

function DomainInterestPlot({
  profiles,
  selectedAreaId,
  onSelect,
}: {
  profiles: ReturnType<typeof classifyAreaProfiles>;
  selectedAreaId: string | null;
  onSelect: (areaId: string) => void;
}) {
  const chartProfiles = profiles.filter((profile) => profile.answered > 0);
  const left = 64;
  const top = 28;
  const width = 600;
  const height = 238;
  const x = (interest: number) => left + ((interest - 1) / 4) * width;
  const y = (domain: number) => top + (1 - domain / 100) * height;

  return (
    <section className="chart-panel scatter-panel">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">Gráfico 01 · Perfil</span>
          <h3>Dominio e interés por área</h3>
        </div>
        <p>La esquina superior derecha reúne las candidatas más equilibradas. Selecciona un punto para ver el detalle; el dominio usa puntaje ponderado.</p>
      </div>
      {chartProfiles.length === 0 ? (
        <div className="chart-empty">Completa al menos una respuesta para comenzar a formar este mapa.</div>
      ) : (
        <>
          <div className="scatter-wrap">
            <svg
              className="scatter-chart"
              role="img"
              aria-labelledby="scatter-title scatter-description"
              viewBox="0 0 700 320"
            >
              <title id="scatter-title">Dominio e interés por área</title>
              <desc id="scatter-description">Cada punto representa un área respondida. El eje horizontal muestra interés de uno a cinco y el eje vertical el porcentaje de puntaje ponderado.</desc>
              <rect className="chart-frame" data-chart-frame="true" x={left} y={top} width={width} height={height} rx="2" />
              {[0, 25, 50, 75, 100].map((tick) => (
                <g key={tick}>
                  <line className="chart-grid-line" x1={left} x2={left + width} y1={y(tick)} y2={y(tick)} />
                  <text className="chart-tick" x={left - 11} y={y(tick) + 4} textAnchor="end">{tick}%</text>
                </g>
              ))}
              {[1, 2, 3, 4, 5].map((tick) => (
                <text className="chart-tick" key={tick} x={x(tick)} y={top + height + 22} textAnchor="middle">{tick}</text>
              ))}
              <line className="chart-threshold" x1={x(4)} x2={x(4)} y1={top} y2={top + height} />
              <line className="chart-threshold" x1={left} x2={left + width} y1={y(60)} y2={y(60)} />
              <text className="chart-axis-title" data-axis="x" x={left + width / 2} y={top + height + 45} textAnchor="middle">Interés promedio (1–5)</text>
              <text className="chart-axis-title" data-axis="y" transform={`translate(16 ${top + height / 2}) rotate(-90)`} textAnchor="middle">Dominio (% puntaje)</text>
              {chartProfiles.map((profile) => {
                const selected = profile.areaId === selectedAreaId;
                return (
                  <g key={profile.areaId} className={`plot-point ${selected ? "selected" : ""}`}>
                    <circle
                      cx={x(profile.interestAverage)}
                      cy={y(profile.domainPercent)}
                      r={selected ? 9 : 7}
                      tabIndex={0}
                      role="button"
                      aria-label={`${profile.areaName}: ${profile.domainPercent}% de dominio, interés ${profile.interestAverage.toFixed(1)} de 5`}
                      data-tooltip={`${profile.areaName} · ${profile.domainPercent}% dominio · ${profile.interestAverage.toFixed(1)}/5 interés`}
                      onClick={() => onSelect(profile.areaId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(profile.areaId);
                        }
                      }}
                    >
                      <title>{profile.areaName}</title>
                    </circle>
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="plot-legend" aria-label="Referencias del gráfico">
            <span><i className="legend-dot" /> Área respondida</span>
            <span><i className="legend-line" /> Umbral orientativo: 60% dominio / 4 interés</span>
          </div>
          {selectedAreaId && (() => {
            const selected = profiles.find((profile) => profile.areaId === selectedAreaId);
            if (!selected) return null;
            return (
              <div className="plot-detail" aria-live="polite">
                <strong>{selected.areaName}</strong>
                <span>Dominio {selected.domainPercent}%</span>
                <span>Interés {selected.interestAverage.toFixed(1)}/5</span>
                <span>{quadrantLabel(selected.quadrant)}</span>
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}

function quadrantLabel(quadrant: ReturnType<typeof classifyAreaProfiles>[number]["quadrant"]) {
  return {
    "strength-and-interest": "dominio e interés altos",
    "learning-opportunity": "interés alto, base por reforzar",
    "strength-for-support": "fortaleza útil como apoyo",
    "lower-priority": "menor prioridad actual",
  }[quadrant];
}

function LevelBarChart({
  profiles,
  metrics,
  selectedAreaId,
  onSelect,
}: {
  profiles: ReturnType<typeof classifyAreaProfiles>;
  metrics: ReturnType<typeof calculateMetricsByArea>;
  selectedAreaId: string | null;
  onSelect: (areaId: string) => void;
}) {
  const metricMap = new Map(metrics.map((metric) => [metric.areaId, metric]));
  const items = profiles
    .filter((profile) => profile.answered > 0)
    .sort((left, right) => right.domainPercent - left.domainPercent);
  return (
    <section className="chart-panel level-panel">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">Gráfico 02 · Progresión</span>
          <h3>Desempeño por nivel</h3>
        </div>
        <p>Las barras muestran correctas dentro de cada nivel evaluado; una barra ausente significa NE.</p>
      </div>
      {items.length === 0 ? <div className="chart-empty">Todavía no hay niveles respondidos.</div> : (
        <>
          <div className="level-legend" aria-label="Niveles"><span><i className="level-swatch essential" />Esencial</span><span><i className="level-swatch applied" />Aplicado</span><span><i className="level-swatch deepening" />Profundización</span></div>
          <div className="level-bars" aria-label="Comparación de desempeño por área">
            {items.map((profile) => {
              const metric = metricMap.get(profile.areaId)!;
              const selected = selectedAreaId === profile.areaId;
              return (
                <button className={`level-bar-row ${selected ? "selected" : ""}`} type="button" aria-pressed={selected} key={profile.areaId} onClick={() => onSelect(profile.areaId)}>
                  <span className="level-bar-label">{profile.areaName}</span>
                  <span className="level-bar-track" aria-label={`${profile.areaName}: esencial ${formatPercent(metric.byLevel.essential.scorePercent)}, aplicado ${formatPercent(metric.byLevel.applied.scorePercent)}, profundización ${formatPercent(metric.byLevel.deepening.scorePercent)}`}>
                    <i className="level-segment essential" style={{ width: `${metric.byLevel.essential.scorePercent ?? 0}%` }} />
                    <i className="level-segment applied" style={{ width: `${metric.byLevel.applied.scorePercent ?? 0}%` }} />
                    <i className="level-segment deepening" style={{ width: `${metric.byLevel.deepening.scorePercent ?? 0}%` }} />
                  </span>
                  <em>{profile.domainPercent}%</em>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ConfidenceChart({
  session,
  selectedConfidence,
  onSelect,
}: {
  session: DiagnosticSessionState;
  selectedConfidence: ConfidenceKey | null;
  onSelect: (confidence: ConfidenceKey | null) => void;
}) {
  const rows = (Object.keys(confidenceChartLabels) as ConfidenceKey[]).map((key) => {
    const responses = Object.values(session.responses).filter((response) => response.confidence === key);
    const correct = responses.filter((response) => response.correct).length;
    const earned = responses.reduce((sum, response) => sum + response.awardedPoints, 0);
    const possible = responses.reduce((sum, response) => sum + response.maxPoints, 0);
    const times = responses.map((response) => response.activeSeconds);
    return {
      key,
      count: responses.length,
      correct,
      accuracy: responses.length ? (correct / responses.length) * 100 : null,
      score: possible ? (earned / possible) * 100 : null,
      earned,
      possible,
      medianTime: medianNumber(times),
    };
  });
  const max = Math.max(1, ...rows.map((row) => row.count));
  const selected = rows.find((row) => row.key === selectedConfidence) ?? null;
  return (
    <section className="chart-panel confidence-panel">
      <div className="chart-heading">
        <div>
          <span className="eyebrow">Gráfico 03 · Calibración</span>
          <h3>Confianza frente a aciertos</h3>
        </div>
        <p>Permite detectar si la seguridad que declaras coincide con tus resultados. Haz clic en una fila.</p>
      </div>
      <div className="confidence-chart" aria-label="Aciertos según confianza declarada">
        {rows.map((row) => (
          <button className={`confidence-chart-row ${selectedConfidence === row.key ? "selected" : ""}`} type="button" aria-pressed={selectedConfidence === row.key} key={row.key} onClick={() => onSelect(selectedConfidence === row.key ? null : row.key)}>
            <span className="confidence-chart-label">{confidenceChartLabels[row.key]}</span>
            <span className="confidence-chart-track" style={{ width: `${(row.count / max) * 100}%` }}>
              <i style={{ width: `${row.score ?? 0}%` }} />
            </span>
            <em>{row.count} · {formatPercent(row.score)}</em>
          </button>
        ))}
      </div>
      <div className="confidence-chart-legend"><span><i className="legend-box correct" />Puntaje ponderado dentro de cada grupo</span><span><i className="legend-box total" />Total de respuestas</span></div>
      {selected && (
        <p className="chart-callout" aria-live="polite"><strong>{confidenceChartLabels[selected.key]}:</strong> {selected.correct} de {selected.count} correctas · {selected.earned}/{selected.possible} puntos · mediana de {selected.medianTime === null ? "NE" : formatTime(selected.medianTime)} por respuesta.</p>
      )}
    </section>
  );
}

function SubcompetencyGrid({
  session,
  selectedAreaId,
  onSelectArea,
}: {
  session: DiagnosticSessionState;
  selectedAreaId: string | null;
  onSelectArea: (areaId: string) => void;
}) {
  const rows = diagnosticAreas.flatMap((area) => {
    const areaResponses = Object.values(session.responses).filter((response) => questionsById[response.questionId]?.areaId === area.id);
    const bySubcompetency = new Map<string, { earned: number; possible: number; count: number }>();
    for (const response of areaResponses) {
      const question = questionsById[response.questionId];
      if (!question) continue;
      const current = bySubcompetency.get(question.subcompetencyId) ?? { earned: 0, possible: 0, count: 0 };
      current.earned += response.awardedPoints;
      current.possible += response.maxPoints;
      current.count += 1;
      bySubcompetency.set(question.subcompetencyId, current);
    }
    return [...bySubcompetency.entries()].map(([subcompetencyId, value]) => ({
      area,
      subcompetencyId,
      ...value,
      score: value.possible ? (value.earned / value.possible) * 100 : null,
    }));
  }).filter((row) => row.count > 0);

  return (
    <section className="result-section subcompetency-section">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Lectura fina</span><h2>Subcompetencias observadas.</h2></div>
        <p>Cada área se divide en cuatro focos. Un foco con pocos ítems es una pista de revisión, no una conclusión definitiva.</p>
      </div>
      {rows.length === 0 ? <p className="empty-state">Aún no hay subcompetencias con respuestas.</p> : (
        <div className="subcompetency-grid">
          {rows.map((row) => (
            <button
              type="button"
              className={`subcompetency-card ${selectedAreaId === row.area.id ? "selected" : ""}`}
              key={`${row.area.id}-${row.subcompetencyId}`}
              onClick={() => onSelectArea(row.area.id)}
              aria-pressed={selectedAreaId === row.area.id}
            >
              <span>{row.area.name}</span>
              <strong>{row.subcompetencyId.replaceAll("-", " ")}</strong>
              <i><em style={{ width: `${row.score ?? 0}%` }} /></i>
              <small>{formatPercent(row.score)} · {row.count} {row.count === 1 ? "ítem" : "ítems"}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const quadrantCopy = {
  "strength-and-interest": {
    title: "Candidatos fuertes",
    subtitle: "Dominio e interés altos",
    className: "green",
  },
  "learning-opportunity": {
    title: "Oportunidades de aprendizaje",
    subtitle: "Interés alto, base por reforzar",
    className: "amber",
  },
  "strength-for-support": {
    title: "Fortalezas de apoyo",
    subtitle: "Buen dominio, menor interés",
    className: "blue",
  },
  "lower-priority": {
    title: "Menor prioridad",
    subtitle: "Por ahora, salvo que sea requisito",
    className: "gray",
  },
} as const;

function scoreCell(metric: ReturnType<typeof calculateMetricsByArea>[number]["byLevel"][DiagnosticLevel]) {
  return metric.total === 0
    ? <span className="ne">NE</span>
    : <strong>{metric.earnedPoints}/{metric.possiblePoints}</strong>;
}

function DerivedStats({
  session,
  profiles,
  overall,
}: {
  session: DiagnosticSessionState;
  profiles: ReturnType<typeof classifyAreaProfiles>;
  overall: ReturnType<typeof calculateOverallMetrics>;
}) {
  const expected = routeLength(session);
  const answered = Object.keys(session.responses).length;
  const times = Object.values(session.responses).map((response) => response.activeSeconds);
  const q1 = percentile(times, 0.25);
  const q3 = percentile(times, 0.75);
  const confidenceRows = (Object.keys(confidenceChartLabels) as ConfidenceKey[]).map((key) => {
    const responses = Object.values(session.responses).filter((response) => response.confidence === key);
    return {
      key,
      accuracy: responses.length ? (responses.filter((response) => response.correct).length / responses.length) * 100 : null,
      score: responses.length
        ? (responses.reduce((sum, response) => sum + response.awardedPoints, 0) / responses.reduce((sum, response) => sum + response.maxPoints, 0)) * 100
        : null,
    };
  });
  const sureAccuracy = confidenceRows.find((row) => row.key === "sure")?.score ?? null;
  const guessAccuracy = confidenceRows.find((row) => row.key === "guess")?.score ?? null;
  const paired = profiles
    .filter((profile) => profile.answered > 0 && profile.interestAverage !== 3)
    .map((profile) => [profile.interestAverage, profile.domainPercent] as [number, number]);
  const correlation = pearsonCorrelation(paired);
  const interestValues = profiles.filter((profile) => profile.answered > 0).map((profile) => profile.interestAverage);
  const interestLow = interestValues.length ? Math.min(...interestValues) : null;
  const interestHigh = interestValues.length ? Math.max(...interestValues) : null;
  const objectiveResponses = Object.values(session.responses).filter((response) => response.itemType === "single-best");
  const judgmentResponses = Object.values(session.responses).filter((response) => response.itemType !== "single-best");
  const judgmentScore = judgmentResponses.length
    ? (judgmentResponses.reduce((sum, response) => sum + response.awardedPoints, 0) / judgmentResponses.reduce((sum, response) => sum + response.maxPoints, 0)) * 100
    : null;
  const objectiveScore = objectiveResponses.length
    ? (objectiveResponses.reduce((sum, response) => sum + response.awardedPoints, 0) / objectiveResponses.reduce((sum, response) => sum + response.maxPoints, 0)) * 100
    : null;

  return (
    <section className="derived-section" aria-labelledby="derived-title">
      <div className="section-heading compact-heading">
        <div><span className="eyebrow">Estadísticas derivadas</span><h2 id="derived-title">Señales que ayudan a leer el resultado.</h2></div>
        <p>Son cálculos descriptivos del recorrido realizado, no una nota estandarizada ni una predicción sobre tu futuro desempeño.</p>
      </div>
      <div className="derived-grid">
        <article><span>Cobertura de ruta</span><strong>{expected ? Math.round((answered / expected) * 100) : 0}%</strong><p>{answered} de {expected} preguntas previstas en esta ruta.</p></article>
        <article><span>Rango central de tiempo</span><strong>{q1 === null || q3 === null ? "NE" : `${formatTime(q1)}–${formatTime(q3)}`}</strong><p>Entre el percentil 25 y 75 por respuesta.</p></article>
        <article><span>Interés observado</span><strong>{interestLow === null ? "NE" : `${interestLow.toFixed(1)}–${interestHigh?.toFixed(1)}`}</strong><p>Rango de promedios en áreas respondidas.</p></article>
        <article><span>Seguridad declarada</span><strong>{sureAccuracy === null ? "NE" : formatPercent(sureAccuracy)}</strong><p>{guessAccuracy === null ? "Aún sin grupo al azar." : `Al azar: ${formatPercent(guessAccuracy)}.`}</p></article>
        <article><span>Tipo de evidencia</span><strong>{objectiveScore === null ? "NE" : formatPercent(objectiveScore)}</strong><p>Objetiva: {objectiveResponses.length} · juicio aplicado: {judgmentScore === null ? "NE" : formatPercent(judgmentScore)} ({judgmentResponses.length}).</p></article>
        <article><span>Asociación exploratoria</span><strong>{correlation === null ? "NE" : `${correlation > 0 ? "+" : ""}${correlation.toFixed(2)}`}</strong><p>{correlation === null ? "Necesita al menos tres áreas con interés distinto." : "Relación lineal entre interés y dominio; no implica causalidad."}</p></article>
        <article><span>Tiempo total activo</span><strong>{formatTime(session.activeSecondsTotal)}</strong><p>Promedio por respuesta: {overall.averageActiveSeconds === null ? "NE" : formatTime(overall.averageActiveSeconds)}.</p></article>
      </div>
    </section>
  );
}

function ResultsScreen({
  session,
  history,
  onDownload,
  onReset,
  onContinue,
  partial,
}: {
  session: DiagnosticSessionState;
  history: DiagnosticAttemptRecord[];
  onDownload: () => void;
  onReset: () => void;
  onContinue: () => void;
  partial: boolean;
}) {
  const responses = toScoringResponses(session);
  const interests = toScoringInterests(session);
  const metrics = calculateMetricsByArea(responses, allAreaIds);
  const metricMap = new Map(metrics.map((metric) => [metric.areaId, metric]));
  const overall = calculateOverallMetrics(responses);
  const profiles = classifyAreaProfiles(allAreaIds, responses, interests, areaNames);
  const recommendations = buildRecommendations(profiles, 3);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(
    recommendations.projectCandidates[0]?.areaId ?? profiles.find((profile) => profile.answered > 0)?.areaId ?? null,
  );
  const [selectedConfidence, setSelectedConfidence] = useState<ConfidenceKey | null>(null);
  const wrongAnswers = Object.values(session.responses)
    .filter((response) => response.awardedPoints < response.maxPoints)
    .sort((a, b) => Number(b.confidence === "sure") - Number(a.confidence === "sure"));

  return (
    <div className="results-stack">
      <section className="results-hero">
        <div>
          <span className="level-pill">{partial ? "Vista parcial · " : "Ruta completada · "}{responses.length} respuestas analizadas</span>
          <h2>{partial ? "Tu perfil mientras avanzas" : recommendations.projectCandidates[0]?.areaName ?? "Tu perfil TIC"}</h2>
          <p>
            {partial
              ? "Puedes revisar estas señales ahora y volver al recorrido cuando quieras. Los resultados se actualizan después de cada respuesta."
              : recommendations.projectCandidates[0]?.message ?? "Usa estas señales para decidir qué probar con una actividad práctica breve."}
          </p>
        </div>
        <div className="result-actions">
          {partial && <button className="button-primary" type="button" onClick={onContinue}>Volver al recorrido</button>}
          <button className="button-primary" type="button" onClick={onDownload}>Descargar resultados</button>
          <button className="button-secondary" type="button" onClick={() => window.print()}>Imprimir</button>
        </div>
      </section>

      <section className="signal-grid" aria-label="Resumen del diagnóstico">
        <article><span>Respuestas correctas</span><strong>{overall.correct}<small>/{overall.total}</small></strong><p>{formatPercent(overall.accuracyPercent)} en el recorrido realizado</p></article>
        <article><span>Puntaje ponderado</span><strong>{formatPercent(overall.scorePercent)}</strong><p>{overall.earnedPoints} de {overall.possiblePoints} puntos; incluye crédito parcial.</p></article>
        <article><span>Errores seguros</span><strong>{overall.highConfidenceWrong}</strong><p>Prioridad de revisión conceptual</p></article>
        <article><span>Tiempo activo</span><strong>{formatTime(session.activeSecondsTotal)}</strong><p>Mediana por pregunta: {formatTime(overall.medianActiveSeconds ?? 0)}</p></article>
        <article><span>Áreas profundizadas</span><strong>{session.selectedAreas.deepening.length}</strong><p>De 13 áreas disponibles</p></article>
      </section>

      {history.length > 0 && (
        <section className="result-section history-section">
          <div className="section-heading compact-heading">
            <div><span className="eyebrow">Historial local</span><h2>Compara tus intentos anteriores.</h2></div>
            <p>Se guardan solo en este navegador para observar cambios; no son percentiles ni una certificación.</p>
          </div>
          <div className="history-list">
            {history.slice(0, 6).map((attempt) => {
              const attemptResponses = Object.values(attempt.responses);
              const earned = attemptResponses.reduce((sum, response) => sum + response.awardedPoints, 0);
              const possible = attemptResponses.reduce((sum, response) => sum + response.maxPoints, 0);
              return (
                <article className={`history-card ${attempt.id === session.sessionId ? "current" : ""}`} key={attempt.id}>
                  <div><strong>{attempt.id === session.sessionId ? "Intento actual" : "Intento guardado"}</strong><small>{new Date(attempt.completedAt).toLocaleString("es-CL")}</small></div>
                  <span>{attempt.routeMode ?? "ruta legacy"}</span>
                  <em>{earned}/{possible} puntos · {attempt.responseCount} respuestas</em>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <DerivedStats session={session} profiles={profiles} overall={overall} />

      <section className="charts-section" aria-label="Gráficos interactivos de resultados">
        <DomainInterestPlot profiles={profiles} selectedAreaId={selectedAreaId} onSelect={setSelectedAreaId} />
        <div className="chart-split">
          <LevelBarChart profiles={profiles} metrics={metrics} selectedAreaId={selectedAreaId} onSelect={setSelectedAreaId} />
          <ConfidenceChart session={session} selectedConfidence={selectedConfidence} onSelect={setSelectedConfidence} />
        </div>
      </section>

      <SubcompetencyGrid session={session} selectedAreaId={selectedAreaId} onSelectArea={setSelectedAreaId} />

      <section className="result-section">
        <div className="section-heading">
          <div><span className="eyebrow">Lectura conjunta</span><h2>Dominio e interés cuentan historias distintas.</h2></div>
          <p>Los umbrales son orientativos: 60% de dominio y 4/5 de interés. La cantidad de preguntas depende de la ruta y no constituye una certificación.</p>
        </div>
        <div className="quadrant-grid">
          {(Object.keys(quadrantCopy) as Array<keyof typeof quadrantCopy>).map((quadrant) => {
            const copy = quadrantCopy[quadrant];
            const items = profiles.filter((profile) => profile.quadrant === quadrant);
            return (
              <article className={`quadrant-card ${copy.className}`} key={quadrant}>
                <span>{copy.title}</span>
                <small>{copy.subtitle}</small>
                <ul>
                  {items.length > 0 ? items.map((profile) => (
                    <li key={profile.areaId}>
                      <strong>{profile.areaName}</strong>
                      <em>{profile.domainPercent}% · {profile.interestAverage.toFixed(1)}/5</em>
                    </li>
                  )) : <li className="empty">Ninguna área por ahora</li>}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      <section className="result-section">
        <div className="section-heading compact-heading">
          <div><span className="eyebrow">Detalle auditable</span><h2>Resultados por área y nivel</h2></div>
          <p>NE significa “no evaluado”; nunca se interpreta como cero. El tiempo se muestra como contexto, sin ajustar el puntaje.</p>
        </div>
        <div className="table-scroll">
          <table className="results-table">
            <thead><tr><th>Área</th><th>Esencial</th><th>Aplicado</th><th>Profundización</th><th>Interés</th><th>Errores seguros</th><th>Mediana</th></tr></thead>
            <tbody>
              {diagnosticAreas.map((area) => {
                const metric = metricMap.get(area.id)!;
                const interest = getInterestAverage(session, area.id);
                return (
                  <tr key={area.id}>
                    <th><span>{String(area.number).padStart(2, "0")}</span>{area.name}</th>
                    <td>{scoreCell(metric.byLevel.essential)}</td>
                    <td>{scoreCell(metric.byLevel.applied)}</td>
                    <td>{scoreCell(metric.byLevel.deepening)}</td>
                    <td>{interest ? `${interest.toFixed(1)}/5` : <span className="ne">NE</span>}</td>
                    <td className={metric.overall.highConfidenceWrong > 0 ? "attention" : ""}>{metric.overall.highConfidenceWrong}</td>
                    <td>{metric.overall.medianActiveSeconds === null ? <span className="ne">NE</span> : formatTime(metric.overall.medianActiveSeconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="result-section review-section">
        <div className="section-heading compact-heading">
          <div><span className="eyebrow">Revisión guiada</span><h2>Conceptos que conviene revisar</h2></div>
          <p>Las respuestas incorrectas marcadas como “Seguro” aparecen primero porque pueden revelar una idea equivocada estable.</p>
        </div>
        <div className="review-list">
          {wrongAnswers.length === 0 && <p className="empty-state">No hubo respuestas incorrectas en el recorrido realizado.</p>}
          {wrongAnswers.map((response) => {
            const question = questionsById[response.questionId];
            if (!question) return null;
            const selectedText = question.options.find((option) => option.key === response.selectedOption)?.text;
            return (
              <details className={response.confidence === "sure" ? "priority" : ""} key={response.questionId}>
                <summary>
                  <span>{question.id}</span>
                  <p>{question.areaName}</p>
                  <em>{confidenceLabels[response.confidence].label} · {formatTime(response.activeSeconds)}</em>
                </summary>
                <div>
                  <h3><InlineMarkdown text={question.stem} /></h3>
                  <p><strong>Elegiste {response.selectedOption} ({response.awardedPoints}/{response.maxPoints} puntos):</strong> <InlineMarkdown text={selectedText ?? ""} /></p>
                  <p className="correct-answer"><strong>Respuesta correcta {question.correctOption}:</strong> <InlineMarkdown text={question.options.find((option) => option.key === question.correctOption)?.text ?? ""} /></p>
                  <p><strong>Por qué:</strong> <InlineMarkdown text={question.explanation} /></p>
                  <small>Evalúa: <InlineMarkdown text={question.evaluates} /></small>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="next-step-card">
        <div>
          <span className="eyebrow">Siguiente decisión</span>
          <h2>Convierte la primera candidata en una prueba pequeña.</h2>
          <p>Define un problema real, un alcance mínimo y una evidencia que puedas obtener en pocas semanas. Usa tus fortalezas de apoyo para reducir el riesgo.</p>
        </div>
        <ol>
          {recommendations.projectCandidates.map((candidate, index) => (
            <li key={candidate.areaId}><span>0{index + 1}</span><div><strong>{candidate.areaName}</strong><small>{candidate.message}</small></div></li>
          ))}
        </ol>
      </section>

      <footer className="results-footer">
        <p>Este resultado es orientativo y depende de las preguntas respondidas, tu contexto y tu autoevaluación de interés.</p>
        <button className="text-button" type="button" onClick={onReset}>Borrar avance y comenzar de nuevo</button>
      </footer>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState<DiagnosticSessionState | null>(null);
  const [selectedOption, setSelectedOption] = useState<DiagnosticOptionKey | null>(null);
  const [confidence, setConfidence] = useState<AnswerConfidence | null>(null);
  const [questionSeconds, setQuestionSeconds] = useState(0);
  const [interestDraft, setInterestDraft] = useState<InterestDraft>({ enjoyed: null, learnMore: null, projectInterest: null });
  const [appliedDraft, setAppliedDraft] = useState<string[]>([]);
  const [deepeningDraft, setDeepeningDraft] = useState<string[]>([]);
  const [focusedDraft, setFocusedDraft] = useState<string[]>([]);
  const [routeModeDraft, setRouteModeDraft] = useState<Exclude<DiagnosticSessionState["routeMode"], null>>("recommended");
  const [attemptHistory, setAttemptHistory] = useState<DiagnosticAttemptRecord[]>([]);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [activeTab, setActiveTab] = useState<ViewTab>("journey");
  const themeLoadedRef = useRef(false);
  const startedAtRef = useRef(new Date().toISOString());
  const answerLockRef = useRef(false);
  const savedAttemptRef = useRef<string | null>(null);
  const answerSubmitRef = useRef<
    (option: DiagnosticOptionKey, answerConfidence: AnswerConfidence) => void
  >(() => undefined);

  useEffect(() => {
    const stored = loadSession(window.localStorage);
    const repaired = repairLoadedSession(stored ?? createInitialSession());
    const timeout = window.setTimeout(() => {
      setSession(repaired);
      setAttemptHistory(loadAttemptHistory(window.localStorage));
      setProfileNameDraft(repaired.profileName);
      setRouteModeDraft(repaired.routeMode ?? "recommended");
      setFocusedDraft(repaired.routeMode === "focused" ? repaired.selectedAreas.applied : []);
      if (repaired.phase === "results") setActiveTab("results");
      const restoredResponses = toScoringResponses(repaired);
      const restoredInterests = toScoringInterests(repaired);
      if (repaired.phase === "select-applied") {
        setAppliedDraft(
          repaired.selectedAreas.applied.length
            ? repaired.selectedAreas.applied
            : suggestAppliedAreas(allAreaIds, restoredResponses, restoredInterests, 4).map(
                (item) => item.areaId,
              ),
        );
      }
      if (repaired.phase === "select-deepening") {
        const available = repaired.selectedAreas.applied.length
          ? repaired.selectedAreas.applied
          : allAreaIds;
        setDeepeningDraft(
          repaired.selectedAreas.deepening.length
            ? repaired.selectedAreas.deepening
            : suggestDeepeningAreas(available, restoredResponses, restoredInterests, 2).map(
                (item) => item.areaId,
              ),
        );
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!session || session.phase !== "results" || savedAttemptRef.current === session.sessionId) return;
    const attempt = makeAttemptRecord(session);
    const nextHistory = appendAttemptHistory(window.localStorage, attempt);
    savedAttemptRef.current = session.sessionId;
    setAttemptHistory(nextHistory);
  }, [session]);

  useEffect(() => {
    if (session) saveSession(window.localStorage, session);
  }, [session]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      themeLoadedRef.current = true;
      setTheme(storedTheme === "dark" ? "dark" : "light");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (themeLoadedRef.current) {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

  const currentQuestion = session?.currentQuestionId
    ? questionsById[session.currentQuestionId]
    : null;

  const currentQuestionId = currentQuestion?.id;
  const currentPhase = session?.phase;
  const isPaused = session?.paused;

  useEffect(() => {
    if (!currentPhase || ["intro", "route-select", "results"].includes(currentPhase) || isPaused) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setSession((previous) => previous ? { ...previous, activeSecondsTotal: previous.activeSecondsTotal + 1, updatedAt: new Date().toISOString() } : previous);
      if (currentQuestionId) setQuestionSeconds((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [currentPhase, isPaused, currentQuestionId]);

  const scoringResponses = useMemo(() => session ? toScoringResponses(session) : [], [session]);
  const scoringInterests = useMemo(() => session ? toScoringInterests(session) : [], [session]);
  const appliedSuggestions = useMemo(
    () => suggestAppliedAreas(allAreaIds, scoringResponses, scoringInterests, 4),
    [scoringResponses, scoringInterests],
  );
  const deepeningAvailable = session?.selectedAreas.applied.length ? session.selectedAreas.applied : allAreaIds;
  const deepeningSuggestions = useMemo(
    () => suggestDeepeningAreas(deepeningAvailable, scoringResponses, scoringInterests, 2),
    [deepeningAvailable, scoringResponses, scoringInterests],
  );

  const prepareQuestion = () => {
    setSelectedOption(null);
    setConfidence(null);
    setQuestionSeconds(0);
    startedAtRef.current = new Date().toISOString();
  };

  const areaIdsForLevel = (state: DiagnosticSessionState, level: DiagnosticLevel) =>
    level === "essential"
      ? (state.routeMode === "focused" ? state.selectedAreas.applied : allAreaIds)
      : level === "applied" ? state.selectedAreas.applied : state.selectedAreas.deepening;

  const advanceAfterLevel = (
    state: DiagnosticSessionState,
    level: DiagnosticLevel,
    responses: DiagnosticSessionState["responses"],
    now: string,
    allowConfirmation = true,
  ): DiagnosticSessionState => {
    const mode = state.routeMode ?? "recommended";
    const areaIds = areaIdsForLevel(state, level);
    const confirmations = allowConfirmation && mode === "recommended"
      ? chooseConfirmations(level, areaIds, responses)
      : [];
    if (confirmations.length > 0) {
      const confirmationEntries = confirmations.map((question) => ({
        questionId: question.id,
        itemVersion: question.version,
        phase: level,
        areaId: question.areaId,
        reason: "Comprobación de una señal ambigua",
        isConfirmation: true,
      }));
      return {
        ...state,
        responses,
        routePlan: [...state.routePlan, ...confirmationEntries],
        confirmationIds: confirmations.map((question) => question.id),
        confirmationLevel: level,
        confirmationReturnPhase: level,
        phase: "confirmation",
        currentQuestionId: confirmations[0]?.id ?? null,
        updatedAt: now,
      };
    }

    if (level === "essential") {
      if (mode === "panorama") {
        setActiveTab("results");
        return { ...state, responses, phase: "results", currentQuestionId: null, updatedAt: now };
      }
      if (mode === "focused") {
        const appliedQuestions = phaseQuestionsForSession({ ...state, responses, phase: "applied" });
        const first = appliedQuestions[0];
        return { ...state, responses, phase: "applied", currentQuestionId: first?.id ?? null, updatedAt: now };
      }
      setAppliedDraft(
        suggestAppliedAreas(allAreaIds, toScoringResponses({ ...state, responses }), toScoringInterests(state), 4).map((item) => item.areaId),
      );
      return { ...state, responses, phase: "select-applied", currentQuestionId: null, updatedAt: now };
    }
    if (level === "applied") {
      if (mode === "focused") {
        const first = phaseQuestionsForSession({ ...state, responses, phase: "deepening" })[0];
        return { ...state, responses, phase: "deepening", currentQuestionId: first?.id ?? null, updatedAt: now };
      }
      const available = state.selectedAreas.applied.length ? state.selectedAreas.applied : allAreaIds;
      setDeepeningDraft(
        suggestDeepeningAreas(available, toScoringResponses({ ...state, responses }), toScoringInterests(state), 2).map((item) => item.areaId),
      );
      return { ...state, responses, phase: "select-deepening", currentQuestionId: null, updatedAt: now };
    }
    setActiveTab("results");
    return { ...state, responses, phase: "results", currentQuestionId: null, updatedAt: now };
  };

  const handleAnswer = (answerOption: DiagnosticOptionKey, answerConfidence: AnswerConfidence) => {
    if (!session || session.paused || !currentQuestion || answerLockRef.current) return;
    answerLockRef.current = true;
    const now = new Date().toISOString();
    const selected = currentQuestion.options.find((option) => option.key === answerOption);
    const maxPoints = Math.max(1, currentQuestion.maxPoints || 1);
    const awardedPoints = Math.min(maxPoints, Math.max(0, selected?.points ?? (answerOption === currentQuestion.correctOption ? maxPoints : 0)));
    const nextResponses = {
      ...session.responses,
      [currentQuestion.id]: {
        questionId: currentQuestion.id,
        selectedOption: answerOption,
        correct: awardedPoints >= maxPoints,
        awardedPoints,
        maxPoints,
        itemVersion: currentQuestion.version,
        bankVersion: currentQuestion.bankVersion,
        itemType: currentQuestion.itemType,
        optionOrder: stableOptionOrder(currentQuestion, `${session.sessionId}:${currentQuestion.id}`),
        confidence: answerConfidence,
        activeSeconds: questionSeconds,
        startedAt: startedAtRef.current,
        answeredAt: now,
      },
    };
    const phaseQuestions = session.phase === "confirmation"
      ? session.confirmationIds.flatMap((id) => (questionsById[id] ? [questionsById[id]] : []))
      : phaseQuestionsForSession(session);
    const index = phaseQuestions.findIndex((question) => question.id === currentQuestion.id);
    const next = phaseQuestions[index + 1] ?? null;
    let nextSession: DiagnosticSessionState;
    if (next) {
      const completedArea = session.phase === "essential" && next.areaId !== currentQuestion.areaId;
      if (completedArea) {
        nextSession = { ...session, responses: nextResponses, phase: "interest", currentQuestionId: null, updatedAt: now };
      } else {
        nextSession = { ...session, responses: nextResponses, currentQuestionId: next.id, updatedAt: now };
      }
    } else if (session.phase === "essential" && !session.interests[currentQuestion.areaId]) {
      nextSession = { ...session, responses: nextResponses, phase: "interest", currentQuestionId: null, updatedAt: now };
    } else if (session.phase === "confirmation") {
      const returnLevel = session.confirmationReturnPhase ?? currentQuestion.level;
      const cleared = { ...session, responses: nextResponses, confirmationIds: [], confirmationLevel: null, confirmationReturnPhase: null };
      nextSession = advanceAfterLevel(cleared, returnLevel, nextResponses, now, false);
    } else {
      nextSession = advanceAfterLevel(session, currentQuestion.level, nextResponses, now);
    }
    const currentRouteIndex = nextSession.routePlan.findIndex((entry) => entry.questionId === currentQuestion.id);
    nextSession = {
      ...nextSession,
      routeCursor: Math.max(session.routeCursor, currentRouteIndex >= 0 ? currentRouteIndex + 1 : session.routeCursor),
    };
    prepareQuestion();
    setSession(nextSession);
    window.setTimeout(() => {
      answerLockRef.current = false;
    }, 0);
  };

  useEffect(() => {
    answerSubmitRef.current = handleAnswer;
  });

  useEffect(() => {
    if (
      !currentPhase ||
      ["intro", "route-select", "results"].includes(currentPhase)
    ) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=\"true\"]")) return;

      const key = event.key.toLowerCase();
      if (key === "p") {
        event.preventDefault();
        setSession((previous) => previous ? {
          ...previous,
          paused: !previous.paused,
          updatedAt: new Date().toISOString(),
        } : previous);
        return;
      }

      if (isPaused) {
        event.preventDefault();
        return;
      }

      const optionByKey: Record<string, DiagnosticOptionKey> = {
        "1": "A",
        "2": "B",
        "3": "C",
        "4": "D",
        a: "A",
        b: "B",
        c: "C",
      };
      const confidenceByKey: Record<string, AnswerConfidence> = {
        q: "guess",
        g: "guess",
        w: "unsure",
        d: "unsure",
        e: "sure",
        s: "sure",
      };

      if (optionByKey[key]) {
        event.preventDefault();
        const nextOption = optionByKey[key];
        if (!currentQuestion?.options.some((option) => option.key === nextOption)) return;
        setSelectedOption(nextOption);
        if (confidence) answerSubmitRef.current(nextOption, confidence);
        return;
      }

      if (confidenceByKey[key]) {
        event.preventDefault();
        const nextConfidence = confidenceByKey[key];
        setConfidence(nextConfidence);
        if (selectedOption) answerSubmitRef.current(selectedOption, nextConfidence);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confidence, currentPhase, currentQuestion, isPaused, selectedOption]);

  if (!session) {
    return <main className="loading-screen"><span className="brand-mark">B</span><p>Preparando tu diagnóstico…</p></main>;
  }

  const handleProfileSubmit = () => {
    const profileName = profileNameDraft.trim();
    if (!profileName) return;
    setSession({ ...session, profileName, phase: "route-select", currentQuestionId: null, updatedAt: new Date().toISOString() });
  };

  const handleStart = () => {
    const mode = routeModeDraft;
    const focusIds = mode === "focused" ? focusedDraft : [];
    if (mode === "focused" && focusIds.length === 0) return;
    const selectedApplied = mode === "focused" ? focusIds : [];
    const selectedDeepening = mode === "focused" ? focusIds : [];
    const plan = routeBaseEntries(mode, selectedApplied, selectedDeepening);
    const first = plan[0] ? questionsById[plan[0].questionId] : null;
    if (!first) return;
    prepareQuestion();
    setSession({
      ...session,
      routeMode: mode,
      bankVersion: "v2-draft",
      routePlan: plan,
      routeCursor: 0,
      selectedAreas: { applied: selectedApplied, deepening: selectedDeepening },
      phase: "essential",
      currentQuestionId: first.id,
      responses: {},
      interests: {},
      confirmationIds: [],
      confirmationLevel: null,
      confirmationReturnPhase: null,
      activeSecondsTotal: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const handleRouteModeSelect = (mode: Exclude<DiagnosticSessionState["routeMode"], null>) => {
    setRouteModeDraft(mode);
    if (mode !== "focused") setFocusedDraft([]);
  };

  const toggleFocusedArea = (areaId: string) => {
    setFocusedDraft((current) => {
      if (current.includes(areaId)) return current.filter((id) => id !== areaId);
      return current.length < 3 ? [...current, areaId] : current;
    });
  };

  const handleOptionSelect = (option: DiagnosticOptionKey) => {
    if (session.paused) return;
    setSelectedOption(option);
    if (confidence) handleAnswer(option, confidence);
  };

  const handleConfidenceSelect = (value: AnswerConfidence) => {
    if (session.paused) return;
    setConfidence(value);
    if (selectedOption) handleAnswer(selectedOption, value);
  };

  const pendingInterest = findPendingInterestArea(session);
  const handleInterestSubmit = () => {
    if (!pendingInterest || !interestDraft.enjoyed || !interestDraft.learnMore || !interestDraft.projectInterest) return;
    const nextInterests = {
      ...session.interests,
      [pendingInterest.id]: {
        enjoyed: interestDraft.enjoyed,
        learnMore: interestDraft.learnMore,
        projectInterest: interestDraft.projectInterest,
        updatedAt: new Date().toISOString(),
      },
    };
    const next = nextUnanswered(phaseQuestionsForSession({ ...session, interests: nextInterests, phase: "essential" }), session.responses);
    let nextSession: DiagnosticSessionState = {
      ...session,
      interests: nextInterests,
      phase: next ? "essential" : "essential",
      currentQuestionId: next?.id ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (!next) {
      nextSession = advanceAfterLevel(nextSession, "essential", nextSession.responses, nextSession.updatedAt);
    }
    setInterestDraft({ enjoyed: null, learnMore: null, projectInterest: null });
    prepareQuestion();
    setSession(nextSession);
  };

  const toggleArea = (kind: "applied" | "deepening", areaId: string) => {
    const setter = kind === "applied" ? setAppliedDraft : setDeepeningDraft;
    const current = kind === "applied" ? appliedDraft : deepeningDraft;
    const limit = kind === "applied" ? 4 : 2;
    if (current.includes(areaId)) setter(current.filter((id) => id !== areaId));
    else if (current.length < limit) setter([...current, areaId]);
  };

  const confirmApplied = () => {
    const selected = diagnosticAreas.map((area) => area.id).filter((id) => appliedDraft.includes(id));
    const nextSession = { ...session, selectedAreas: { ...session.selectedAreas, applied: selected } };
    const first = phaseQuestionsForSession({ ...nextSession, phase: "applied" })[0];
    if (!first) return;
    prepareQuestion();
    const routePlan = session.routePlan.some((entry) => entry.phase === "applied")
      ? session.routePlan
      : [...session.routePlan, ...routeBaseEntries(session.routeMode ?? "recommended", selected, session.selectedAreas.deepening).filter((entry) => entry.phase === "applied")];
    setSession({ ...nextSession, routePlan, phase: "applied", currentQuestionId: first.id, updatedAt: new Date().toISOString() });
  };

  const confirmDeepening = () => {
    const selected = diagnosticAreas.map((area) => area.id).filter((id) => deepeningDraft.includes(id));
    const nextSession = { ...session, selectedAreas: { ...session.selectedAreas, deepening: selected } };
    const first = phaseQuestionsForSession({ ...nextSession, phase: "deepening" })[0];
    if (!first) return;
    prepareQuestion();
    const routePlan = session.routePlan.some((entry) => entry.phase === "deepening")
      ? session.routePlan
      : [...session.routePlan, ...routeBaseEntries(session.routeMode ?? "recommended", session.selectedAreas.applied, selected).filter((entry) => entry.phase === "deepening")];
    setSession({ ...nextSession, routePlan, phase: "deepening", currentQuestionId: first.id, updatedAt: new Date().toISOString() });
  };

  const handleDownload = () => {
    const profiles = classifyAreaProfiles(allAreaIds, scoringResponses, scoringInterests, areaNames);
    const metrics = calculateMetricsByArea(scoringResponses, allAreaIds);
    const payload = JSON.stringify({
      format: "brujula-tic-resultados",
      schemaVersion: 3,
      bankVersion: session.bankVersion,
      routeMode: session.routeMode,
      exportedAt: new Date().toISOString(),
      note: "El tiempo es contextual y no modifica el puntaje.",
      session,
      summary: { overall: calculateOverallMetrics(scoringResponses), metrics, profiles, recommendations: buildRecommendations(profiles, 3) },
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `brujula-tic-resultados-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    if (!window.confirm("¿Borrar todo el avance guardado y comenzar de nuevo?")) return;
    clearSession(window.localStorage);
    answerLockRef.current = false;
    prepareQuestion();
    setSession(createInitialSession());
    setAppliedDraft([]);
    setDeepeningDraft([]);
    setProfileNameDraft("");
    setActiveTab("journey");
  };

  const appliedSuggestionReasons = Object.fromEntries(
    appliedSuggestions.map((item) => [item.areaId, item.reasons]),
  );
  const deepeningSuggestionReasons = Object.fromEntries(
    deepeningSuggestions.map((item) => [item.areaId, item.reasons]),
  );
  const currentPhaseQuestions = currentQuestion ? phaseQuestionsForSession(session) : [];
  const currentQuestionIndex = currentQuestion
    ? currentPhaseQuestions.findIndex((question) => question.id === currentQuestion.id)
    : -1;
  const previousQuestion = currentQuestionIndex > 0
    ? currentPhaseQuestions[currentQuestionIndex - 1]
    : null;
  const previousAnswerSeconds = previousQuestion
    ? session.responses[previousQuestion.id]?.activeSeconds ?? null
    : Object.values(session.responses)
        .filter((response) => response.questionId !== currentQuestion?.id)
        .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
        .at(-1)?.activeSeconds ?? null;

  const selectedView: ViewTab = activeTab;
  const resultsTabVisible = Boolean(session.profileName);

  return (
    <main className={`app-shell ${session.phase === "intro" || !session.profileName ? "intro-shell" : ""}`}>
      {session.profileName && session.phase !== "intro" && <ProgressRail session={session} />}
      <section className={`quiz-workspace ${session.phase === "intro" || !session.profileName ? "intro-workspace" : ""}`}>
        <SessionHeader session={session} viewTab={resultsTabVisible ? selectedView : undefined} onTogglePause={() => setSession({ ...session, paused: !session.paused, updatedAt: new Date().toISOString() })} />

        {!session.profileName ? (
          <ProfileScreen
            value={profileNameDraft}
            onChange={setProfileNameDraft}
            onSubmit={handleProfileSubmit}
          />
        ) : (
          <>
            {resultsTabVisible && <ViewTabs activeTab={selectedView} answered={Object.keys(session.responses).length} onChange={setActiveTab} />}
            {selectedView === "results" ? (
              <div id="results-panel" role="tabpanel" aria-labelledby="results-tab">
                <ResultsScreen session={session} history={attemptHistory} partial={session.phase !== "results"} onContinue={() => setActiveTab("journey")} onDownload={handleDownload} onReset={handleReset} />
              </div>
            ) : (
              <div id="journey-panel" role="tabpanel" aria-labelledby="journey-tab">
                {session.phase === "intro" && <IntroScreen onStart={handleStart} />}
                {session.phase === "route-select" && (
                  <RouteModeScreen
                    selectedMode={routeModeDraft}
                    focusedAreas={focusedDraft}
                    onSelectMode={handleRouteModeSelect}
                    onToggleFocusedArea={toggleFocusedArea}
                    onStart={handleStart}
                  />
                )}
                {currentQuestion && ["essential", "confirmation", "applied", "deepening"].includes(session.phase) && (
                  <QuestionScreen
                    question={currentQuestion}
                    questionSeconds={questionSeconds}
                    previousAnswerSeconds={previousAnswerSeconds}
                    selectedOption={selectedOption}
                    confidence={confidence}
                    paused={session.paused}
                    phaseQuestions={currentPhaseQuestions}
                    optionOrder={stableOptionOrder(currentQuestion, `${session.sessionId}:${currentQuestion.id}`)}
                    isConfirmation={session.phase === "confirmation"}
                    onSelectOption={handleOptionSelect}
                    onSelectConfidence={handleConfidenceSelect}
                  />
                )}
                {session.phase === "interest" && pendingInterest && (
                  <InterestScreen
                    areaName={pendingInterest.name}
                    draft={interestDraft}
                    completedAreas={Object.keys(session.interests).length + 1}
                    totalAreas={session.routeMode === "focused" ? session.selectedAreas.applied.length : 13}
                    onChange={(field, value) => setInterestDraft((current) => ({ ...current, [field]: value }))}
                    onSubmit={handleInterestSubmit}
                  />
                )}
                {session.phase === "select-applied" && (
                  <AreaSelectionScreen
                    kind="applied"
                    session={session}
                    selected={appliedDraft}
                    suggestionIds={appliedSuggestions.map((item) => item.areaId)}
                    suggestionReasons={appliedSuggestionReasons}
                    availableAreaIds={allAreaIds}
                    onToggle={(areaId) => toggleArea("applied", areaId)}
                    onContinue={confirmApplied}
                  />
                )}
                {session.phase === "select-deepening" && (
                  <AreaSelectionScreen
                    kind="deepening"
                    session={session}
                    selected={deepeningDraft}
                    suggestionIds={deepeningSuggestions.map((item) => item.areaId)}
                    suggestionReasons={deepeningSuggestionReasons}
                    availableAreaIds={deepeningAvailable}
                    onToggle={(areaId) => toggleArea("deepening", areaId)}
                    onContinue={confirmDeepening}
                  />
                )}
                {session.phase === "results" && <p className="completion-note">El recorrido está completo. Abre la pestaña Resultados para revisar tu perfil.</p>}
              </div>
            )}
          </>
        )}
      </section>
      <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")} />
    </main>
  );
}
