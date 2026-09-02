import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const questionnaireRoot = path.resolve(
  projectRoot,
  "CuestionarioDiagnóstico",
);
const areasDirectory = path.join(questionnaireRoot, "Áreas");
const keysDirectory = path.join(questionnaireRoot, "Claves");
const outputPath = path.join(projectRoot, "app", "data", "questions.generated.ts");

const levelByCode = {
  E: "essential",
  A: "applied",
  P: "deepening",
};

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseKeyFile(markdown, sourceName) {
  const entries = new Map();
  const headingPattern = /^###\s+([A-Z]{2,6}-[EAP]\d+)\s+—\s+([ABC])\s*$/gm;
  const headings = [...markdown.matchAll(headingPattern)];

  for (const [index, heading] of headings.entries()) {
    const id = heading[1];
    const correctOption = heading[2];
    const blockStart = heading.index + heading[0].length;
    const blockEnd = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(blockStart, blockEnd);
    const evaluates = block.match(/^\*\*Evalúa:\*\*\s*(.+)$/m)?.[1]?.trim();
    const explanation = block
      .match(/\*\*Explicación:\*\*\s*([\s\S]*?)(?=\r?\n##\s|$)/)?.[1]
      ?.trim();

    invariant(evaluates, `${sourceName}: falta "Evalúa" para ${id}.`);
    invariant(explanation, `${sourceName}: falta "Explicación" para ${id}.`);
    invariant(!entries.has(id), `${sourceName}: clave duplicada para ${id}.`);

    entries.set(id, { correctOption, evaluates, explanation });
  }

  invariant(entries.size === 15, `${sourceName}: se esperaban 15 claves y hay ${entries.size}.`);
  return entries;
}

function parseAreaFile(markdown, keyEntries, sourceName) {
  const titleMatch = markdown.match(/^#\s+(\d{2})\.\s+(.+)$/m);
  invariant(titleMatch, `${sourceName}: título de área no reconocido.`);

  const areaNumber = Number(titleMatch[1]);
  const areaName = titleMatch[2].trim();
  const areaId = `${titleMatch[1]}-${slugify(areaName)}`;
  const headingPattern = /^###\s+([A-Z]{2,6}-[EAP]\d+)\s*$/gm;
  const headings = [...markdown.matchAll(headingPattern)];
  const questions = [];

  for (const [index, heading] of headings.entries()) {
    const id = heading[1];
    const blockStart = heading.index + heading[0].length;
    const blockEnd = headings[index + 1]?.index ?? markdown.length;
    const block = markdown.slice(blockStart, blockEnd);
    const firstOptionIndex = block.search(/^- A\)\s+/m);
    invariant(firstOptionIndex >= 0, `${sourceName}: no se encontró la opción A de ${id}.`);

    const stem = block.slice(0, firstOptionIndex).trim();
    const options = [...block.matchAll(/^- ([ABC])\)\s+(.+)$/gm)].map(
      (option) => ({ key: option[1], text: option[2].trim() }),
    );
    const keyEntry = keyEntries.get(id);
    const levelCode = id.match(/-([EAP])\d+$/)?.[1];
    const level = levelCode ? levelByCode[levelCode] : undefined;

    invariant(stem, `${sourceName}: enunciado vacío para ${id}.`);
    invariant(options.length === 3, `${sourceName}: ${id} no tiene exactamente tres opciones.`);
    invariant(
      options.map((option) => option.key).join("") === "ABC",
      `${sourceName}: ${id} debe contener A, B y C en ese orden.`,
    );
    invariant(keyEntry, `${sourceName}: falta la clave de ${id}.`);
    invariant(level, `${sourceName}: nivel no reconocido para ${id}.`);

    questions.push({
      id,
      areaId,
      areaNumber,
      areaName,
      level,
      stem,
      options,
      correctOption: keyEntry.correctOption,
      evaluates: keyEntry.evaluates,
      explanation: keyEntry.explanation,
    });
  }

  invariant(questions.length === 15, `${sourceName}: se esperaban 15 preguntas y hay ${questions.length}.`);
  invariant(
    keyEntries.size === questions.length,
    `${sourceName}: la cantidad de preguntas y claves no coincide.`,
  );

  for (const level of Object.values(levelByCode)) {
    const count = questions.filter((question) => question.level === level).length;
    invariant(count === 5, `${sourceName}: el nivel ${level} debe tener 5 preguntas y tiene ${count}.`);
  }

  const parsedIds = new Set(questions.map((question) => question.id));
  for (const keyId of keyEntries.keys()) {
    invariant(parsedIds.has(keyId), `${sourceName}: la clave ${keyId} no tiene pregunta.`);
  }

  return { id: areaId, number: areaNumber, name: areaName, questions };
}

const areaFiles = readdirSync(areasDirectory)
  .filter((fileName) => /^\d{2}\..+\.md$/u.test(fileName))
  .sort((left, right) => left.localeCompare(right, "es", { numeric: true }));

invariant(areaFiles.length === 13, `Se esperaban 13 archivos de área y hay ${areaFiles.length}.`);

const areas = areaFiles.map((areaFile) => {
  const baseName = path.basename(areaFile, ".md");
  const keyFile = `${baseName} - clave.md`;
  const areaMarkdown = readFileSync(path.join(areasDirectory, areaFile), "utf8");
  const keyMarkdown = readFileSync(path.join(keysDirectory, keyFile), "utf8");
  const keyEntries = parseKeyFile(keyMarkdown, keyFile);

  return parseAreaFile(areaMarkdown, keyEntries, areaFile);
});

const allQuestions = areas.flatMap((area) => area.questions);
const allIds = new Set(allQuestions.map((question) => question.id));

invariant(allQuestions.length === 195, `Se esperaban 195 preguntas y hay ${allQuestions.length}.`);
invariant(allIds.size === allQuestions.length, "Hay identificadores de pregunta duplicados.");

const source = `// Archivo generado por scripts/generate-question-data.mjs.
// No editar manualmente: npm run data:generate

export type DiagnosticLevel = "essential" | "applied" | "deepening";
export type DiagnosticOptionKey = "A" | "B" | "C";

export interface DiagnosticOption {
  key: DiagnosticOptionKey;
  text: string;
}

export interface DiagnosticQuestion {
  id: string;
  areaId: string;
  areaNumber: number;
  areaName: string;
  level: DiagnosticLevel;
  stem: string;
  options: DiagnosticOption[];
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

export const diagnosticAreas: DiagnosticArea[] = ${JSON.stringify(areas, null, 2)};

export const diagnosticQuestions: DiagnosticQuestion[] = diagnosticAreas.flatMap(
  (area) => area.questions,
);

export const questionsById: Readonly<Record<string, DiagnosticQuestion>> =
  Object.fromEntries(diagnosticQuestions.map((question) => [question.id, question]));
`;

writeFileSync(outputPath, source, "utf8");

const levelCounts = Object.fromEntries(
  Object.values(levelByCode).map((level) => [
    level,
    allQuestions.filter((question) => question.level === level).length,
  ]),
);

console.log(
  `Generadas ${allQuestions.length} preguntas de ${areas.length} áreas en ${path.relative(projectRoot, outputPath)}.`,
);
console.log("Validación por área: 13 × 15 preguntas; cada área contiene 5 esenciales, 5 aplicadas y 5 de profundización.");
console.log(`Conteos por nivel: ${JSON.stringify(levelCounts)}.`);
