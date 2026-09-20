import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const bankRoot = path.join(projectRoot, "CuestionarioDiagnóstico", "Banco v2");
const manifestPath = path.join(bankRoot, "manifest.json");
const areasDirectory = path.join(bankRoot, "Áreas");
const keysDirectory = path.join(bankRoot, "Claves");
const outputPath = path.join(projectRoot, "app", "data", "questions.v2.generated.ts");

const LEVEL_BY_CODE = { E: "essential", A: "applied", P: "deepening" };
const ITEM_TYPES = new Set(["single-best", "graded-judgment", "practical"]);
const STATUSES = new Set(["draft", "reviewed", "pilot", "active", "retired"]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function singleLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedOptionText(value) {
  return singleLine(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(label + ": no se pudo leer JSON (" + (error instanceof Error ? error.message : String(error)) + ").");
  }
}

function readMarkdown(filePath, label) {
  try {
    return normalizeNewlines(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(label + ": no se pudo leer el archivo (" + (error instanceof Error ? error.message : String(error)) + ").");
  }
}

function asRecord(value, label) {
  invariant(value && typeof value === "object" && !Array.isArray(value), label + ": se esperaba un objeto.");
  return value;
}

function asText(value, label) {
  invariant(typeof value === "string" && value.trim(), label + ": se esperaba texto no vacío.");
  return value.trim();
}

function parseComment(block, prefix, sourceName, id) {
  const startMarker = "<!-- " + prefix + " ";
  const start = block.indexOf(startMarker);
  const end = start < 0 ? -1 : block.indexOf("-->", start + startMarker.length);
  invariant(start >= 0 && end >= 0, sourceName + ": falta el comentario " + prefix + " de " + id + ".");
  try {
    return asRecord(JSON.parse(block.slice(start + startMarker.length, end).trim()), sourceName + ": metadatos de " + id);
  } catch (error) {
    throw new Error(sourceName + ": JSON inválido en " + id + " (" + (error instanceof Error ? error.message : String(error)) + ").");
  }
}

function parseArea(markdown, sourceName) {
  const title = markdown.match(/^#\s+(\d{2})\.\s+(.+)$/m);
  invariant(title, sourceName + ": título de área no reconocido.");
  const pattern = /^###\s+([A-Z]{2,6}-[EAP]\d+)\s+·\s+(.+)$/gm;
  const headings = [...markdown.matchAll(pattern)];
  invariant(headings.length === 24, sourceName + ": se esperaban 24 preguntas y hay " + headings.length + ".");

  const questions = headings.map((heading, index) => {
    const id = heading[1];
    const block = markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length);
    const levelCode = id.match(/-([EAP])\d+$/)?.[1];
    const level = levelCode ? LEVEL_BY_CODE[levelCode] : null;
    invariant(level, sourceName + ": nivel no reconocido para " + id + ".");
    const stem = block.match(/^\*\*Pregunta:\*\*\s*(.+)$/m)?.[1];
    invariant(stem, sourceName + ": enunciado vacío para " + id + ".");
    const options = [...block.matchAll(/^- ([A-D])\)\s+(.+)$/gm)].map((match) => ({
      key: match[1],
      text: singleLine(match[2]),
    }));
    invariant(options.length >= 3 && options.length <= 4, sourceName + ": " + id + " debe tener 3 o 4 alternativas.");
    const expectedKeys = "ABCD".slice(0, options.length);
    invariant(options.map((option) => option.key).join("") === expectedKeys, sourceName + ": alternativas inválidas en " + id + ".");
    invariant(new Set(options.map((option) => normalizedOptionText(option.text))).size === options.length, sourceName + ": " + id + " tiene alternativas duplicadas.");
    invariant(
      options.every((option) => !/^(todas? las anteriores|ninguna(?: de)? las anteriores)\b/.test(normalizedOptionText(option.text))),
      sourceName + ": " + id + " no debe usar “todas/ninguna de las anteriores”.",
    );
    return {
      id,
      level,
      stem: singleLine(stem),
      options,
      meta: parseComment(block, "diagnostic-v2-question", sourceName, id),
    };
  });

  return { number: Number(title[1]), name: title[2].trim(), questions };
}

function parseKeys(markdown, sourceName) {
  const pattern = /^###\s+([A-Z]{2,6}-[EAP]\d+)\s*$/gm;
  const headings = [...markdown.matchAll(pattern)];
  invariant(headings.length === 24, sourceName + ": se esperaban 24 claves y hay " + headings.length + ".");
  const keys = new Map();

  for (const [index, heading] of headings.entries()) {
    const id = heading[1];
    const block = markdown.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? markdown.length);
    const correctOption = block.match(/^\*\*Respuesta correcta:\*\*\s*([A-D])\s*$/m)?.[1];
    const pointsLine = block.match(/^\*\*Puntajes:\*\*\s*(.+)$/m)?.[1];
    const evaluates = block.match(/^\*\*Evalúa:\*\*\s*(.+)$/m)?.[1];
    const explanation = block.match(/^\*\*Explicación:\*\*\s*(.+)$/m)?.[1];
    invariant(correctOption && pointsLine && evaluates && explanation, sourceName + ": faltan datos visibles en " + id + ".");
    const points = Object.fromEntries([...pointsLine.matchAll(/([A-D])=(\d+)/g)].map((match) => [match[1], Number(match[2])]));
    invariant(Object.keys(points).length >= 3 && Object.keys(points).length <= 4, sourceName + ": puntajes incompletos en " + id + ".");
    invariant(!keys.has(id), sourceName + ": clave duplicada para " + id + ".");
    keys.set(id, {
      correctOption,
      points,
      evaluates: singleLine(evaluates),
      explanation: singleLine(explanation),
      meta: parseComment(block, "diagnostic-v2-key", sourceName, id),
    });
  }

  return keys;
}

function validateQuestionMeta(question, area, manifest) {
  const meta = question.meta;
  const prefix = area.fileName + ": " + question.id + ": ";
  invariant(Number.isInteger(meta.version) && meta.version > 0, prefix + "versión inválida.");
  invariant(meta.bankVersion === manifest.bankVersion, prefix + "bankVersion inválido.");
  invariant(typeof meta.subcompetencyId === "string" && area.subcompetencies.some((item) => item.id === meta.subcompetencyId), prefix + "subcompetencia inválida.");
  invariant(typeof meta.cognitiveProcess === "string" && meta.cognitiveProcess.trim(), prefix + "proceso cognitivo inválido.");
  invariant(ITEM_TYPES.has(meta.itemType), prefix + "tipo de ítem inválido.");
  invariant(Number.isInteger(meta.estimatedSeconds) && meta.estimatedSeconds >= 15, prefix + "tiempo orientativo inválido.");
  invariant(typeof meta.isAnchor === "boolean", prefix + "marca de ancla inválida.");
  invariant(!meta.isAnchor || question.level === "essential", prefix + "solo un ítem esencial puede ser ancla.");
  invariant(STATUSES.has(meta.status), prefix + "estado inválido.");
  invariant(Array.isArray(meta.sourceRefs) && meta.sourceRefs.every((reference) => typeof reference === "string" && reference.trim()), prefix + "referencias inválidas.");
}

function mergeArea(area, manifest) {
  const parsedArea = parseArea(readMarkdown(path.join(areasDirectory, area.fileName), area.fileName), area.fileName);
  const keyEntries = parseKeys(readMarkdown(path.join(keysDirectory, area.keyFileName), area.keyFileName), area.keyFileName);
  invariant(parsedArea.number === area.number && parsedArea.name === area.name, area.fileName + ": título distinto al manifiesto.");

  const questions = parsedArea.questions.map((question) => {
    validateQuestionMeta(question, area, manifest);
    const key = keyEntries.get(question.id);
    invariant(key, area.fileName + ": falta clave para " + question.id + ".");
    const optionKeys = question.options.map((option) => option.key);
    invariant(optionKeys.includes(key.correctOption), area.keyFileName + ": respuesta inválida en " + question.id + ".");
    invariant(Object.keys(key.points).sort().join("") === optionKeys.join(""), area.keyFileName + ": puntajes no coinciden con alternativas en " + question.id + ".");
    const metaPoints = asRecord(key.meta.points, area.keyFileName + ": metadatos de puntajes de " + question.id);
    for (const optionKey of optionKeys) {
      invariant(Number.isInteger(key.points[optionKey]) && key.points[optionKey] >= 0, area.keyFileName + ": puntaje inválido en " + question.id + "/" + optionKey + ".");
      invariant(metaPoints[optionKey] === key.points[optionKey], area.keyFileName + ": puntaje visible y metadato distinto en " + question.id + "/" + optionKey + ".");
    }
    const maxPoints = Math.max(...Object.values(key.points));
    invariant(key.meta.correctOption === key.correctOption, area.keyFileName + ": respuesta visible y metadato distinta en " + question.id + ".");
    invariant(key.meta.maxPoints === maxPoints && key.points[key.correctOption] === maxPoints, area.keyFileName + ": puntaje máximo inválido en " + question.id + ".");

    return {
      id: question.id,
      areaId: area.id,
      areaNumber: area.number,
      areaName: area.name,
      level: question.level,
      version: question.meta.version,
      bankVersion: question.meta.bankVersion,
      subcompetencyId: question.meta.subcompetencyId,
      cognitiveProcess: question.meta.cognitiveProcess,
      itemType: question.meta.itemType,
      estimatedSeconds: question.meta.estimatedSeconds,
      isAnchor: question.meta.isAnchor,
      status: question.meta.status,
      sourceRefs: question.meta.sourceRefs,
      stem: question.stem,
      options: question.options.map((option) => ({
        key: option.key,
        id: question.id + "-O" + option.key,
        text: option.text,
        points: key.points[option.key],
        rationale: option.key === key.correctOption
          ? key.explanation
          : "Esta alternativa no resuelve completamente el objetivo o conserva un riesgo relevante del escenario.",
        misconceptionTags: option.key === key.correctOption ? [] : ["revisar-restricciones"],
      })),
      maxPoints,
      correctOption: key.correctOption,
      evaluates: key.evaluates,
      explanation: key.explanation,
    };
  });

  invariant(keyEntries.size === questions.length, area.keyFileName + ": hay claves sin pregunta.");
  return { id: area.id, number: area.number, name: area.name, questions };
}

function validateBank(areas, manifest) {
  invariant(areas.length === 13, "Se esperaban 13 áreas y hay " + areas.length + ".");
  const questions = areas.flatMap((area) => area.questions);
  invariant(questions.length === 312, "Se esperaban 312 preguntas y hay " + questions.length + ".");
  invariant(new Set(questions.map((question) => question.id)).size === questions.length, "Hay identificadores de pregunta duplicados.");

  for (const area of areas) {
    invariant(area.questions.length === 24, area.name + ": debe tener 24 preguntas.");
    invariant(area.questions.filter((question) => question.isAnchor).length === 4, area.name + ": debe tener cuatro preguntas ancla.");
    for (const level of Object.values(LEVEL_BY_CODE)) {
      const levelQuestions = area.questions.filter((question) => question.level === level);
      invariant(levelQuestions.length === 8, area.name + ": " + level + " debe tener 8 preguntas.");
      for (const subcompetency of manifest.areas.find((candidate) => candidate.id === area.id).subcompetencies) {
        const count = levelQuestions.filter((question) => question.subcompetencyId === subcompetency.id).length;
        invariant(count === 2, area.name + ": " + level + "/" + subcompetency.id + " debe tener dos preguntas y tiene " + count + ".");
      }
    }
  }

  const newlyAdded = questions.filter((question) => !question.sourceRefs.includes("CuestionarioDiagnóstico/Áreas"));
  invariant(newlyAdded.length === 117, "Se esperaban 117 preguntas añadidas y hay " + newlyAdded.length + ".");
  for (const question of newlyAdded) {
    invariant(question.status === "pilot", question.id + ": una pregunta añadida debe conservar estado piloto hasta su revisión temática.");
    invariant(question.options.length === 4, question.id + ": una pregunta añadida debe tener cuatro alternativas reales.");
  }

  return {
    areas: areas.length,
    questions: questions.length,
    pilot: questions.filter((question) => question.status === "pilot").length,
    threeOptions: questions.filter((question) => question.options.length === 3).length,
    fourOptions: questions.filter((question) => question.options.length === 4).length,
  };
}

const typeBlock = [
  'export type DiagnosticLevel = "essential" | "applied" | "deepening";',
  'export type DiagnosticOptionKey = "A" | "B" | "C" | "D";',
  'export type DiagnosticItemType = "single-best" | "graded-judgment" | "practical";',
  'export type DiagnosticQuestionStatus = "draft" | "reviewed" | "pilot" | "active" | "retired";',
  "",
  "export interface DiagnosticOption {",
  "  key: DiagnosticOptionKey;",
  "  id: string;",
  "  text: string;",
  "  points: number;",
  "  rationale: string;",
  "  misconceptionTags: string[];",
  "}",
  "",
  "export interface DiagnosticQuestion {",
  "  id: string;",
  "  areaId: string;",
  "  areaNumber: number;",
  "  areaName: string;",
  "  level: DiagnosticLevel;",
  "  version: number;",
  "  bankVersion: string;",
  "  subcompetencyId: string;",
  "  cognitiveProcess: string;",
  "  itemType: DiagnosticItemType;",
  "  estimatedSeconds: number;",
  "  isAnchor: boolean;",
  "  status: DiagnosticQuestionStatus;",
  "  sourceRefs: string[];",
  "  stem: string;",
  "  options: DiagnosticOption[];",
  "  maxPoints: number;",
  "  correctOption: DiagnosticOptionKey;",
  "  evaluates: string;",
  "  explanation: string;",
  "}",
  "",
  "export interface DiagnosticArea {",
  "  id: string;",
  "  number: number;",
  "  name: string;",
  "  questions: DiagnosticQuestion[];",
  "}",
  "",
  "export const diagnosticAreas: DiagnosticArea[] = ",
].join("\n");

function buildSource(areas, bankVersion) {
  return [
    "// Archivo generado por scripts/generate-question-data-v2.mjs.",
    "// Fuente canónica: CuestionarioDiagnóstico/Banco v2.",
    "// No editar manualmente: npm run data:generate:v2",
    "",
    typeBlock + JSON.stringify(areas, null, 2) + ";",
    "",
    "export const diagnosticQuestions: DiagnosticQuestion[] = diagnosticAreas.flatMap((area) => area.questions);",
    "export const questionsById: Readonly<Record<string, DiagnosticQuestion>> = Object.fromEntries(diagnosticQuestions.map((question) => [question.id, question]));",
    "export const DIAGNOSTIC_BANK_VERSION = " + JSON.stringify(bankVersion) + " as const;",
    "",
  ].join("\n");
}

const manifest = asRecord(readJson(manifestPath, "manifest.json"), "manifest.json");
invariant(manifest.schemaVersion === 1, "manifest.json: versión de esquema no reconocida.");
manifest.bankVersion = asText(manifest.bankVersion, "manifest.json: bankVersion");
invariant(Array.isArray(manifest.areas) && manifest.areas.length === 13, "manifest.json: se esperaban 13 áreas.");
for (const area of manifest.areas) {
  asRecord(area, "manifest.json: área");
  area.id = asText(area.id, "manifest.json: id de área");
  area.name = asText(area.name, "manifest.json: nombre de " + area.id);
  area.fileName = asText(area.fileName, "manifest.json: archivo de " + area.id);
  area.keyFileName = asText(area.keyFileName, "manifest.json: clave de " + area.id);
  invariant(Number.isInteger(area.number) && area.number >= 1 && area.number <= 13, "manifest.json: número inválido en " + area.id + ".");
  invariant(Array.isArray(area.subcompetencies) && area.subcompetencies.length === 4, "manifest.json: " + area.id + " debe tener cuatro subcompetencias.");
  invariant(new Set(area.subcompetencies.map((subcompetency) => subcompetency.id)).size === 4, "manifest.json: subcompetencias repetidas en " + area.id + ".");
}

const areas = manifest.areas.map((area) => mergeArea(area, manifest));
const summary = validateBank(areas, manifest);
const source = buildSource(areas, manifest.bankVersion);

if (process.argv.includes("--check")) {
  invariant(normalizeNewlines(readFileSync(outputPath, "utf8")) === source, "El archivo generado está desactualizado. Ejecuta: npm run data:generate:v2");
  console.log(JSON.stringify({ ...summary, output: path.relative(projectRoot, outputPath), checked: true }));
} else if (process.argv.includes("--print")) {
  process.stdout.write(source);
} else {
  writeFileSync(outputPath, source, "utf8");
  console.log(JSON.stringify({ ...summary, output: path.relative(projectRoot, outputPath), written: true }));
}
