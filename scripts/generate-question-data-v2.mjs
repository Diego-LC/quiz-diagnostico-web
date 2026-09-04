import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const legacyPath = path.join(projectRoot, "app", "data", "questions.generated.ts");
const originalRoot = path.resolve(projectRoot, "..", "PreguntasDiagnóstico");
const outputPath = path.join(projectRoot, "app", "data", "questions.v2.generated.ts");

const AREA_SOURCE = {
  "01-programacion-y-resolucion-de-problemas": "D05. Programación en Python3.md",
  "02-desarrollo-e-ingenieria-de-software": "D08. Ingeniería de Software.md",
  "03-bases-de-datos-y-sql": "D07. Sistemas de Base de Datos.md",
  "04-linux-y-administracion-de-sistemas": "D04. Sistema Operativo LINUX.md",
  "05-cloud-y-devops": "D03. Sistemas CLOUD.md",
  "06-sistemas-distribuidos": null,
  "07-ingenieria-de-datos": "D06. Ingeniería de Datos.md",
  "08-machine-learning-y-mlops": "D11. Machine Learning.md",
  "09-ia-generativa-y-sistemas-de-agentes": "D01. Sistemas de Agentes de IA.md",
  "10-iot-y-sistemas-ciberfisicos": "D02. Sistemas de IoT.md",
  "11-ux-accesibilidad-y-diseno-de-interaccion": "D10. Experiencia de Usuario.md",
  "12-gestion-de-proyectos-y-productos-tic": "D09. Gestión de Proyectos TIC.md",
  "13-ciberseguridad-y-privacidad": null,
};

const SUBCOMPETENCIES = {
  "01-programacion-y-resolucion-de-problemas": ["logica", "estructuras", "pruebas", "eficiencia"],
  "02-desarrollo-e-ingenieria-de-software": ["requisitos", "diseno", "verificacion", "entrega"],
  "03-bases-de-datos-y-sql": ["modelado", "sql", "transacciones", "rendimiento"],
  "04-linux-y-administracion-de-sistemas": ["archivos", "procesos", "servicios", "operacion"],
  "05-cloud-y-devops": ["arquitectura", "entrega", "observabilidad", "seguridad-costos"],
  "06-sistemas-distribuidos": ["fallas", "mensajeria", "consistencia", "resiliencia"],
  "07-ingenieria-de-datos": ["pipelines", "calidad", "streaming", "gobierno"],
  "08-machine-learning-y-mlops": ["datos", "modelos", "validez", "operacion"],
  "09-ia-generativa-y-sistemas-de-agentes": ["llm-rag", "herramientas", "evaluacion", "memoria"],
  "10-iot-y-sistemas-ciberfisicos": ["sensores", "conectividad", "flota", "seguridad-fisica"],
  "11-ux-accesibilidad-y-diseno-de-interaccion": ["investigacion", "interaccion", "usabilidad", "accesibilidad"],
  "12-gestion-de-proyectos-y-productos-tic": ["alcance", "planificacion", "priorizacion", "resultados"],
  "13-ciberseguridad-y-privacidad": ["identidad", "desarrollo-seguro", "incidentes", "privacidad"],
};

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseLegacyAreas() {
  const source = readFileSync(legacyPath, "utf8");
  const startMarker = "export const diagnosticAreas: DiagnosticArea[] = ";
  const endMarker = ";\n\nexport const diagnosticQuestions";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  invariant(start >= 0 && end > start, "No se encontró el bloque generado actual.");
  return JSON.parse(source.slice(start + startMarker.length, end));
}

function cleanText(value) {
  return value
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function parseOptionLine(line) {
  const match = line.match(/^\s*(?:[-*]\s+)?(?:\*\*)?([A-D])(?:\)|\.)\s+(.*)$/u);
  if (!match) return null;
  const text = cleanText(match[2]).replace(/^\[Correcta\]\s*/iu, "").trim();
  return { key: match[1], text, correct: /\[Correcta\]/iu.test(match[2]) };
}

function extractOriginalQuestions(markdown) {
  const headings = [
    ...markdown.matchAll(/^\s*\*\*Pregunta\s+(\d+)\*\*\s*$/gimu),
  ];
  const blocks = headings.length
    ? headings.map((heading, index) => ({
        number: Number(heading[1]),
        block: markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length),
      }))
    : markdown.split(/\r?\n-{3,}\r?\n/u).map((block, index) => ({ number: index + 1, block }));

  const result = [];
  for (const entry of blocks) {
    const questionLabel = entry.block.match(/(?:^|\n)\s*\*\*Pregunta:\*\*\s*([^\n]+)/iu)?.[1]
      ?? entry.block.match(/(?:^|\n)\s*\*\*Enunciado:\*\*\s*([^\n]+)/iu)?.[1]
      ?? entry.block.match(/(?:^|\n)\s*([^\n]{35,}\?)\s*\n/u)?.[1];
    const optionLines = entry.block.split(/\r?\n/u).map(parseOptionLine).filter(Boolean);
    const uniqueOptions = [];
    for (const option of optionLines) {
      if (!uniqueOptions.some((item) => item.key === option.key)) uniqueOptions.push(option);
    }
    if (uniqueOptions.length < 4) continue;

    const correctFromLabel = entry.block.match(/(?:Respuesta\s+correcta|correcta)\s*:?\s*\*\*?([A-D])/iu)?.[1]?.toUpperCase();
    const correctOption = correctFromLabel
      ?? uniqueOptions.find((option) => option.correct)?.key
      ?? uniqueOptions.find((option) => /\*\*[^*]+\*\*/u.test(entry.block) && option.text)?.key;
    const feedback = entry.block.match(/(?:Feedback|Justificación|Explicación)\s*:\s*([\s\S]*?)(?=\r?\n\s*(?:\*\*Pregunta|\d+\s*$)|$)/iu)?.[1];
    const stem = cleanText(questionLabel ?? "");
    if (!stem || !correctOption) continue;
    result.push({
      number: entry.number,
      stem,
      options: uniqueOptions.slice(0, 4).map(({ key, text }) => ({ key, text })),
      correctOption,
      explanation: cleanText(feedback ?? "La alternativa seleccionada debe compararse con el objetivo y las restricciones del escenario."),
    });
  }
  return result;
}

function makeOption(questionId, key, text, points, correct, explanation) {
  return {
    key,
    id: `${questionId}-O${key}`,
    text,
    points,
    rationale: correct ? explanation : "Esta decisión no resuelve completamente el objetivo o conserva un riesgo relevante del escenario.",
    misconceptionTags: correct ? [] : ["revisar-restricciones"],
  };
}

function enrichLegacyQuestion(question, subcompetencyId) {
  const explanation = question.explanation;
  return {
    ...question,
    version: 1,
    bankVersion: "v2-draft",
    subcompetencyId,
    cognitiveProcess: question.level === "essential" ? "understand" : question.level === "applied" ? "apply" : "evaluate",
    itemType: "single-best",
    estimatedSeconds: question.level === "essential" ? 35 : question.level === "applied" ? 60 : 80,
    isAnchor: false,
    status: "active",
    sourceRefs: ["CuestionarioDiagnóstico/Áreas"],
    maxPoints: 1,
    options: question.options.map((option) => makeOption(question.id, option.key, option.text, option.key === question.correctOption ? 1 : 0, option.key === question.correctOption, explanation)),
    correctOption: question.correctOption,
  };
}

function enrichSupplement(question, base, level, index, subcompetencyId, fromOriginal = false) {
  const id = `${base.code}-${level === "applied" ? "A" : "P"}${String(index + 1).padStart(2, "0")}`;
  const explanation = question.explanation;
  return {
    id,
    areaId: base.id,
    areaNumber: base.number,
    areaName: base.name,
    level,
    version: 1,
    bankVersion: "v2-draft",
    subcompetencyId,
    cognitiveProcess: level === "applied" ? "analyze" : "evaluate",
    itemType: "graded-judgment",
    estimatedSeconds: level === "applied" ? 75 : 95,
    isAnchor: false,
    status: "active",
    sourceRefs: fromOriginal
      ? ["PreguntasDiagnóstico", "revisión-temática-pendiente"]
      : ["reformulación-v2", "revisión-temática-pendiente"],
    stem: question.stem,
    maxPoints: 3,
    options: question.options.map((option, optionIndex) => makeOption(id, option.key, option.text, option.key === question.correctOption ? 3 : optionIndex === 0 ? 1 : 0, option.key === question.correctOption, explanation)),
    correctOption: question.correctOption,
    evaluates: `${subcompetencyId} en un escenario aplicado`,
    explanation,
  };
}

function makeGeneratedEssential(base, sourceQuestion, index, subcompetencyId) {
  const id = `${base.code}-E${String(6 + index).padStart(2, "0")}`;
  const options = sourceQuestion.options;
  const correct = sourceQuestion.correctOption;
  return {
    id,
    areaId: base.id,
    areaNumber: base.number,
    areaName: base.name,
    level: "essential",
    version: 1,
    bankVersion: "v2-draft",
    subcompetencyId,
    cognitiveProcess: "understand",
    itemType: "single-best",
    estimatedSeconds: 40,
    isAnchor: true,
    status: "pilot",
    sourceRefs: ["reformulación-v2", "revisión-temática-pendiente"],
    stem: `En ${base.name.toLowerCase()}, ¿qué principio ayuda a interpretar este problema? ${sourceQuestion.stem}`,
    options: options.map((option) => makeOption(id, option.key, option.text, option.key === correct ? 1 : 0, option.key === correct, sourceQuestion.explanation)),
    maxPoints: 1,
    correctOption: correct,
    evaluates: `fundamento de ${subcompetencyId}`,
    explanation: sourceQuestion.explanation,
  };
}

function codeFor(area) {
  return area.questions[0]?.id.split("-")[0] ?? `A${String(area.number).padStart(2, "0")}`;
}

const legacyAreas = parseLegacyAreas();
const allAreas = legacyAreas.map((area) => {
  const base = { ...area, code: codeFor(area) };
  const subcompetencies = SUBCOMPETENCIES[area.id];
  invariant(subcompetencies, `No hay subcompetencias para ${area.id}`);
  const existing = area.questions.map((question, index) => enrichLegacyQuestion(question, subcompetencies[index % 4]));
  const sourceName = AREA_SOURCE[area.id];
  const original = sourceName ? extractOriginalQuestions(readFileSync(path.join(originalRoot, sourceName), "utf8")) : [];
  const essentials = subcompetencies.slice(0, 3).map((subcompetency, index) => makeGeneratedEssential(base, area.questions[index], index, subcompetency));
  const applied = original.slice(0, 3).map((question, index) => enrichSupplement(question, base, "applied", index + 5, subcompetencies[(index + 1) % 4], true));
  const deepening = original.slice(3, 6).map((question, index) => enrichSupplement(question, base, "deepening", index + 5, subcompetencies[(index + 2) % 4], true));
  const additions = [...essentials, ...applied, ...deepening];
  while (additions.filter((question) => question.level === "applied").length < 3) {
    const source = area.questions[additions.length % area.questions.length];
    additions.push(enrichSupplement({ stem: `${source.stem} Explica qué dato adicional revisarías antes de decidir.`, options: source.options, correctOption: source.correctOption, explanation: source.explanation }, base, "applied", additions.length + 5, subcompetencies[1], false));
  }
  while (additions.filter((question) => question.level === "deepening").length < 3) {
    const source = area.questions[(additions.length + 1) % area.questions.length];
    additions.push(enrichSupplement({ stem: `${source.stem} ¿Qué compensación deberías hacer explícita?`, options: source.options, correctOption: source.correctOption, explanation: source.explanation }, base, "deepening", additions.length + 5, subcompetencies[2], false));
  }
  const questions = [...existing, ...additions].slice(0, 24).map((question, questionIndex) => ({
    ...question,
    isAnchor: question.level === "essential" && questionIndex < 4,
  }));
  return { id: area.id, number: area.number, name: area.name, questions };
});

const allQuestions = allAreas.flatMap((area) => area.questions);
invariant(allAreas.length === 13, `Se esperaban 13 áreas y hay ${allAreas.length}`);
invariant(allQuestions.length === 312, `Se esperaban 312 preguntas y hay ${allQuestions.length}`);
invariant(new Set(allQuestions.map((question) => question.id)).size === allQuestions.length, "Hay IDs duplicados");
for (const area of allAreas) {
  invariant(area.questions.length === 24, `${area.name} no tiene 24 preguntas`);
  for (const level of ["essential", "applied", "deepening"]) {
    invariant(area.questions.filter((question) => question.level === level).length === 8, `${area.name}: ${level} no tiene 8 preguntas`);
  }
}

const typeBlock = `export type DiagnosticLevel = "essential" | "applied" | "deepening";
export type DiagnosticOptionKey = "A" | "B" | "C" | "D";
export type DiagnosticItemType = "single-best" | "graded-judgment" | "practical";
export type DiagnosticQuestionStatus = "draft" | "reviewed" | "pilot" | "active" | "retired";

export interface DiagnosticOption {
  key: DiagnosticOptionKey;
  id: string;
  text: string;
  points: number;
  rationale: string;
  misconceptionTags: string[];
}

export interface DiagnosticQuestion {
  id: string;
  areaId: string;
  areaNumber: number;
  areaName: string;
  level: DiagnosticLevel;
  version: number;
  bankVersion: string;
  subcompetencyId: string;
  cognitiveProcess: string;
  itemType: DiagnosticItemType;
  estimatedSeconds: number;
  isAnchor: boolean;
  status: DiagnosticQuestionStatus;
  sourceRefs: string[];
  stem: string;
  options: DiagnosticOption[];
  maxPoints: number;
  correctOption: DiagnosticOptionKey;
  evaluates: string;
  explanation: string;
}

export interface DiagnosticArea {
  id: string;
  number: number;
  name: string;
  questions: DiagnosticQuestion[];
}

export const diagnosticAreas: DiagnosticArea[] = `;
const suffix = `;

export const diagnosticQuestions: DiagnosticQuestion[] = diagnosticAreas.flatMap((area) => area.questions);
export const questionsById: Readonly<Record<string, DiagnosticQuestion>> = Object.fromEntries(diagnosticQuestions.map((question) => [question.id, question]));
export const DIAGNOSTIC_BANK_VERSION = "v2-draft" as const;
`;

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `// Archivo generado por scripts/generate-question-data-v2.mjs.\n// No editar manualmente.\n\n${typeBlock}${JSON.stringify(allAreas, null, 2)}${suffix}`, "utf8");
console.log(JSON.stringify({ areas: allAreas.length, questions: allQuestions.length, output: outputPath }));
