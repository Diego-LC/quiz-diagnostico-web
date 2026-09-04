import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadGeneratedAreas() {
  const source = (await readFile(
    new URL("../app/data/questions.generated.ts", import.meta.url),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const startMarker = "export const diagnosticAreas: DiagnosticArea[] = ";
  const endMarker = ";\n\nexport const diagnosticQuestions";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "No se encontró el banco generado");
  return JSON.parse(source.slice(start + startMarker.length, end));
}

async function loadGeneratedV2Areas() {
  const source = (await readFile(
    new URL("../app/data/questions.v2.generated.ts", import.meta.url),
    "utf8",
  )).replace(/\r\n/g, "\n");
  const startMarker = "export const diagnosticAreas: DiagnosticArea[] = ";
  const endMarker = ";\n\nexport const diagnosticQuestions";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "No se encontró el banco v2 generado");
  return JSON.parse(source.slice(start + startMarker.length, end));
}

test("el banco contiene 13 áreas y 195 preguntas únicas", async () => {
  const areas = await loadGeneratedAreas();
  const questions = areas.flatMap((area) => area.questions);
  assert.equal(areas.length, 13);
  assert.equal(questions.length, 195);
  assert.equal(new Set(questions.map((question) => question.id)).size, 195);
});

test("cada área conserva cinco preguntas por nivel y tres alternativas", async () => {
  const areas = await loadGeneratedAreas();
  for (const area of areas) {
    assert.equal(area.questions.length, 15, area.name);
    for (const level of ["essential", "applied", "deepening"]) {
      assert.equal(
        area.questions.filter((question) => question.level === level).length,
        5,
        `${area.name}: ${level}`,
      );
    }
    for (const question of area.questions) {
      assert.deepEqual(
        question.options.map((option) => option.key),
        ["A", "B", "C"],
        question.id,
      );
      assert.ok(["A", "B", "C"].includes(question.correctOption), question.id);
      assert.ok(question.explanation.length > 0, question.id);
    }
  }
});

test("el banco v2 contiene 13 áreas, 24 preguntas por área y cuatro alternativas cuando corresponde", async () => {
  const areas = await loadGeneratedV2Areas();
  const questions = areas.flatMap((area) => area.questions);
  assert.equal(areas.length, 13);
  assert.equal(questions.length, 312);
  assert.equal(new Set(questions.map((question) => question.id)).size, 312);
  assert.ok(questions.filter((question) => question.itemType === "graded-judgment").length >= 78);
  assert.ok(questions.some((question) => question.options.length === 4));
  for (const area of areas) {
    assert.equal(area.questions.length, 24, area.name);
    for (const level of ["essential", "applied", "deepening"]) {
      assert.equal(area.questions.filter((question) => question.level === level).length, 8, `${area.name}: ${level}`);
    }
    for (const question of area.questions) {
      assert.ok(question.options.length >= 3 && question.options.length <= 4, question.id);
      assert.ok(question.options.some((option) => option.points > 0), question.id);
      assert.ok(question.maxPoints >= 1, question.id);
      assert.equal(Math.max(...question.options.map((option) => option.points)), question.maxPoints, question.id);
      assert.ok(question.subcompetencyId, question.id);
      assert.ok(question.version >= 1, question.id);
    }
  }
});
