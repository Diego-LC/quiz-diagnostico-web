"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  diagnosticAreas,
  diagnosticQuestions,
  questionsById,
  type DiagnosticLevel,
  type DiagnosticOptionKey,
  type DiagnosticQuestion,
} from "./data/questions.generated";
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

function questionsForLevel(
  level: DiagnosticLevel,
  selectedAreaIds = allAreaIds,
) {
  const selected = new Set(selectedAreaIds);
  return diagnosticQuestions.filter(
    (question) => question.level === level && selected.has(question.areaId),
  );
}

function toScoringResponses(session: DiagnosticSessionState): ScoringResponse[] {
  return Object.values(session.responses).flatMap((response) => {
    const question = questionsById[response.questionId];
    if (!question) return [];
    return [
      {
        areaId: question.areaId,
        level: question.level,
        isCorrect: response.correct,
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
    const essentialIds = area.questions
      .filter((question) => question.level === "essential")
      .map((question) => question.id);
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
  return (
    65 +
    session.selectedAreas.applied.length * 5 +
    session.selectedAreas.deepening.length * 5
  );
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
    applied: session.selectedAreas.applied.filter((id) => knownAreaIds.has(id)).slice(0, 4),
    deepening: session.selectedAreas.deepening.filter((id) => knownAreaIds.has(id)).slice(0, 2),
  };
  let currentQuestionId =
    session.currentQuestionId && knownQuestionIds.has(session.currentQuestionId)
      ? session.currentQuestionId
      : null;

  if (!currentQuestionId && session.phase === "essential") {
    currentQuestionId = nextUnanswered(questionsForLevel("essential"), responses)?.id ?? null;
  }
  if (!currentQuestionId && session.phase === "applied") {
    currentQuestionId =
      nextUnanswered(questionsForLevel("applied", selectedAreas.applied), responses)?.id ?? null;
  }
  if (!currentQuestionId && session.phase === "deepening") {
    currentQuestionId =
      nextUnanswered(questionsForLevel("deepening", selectedAreas.deepening), responses)?.id ?? null;
  }

  return { ...session, responses, interests, selectedAreas, currentQuestionId };
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
          const essential = area.questions.filter(
            (question) =>
              question.level === "essential" && session.responses[question.id],
          ).length;
          const extra = area.questions.filter(
            (question) =>
              question.level !== "essential" && session.responses[question.id],
          ).length;
          const completed = essential === 5 && Boolean(session.interests[area.id]);
          return (
            <li
              className={`${activeAreaId === area.id ? "active" : ""} ${completed ? "complete" : ""}`}
              key={area.id}
            >
              <span>{String(area.number).padStart(2, "0")}</span>
              <div>
                <p>{area.name}</p>
                <small>{extra > 0 ? `${essential + extra}/15` : `${essential}/5 esenciales`}</small>
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
}: {
  session: DiagnosticSessionState;
  onTogglePause: () => void;
}) {
  const copy = session.profileName
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
          ["Mapa esencial", "65 preguntas · todas las áreas"],
          ["Aplicación", "Hasta cuatro áreas"],
          ["Profundización", "Hasta dos candidatas"],
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

function IntroScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="intro-layout">
      <section className="intro-card">
        <span className="intro-kicker">13 áreas · 3 niveles · 195 preguntas disponibles</span>
        <h2>No necesitas responderlo todo para obtener un perfil útil.</h2>
        <p className="intro-lead">
          Comenzarás con cinco fundamentos de cada área. Tus respuestas, tu confianza y lo
          que te interese decidirán qué módulos conviene explorar después.
        </p>
        <div className="route-overview">
          <article>
            <span>01</span>
            <strong>Mapa general</strong>
            <p>65 preguntas esenciales y una breve valoración de interés por área.</p>
          </article>
          <article>
            <span>02</span>
            <strong>Aplicación</strong>
            <p>La app propone cuatro áreas; tú conservas la decisión final.</p>
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

function QuestionScreen({
  question,
  questionSeconds,
  previousAnswerSeconds,
  selectedOption,
  confidence,
  paused,
  phaseQuestions,
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
  onSelectOption: (option: DiagnosticOptionKey) => void;
  onSelectConfidence: (confidence: AnswerConfidence) => void;
}) {
  const index = phaseQuestions.findIndex((item) => item.id === question.id);
  const areaIndex =
    phaseQuestions.filter((item) => item.areaId === question.areaId).findIndex((item) => item.id === question.id) + 1;

  return (
    <div className="content-grid">
      <article className="question-card">
        <div className="question-meta">
          <div>
            <span className="level-pill">{levelLabels[question.level]}</span>
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
          <span>Pregunta {areaIndex} de 5 · {index + 1} de {phaseQuestions.length} en esta pasada</span>
        </div>
        <h2><InlineMarkdown text={question.stem} /></h2>

        <fieldset className="answers" disabled={paused}>
          <legend className="sr-only">Selecciona una respuesta</legend>
          {question.options.map((option) => (
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
          Atajos: <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> o <kbd>A</kbd>/<kbd>B</kbd>/<kbd>C</kbd> para responder · <kbd>Q</kbd>/<kbd>G</kbd> al azar · <kbd>W</kbd>/<kbd>D</kbd> dudoso · <kbd>E</kbd>/<kbd>S</kbd> seguro · <kbd>P</kbd> pausar/reanudar.
        </p>

        <footer className="card-actions">
          <p>Al elegir una alternativa y tu nivel de confianza, la respuesta se guarda y avanzas automáticamente. La explicación aparecerá al terminar tu recorrido.</p>
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
  onChange,
  onSubmit,
}: {
  areaName: string;
  draft: InterestDraft;
  completedAreas: number;
  onChange: (field: keyof InterestDraft, value: InterestScore) => void;
  onSubmit: () => void;
}) {
  const complete = Object.values(draft).every(Boolean);
  return (
    <div className="focus-layout">
      <section className="interest-card">
        <span className="level-pill">Área esencial completada · {completedAreas} de 13</span>
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
                  {kind === "applied" ? "Esencial" : "Aplicado"}: {baseMetric?.correct ?? 0}/5 · Interés {interest?.toFixed(1) ?? "NE"}/5
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

function scoreCell(correct: number, total: number) {
  return total === 0 ? <span className="ne">NE</span> : <strong>{correct}/5</strong>;
}

function ResultsScreen({
  session,
  onDownload,
  onReset,
}: {
  session: DiagnosticSessionState;
  onDownload: () => void;
  onReset: () => void;
}) {
  const responses = toScoringResponses(session);
  const interests = toScoringInterests(session);
  const metrics = calculateMetricsByArea(responses, allAreaIds);
  const metricMap = new Map(metrics.map((metric) => [metric.areaId, metric]));
  const overall = calculateOverallMetrics(responses);
  const profiles = classifyAreaProfiles(allAreaIds, responses, interests, areaNames);
  const recommendations = buildRecommendations(profiles, 3);
  const wrongAnswers = Object.values(session.responses)
    .filter((response) => !response.correct)
    .sort((a, b) => Number(b.confidence === "sure") - Number(a.confidence === "sure"));

  return (
    <div className="results-stack">
      <section className="results-hero">
        <div>
          <span className="level-pill">{responses.length} respuestas analizadas</span>
          <h2>{recommendations.projectCandidates[0]?.areaName ?? "Tu perfil TIC"}</h2>
          <p>
            {recommendations.projectCandidates[0]?.message ??
              "Usa estas señales para decidir qué probar con una actividad práctica breve."}
          </p>
        </div>
        <div className="result-actions">
          <button className="button-primary" type="button" onClick={onDownload}>Descargar resultados</button>
          <button className="button-secondary" type="button" onClick={() => window.print()}>Imprimir</button>
        </div>
      </section>

      <section className="signal-grid" aria-label="Resumen del diagnóstico">
        <article><span>Respuestas correctas</span><strong>{overall.correct}<small>/{overall.total}</small></strong><p>{overall.accuracyPercent}% en el recorrido realizado</p></article>
        <article><span>Errores seguros</span><strong>{overall.highConfidenceWrong}</strong><p>Prioridad de revisión conceptual</p></article>
        <article><span>Tiempo activo</span><strong>{formatTime(session.activeSecondsTotal)}</strong><p>Mediana por pregunta: {formatTime(overall.medianActiveSeconds ?? 0)}</p></article>
        <article><span>Áreas profundizadas</span><strong>{session.selectedAreas.deepening.length}</strong><p>De 13 áreas disponibles</p></article>
      </section>

      <section className="result-section">
        <div className="section-heading">
          <div><span className="eyebrow">Lectura conjunta</span><h2>Dominio e interés cuentan historias distintas.</h2></div>
          <p>Los umbrales son orientativos: 60% de dominio y 4/5 de interés. Cinco preguntas por nivel no constituyen una medición exhaustiva.</p>
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
                    <td>{scoreCell(metric.byLevel.essential.correct, metric.byLevel.essential.total)}</td>
                    <td>{scoreCell(metric.byLevel.applied.correct, metric.byLevel.applied.total)}</td>
                    <td>{scoreCell(metric.byLevel.deepening.correct, metric.byLevel.deepening.total)}</td>
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
                  <p><strong>Elegiste {response.selectedOption}:</strong> <InlineMarkdown text={selectedText ?? ""} /></p>
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
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const themeLoadedRef = useRef(false);
  const startedAtRef = useRef(new Date().toISOString());
  const answerLockRef = useRef(false);
  const answerSubmitRef = useRef<
    (option: DiagnosticOptionKey, answerConfidence: AnswerConfidence) => void
  >(() => undefined);

  useEffect(() => {
    const stored = loadSession(window.localStorage);
    const repaired = repairLoadedSession(stored ?? createInitialSession());
    const timeout = window.setTimeout(() => {
      setSession(repaired);
      setProfileNameDraft(repaired.profileName);
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
    if (!currentPhase || currentPhase === "intro" || currentPhase === "results" || isPaused) return;
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

  const handleAnswer = (answerOption: DiagnosticOptionKey, answerConfidence: AnswerConfidence) => {
    if (!session || !currentQuestion || answerLockRef.current) return;
    answerLockRef.current = true;
    const now = new Date().toISOString();
    const nextResponses = {
      ...session.responses,
      [currentQuestion.id]: {
        questionId: currentQuestion.id,
        selectedOption: answerOption,
        correct: answerOption === currentQuestion.correctOption,
        confidence: answerConfidence,
        activeSeconds: questionSeconds,
        startedAt: startedAtRef.current,
        answeredAt: now,
      },
    };
    const phaseQuestions = questionsForLevel(
      currentQuestion.level,
      currentQuestion.level === "essential"
        ? allAreaIds
        : currentQuestion.level === "applied"
          ? session.selectedAreas.applied
          : session.selectedAreas.deepening,
    );
    const index = phaseQuestions.findIndex((question) => question.id === currentQuestion.id);
    const next = phaseQuestions[index + 1] ?? null;
    const completedArea = !next || next.areaId !== currentQuestion.areaId;

    let phase = session.phase;
    let currentQuestionId: string | null = next?.id ?? null;
    if (currentQuestion.level === "essential" && completedArea) {
      phase = "interest";
      currentQuestionId = null;
    } else if (!next && currentQuestion.level === "applied") {
      phase = "select-deepening";
    } else if (!next && currentQuestion.level === "deepening") {
      phase = "results";
    }

    if (phase === "select-deepening") {
      const nextSession = { ...session, responses: nextResponses };
      const suggestions = suggestDeepeningAreas(
        session.selectedAreas.applied,
        toScoringResponses(nextSession),
        toScoringInterests(nextSession),
        2,
      );
      setDeepeningDraft(suggestions.map((item) => item.areaId));
    }
    prepareQuestion();
    setSession({ ...session, responses: nextResponses, phase, currentQuestionId, updatedAt: now });
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
      ["intro", "results"].includes(currentPhase)
    ) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable=\"true\"]")) return;

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

      if (isPaused) return;

      const optionByKey: Record<string, DiagnosticOptionKey> = {
        "1": "A",
        "2": "B",
        "3": "C",
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
  }, [confidence, currentPhase, isPaused, selectedOption]);

  if (!session) {
    return <main className="loading-screen"><span className="brand-mark">B</span><p>Preparando tu diagnóstico…</p></main>;
  }

  const setPhase = (phase: DiagnosticPhase, currentQuestionId: string | null = null) => {
    setSession((previous) => previous ? { ...previous, phase, currentQuestionId, updatedAt: new Date().toISOString() } : previous);
  };

  const handleProfileSubmit = () => {
    const profileName = profileNameDraft.trim();
    if (!profileName) return;
    setSession({ ...session, profileName, updatedAt: new Date().toISOString() });
  };

  const handleStart = () => {
    prepareQuestion();
    setPhase("essential", questionsForLevel("essential")[0].id);
  };

  const handleOptionSelect = (option: DiagnosticOptionKey) => {
    setSelectedOption(option);
    if (confidence) handleAnswer(option, confidence);
  };

  const handleConfidenceSelect = (value: AnswerConfidence) => {
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
    const next = nextUnanswered(questionsForLevel("essential"), session.responses);
    const nextSession: DiagnosticSessionState = {
      ...session,
      interests: nextInterests,
      phase: next ? "essential" : "select-applied",
      currentQuestionId: next?.id ?? null,
      updatedAt: new Date().toISOString(),
    };
    if (!next) {
      setAppliedDraft(
        suggestAppliedAreas(
          allAreaIds,
          toScoringResponses(nextSession),
          toScoringInterests(nextSession),
          4,
        ).map((item) => item.areaId),
      );
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
    const first = questionsForLevel("applied", selected)[0];
    if (!first) return;
    prepareQuestion();
    setSession({ ...session, selectedAreas: { ...session.selectedAreas, applied: selected }, phase: "applied", currentQuestionId: first.id, updatedAt: new Date().toISOString() });
  };

  const confirmDeepening = () => {
    const selected = diagnosticAreas.map((area) => area.id).filter((id) => deepeningDraft.includes(id));
    const first = questionsForLevel("deepening", selected)[0];
    if (!first) return;
    prepareQuestion();
    setSession({ ...session, selectedAreas: { ...session.selectedAreas, deepening: selected }, phase: "deepening", currentQuestionId: first.id, updatedAt: new Date().toISOString() });
  };

  const handleDownload = () => {
    const profiles = classifyAreaProfiles(allAreaIds, scoringResponses, scoringInterests, areaNames);
    const metrics = calculateMetricsByArea(scoringResponses, allAreaIds);
    const payload = JSON.stringify({
      format: "brujula-tic-resultados",
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
  };

  const appliedSuggestionReasons = Object.fromEntries(
    appliedSuggestions.map((item) => [item.areaId, item.reasons]),
  );
  const deepeningSuggestionReasons = Object.fromEntries(
    deepeningSuggestions.map((item) => [item.areaId, item.reasons]),
  );
  const currentPhaseQuestions = currentQuestion
    ? questionsForLevel(
        currentQuestion.level,
        currentQuestion.level === "essential" ? allAreaIds : currentQuestion.level === "applied" ? session.selectedAreas.applied : session.selectedAreas.deepening,
      )
    : [];
  const currentQuestionIndex = currentQuestion
    ? currentPhaseQuestions.findIndex((question) => question.id === currentQuestion.id)
    : -1;
  const previousQuestion = currentQuestionIndex > 0
    ? currentPhaseQuestions[currentQuestionIndex - 1]
    : null;
  const previousAnswerSeconds = previousQuestion
    ? session.responses[previousQuestion.id]?.activeSeconds ?? null
    : null;

  return (
    <main className={`app-shell ${session.phase === "intro" || !session.profileName ? "intro-shell" : ""}`}>
      {session.profileName && session.phase !== "intro" && <ProgressRail session={session} />}
      <section className={`quiz-workspace ${session.phase === "intro" || !session.profileName ? "intro-workspace" : ""}`}>
        <SessionHeader session={session} onTogglePause={() => setSession({ ...session, paused: !session.paused, updatedAt: new Date().toISOString() })} />

        {!session.profileName ? (
          <ProfileScreen
            value={profileNameDraft}
            onChange={setProfileNameDraft}
            onSubmit={handleProfileSubmit}
          />
        ) : (
          <>
            {session.phase === "intro" && <IntroScreen onStart={handleStart} />}
            {currentQuestion && ["essential", "applied", "deepening"].includes(session.phase) && (
              <QuestionScreen
                question={currentQuestion}
                questionSeconds={questionSeconds}
                previousAnswerSeconds={previousAnswerSeconds}
                selectedOption={selectedOption}
                confidence={confidence}
                paused={session.paused}
                phaseQuestions={currentPhaseQuestions}
                onSelectOption={handleOptionSelect}
                onSelectConfidence={handleConfidenceSelect}
              />
            )}
            {session.phase === "interest" && pendingInterest && (
              <InterestScreen
                areaName={pendingInterest.name}
                draft={interestDraft}
                completedAreas={Object.keys(session.interests).length + 1}
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
            {session.phase === "results" && <ResultsScreen session={session} onDownload={handleDownload} onReset={handleReset} />}
          </>
        )}
      </section>
      <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === "dark" ? "light" : "dark")} />
    </main>
  );
}
