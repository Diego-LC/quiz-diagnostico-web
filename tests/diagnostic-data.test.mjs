import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadGeneratedAreas(fileName) {
  const source = (await readFile(new URL("../app/data/" + fileName, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const startMarker = "export const diagnosticAreas: DiagnosticArea[] = ";
  const endMarker = ";\n\nexport const diagnosticQuestions";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "No se encontró el banco generado");
  return JSON.parse(source.slice(start + startMarker.length, end));
}

async function loadManifest() {
  return JSON.parse(await readFile(new URL("../CuestionarioDiagnóstico/Banco v2/manifest.json", import.meta.url), "utf8"));
}

test("el banco v1 conserva 13 áreas y 195 preguntas únicas", async () => {
  const areas = await loadGeneratedAreas("questions.generated.ts");
  const questions = areas.flatMap((area) => area.questions);
  assert.equal(areas.length, 13);
  assert.equal(questions.length, 195);
  assert.equal(new Set(questions.map((question) => question.id)).size, 195);
});

test("cada área v1 conserva cinco preguntas por nivel y tres alternativas", async () => {
  const areas = await loadGeneratedAreas("questions.generated.ts");
  for (const area of areas) {
    assert.equal(area.questions.length, 15, area.name);
    for (const level of ["essential", "applied", "deepening"]) {
      assert.equal(area.questions.filter((question) => question.level === level).length, 5, area.name + ": " + level);
    }
    for (const question of area.questions) {
      assert.deepEqual(question.options.map((option) => option.key), ["A", "B", "C"], question.id);
      assert.ok(["A", "B", "C"].includes(question.correctOption), question.id);
      assert.ok(question.explanation.length > 0, question.id);
    }
  }
});

test("el banco v2 visible y la salida de la aplicación no están desincronizados", async () => {
  const output = execFileSync(process.execPath, ["scripts/generate-question-data-v2.mjs", "--check"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  assert.match(output, /"checked":true/);

  const manifest = await loadManifest();
  const areaFiles = (await readdir(new URL("../CuestionarioDiagnóstico/Banco v2/Áreas/", import.meta.url)))
    .filter((fileName) => fileName.endsWith(".md"));
  const keyFiles = (await readdir(new URL("../CuestionarioDiagnóstico/Banco v2/Claves/", import.meta.url)))
    .filter((fileName) => fileName.endsWith(".md"));
  assert.equal(manifest.areas.length, 13);
  assert.equal(areaFiles.length, 13);
  assert.equal(keyFiles.length, 13);
});

test("el banco v2 cumple la matriz de 24 preguntas y puntajes coherentes", async () => {
  const [areas, manifest] = await Promise.all([
    loadGeneratedAreas("questions.v2.generated.ts"),
    loadManifest(),
  ]);
  const questions = areas.flatMap((area) => area.questions);
  assert.equal(areas.length, 13);
  assert.equal(questions.length, 312);
  assert.equal(new Set(questions.map((question) => question.id)).size, 312);
  assert.ok(questions.filter((question) => question.itemType === "graded-judgment").length >= 78);
  assert.equal(questions.filter((question) => question.options.length === 4).length, 117);

  for (const area of areas) {
    const definition = manifest.areas.find((candidate) => candidate.id === area.id);
    assert.ok(definition, area.id);
    assert.equal(definition.subcompetencies.length, 4, area.name);
    assert.equal(area.questions.length, 24, area.name);
    assert.equal(area.questions.filter((question) => question.isAnchor).length, 4, area.name + ": anclas");
    for (const level of ["essential", "applied", "deepening"]) {
      const levelQuestions = area.questions.filter((question) => question.level === level);
      assert.equal(levelQuestions.length, 8, area.name + ": " + level);
      for (const subcompetency of definition.subcompetencies) {
        assert.equal(
          levelQuestions.filter((question) => question.subcompetencyId === subcompetency.id).length,
          2,
          area.name + ": " + level + "/" + subcompetency.id,
        );
      }
    }
    for (const question of area.questions) {
      const expectedKeys = ["A", "B", "C", "D"].slice(0, question.options.length);
      assert.ok(question.options.length >= 3 && question.options.length <= 4, question.id);
      assert.deepEqual(question.options.map((option) => option.key), expectedKeys, question.id);
      const normalizedOptions = question.options.map((option) => option.text
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("es")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim());
      assert.equal(new Set(normalizedOptions).size, normalizedOptions.length, question.id + ": alternativas duplicadas");
      assert.ok(normalizedOptions.every((option) => !/^(todas? las anteriores|ninguna(?: de)? las anteriores)\b/.test(option)), question.id + ": alternativa meta");
      assert.ok(question.options.some((option) => option.points > 0), question.id);
      assert.equal(Math.max(...question.options.map((option) => option.points)), question.maxPoints, question.id);
      assert.ok(question.options.find((option) => option.key === question.correctOption)?.points === question.maxPoints, question.id);
      assert.ok(question.subcompetencyId, question.id);
      assert.ok(question.version >= 1, question.id);
    }
  }

  const addedQuestions = questions.filter((question) => !question.sourceRefs.includes("CuestionarioDiagnóstico/Áreas"));
  assert.equal(addedQuestions.length, 117);
  assert.ok(addedQuestions.every((question) => question.status === "pilot"));
  assert.ok(addedQuestions.every((question) => question.options.length === 4));
});
