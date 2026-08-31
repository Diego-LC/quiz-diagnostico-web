import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadGeneratedAreas() {
  const source = await readFile(
    new URL("../app/data/questions.generated.ts", import.meta.url),
    "utf8",
  );
  const startMarker = "export const diagnosticAreas: DiagnosticArea[] = ";
  const endMarker = ";\n\nexport const diagnosticQuestions";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "No se encontró el banco generado");
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
