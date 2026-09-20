# Banco v2 — fuente editable de la aplicación

Este es el banco que utiliza la aplicación web. Contiene 13 áreas y 312 preguntas: 24 por área, divididas en 8 esenciales, 8 aplicadas y 8 de profundización.

Cada área declara cuatro subcompetencias. La matriz de cobertura garantiza dos preguntas por cada combinación de nivel y subcompetencia.

- [Preguntas por área](Áreas/)
- [Claves, puntajes y explicaciones](Claves/)
- [Manifiesto de áreas y subcompetencias](manifest.json)

## Qué significa cada estado

- **Activo:** pregunta heredada del banco inicial y disponible en la ruta.
- **Piloto:** pregunta añadida o reformulada para v2. Está disponible para explorarla, pero debe revisarse temáticamente antes de usar sus resultados como evidencia formal.

Las 117 preguntas añadidas se mantienen como piloto y tienen cuatro alternativas plausibles, con crédito parcial cuando una decisión es razonable pero incompleta. Las 195 preguntas heredadas conservan tres alternativas para no alterar artificialmente el banco inicial. La próxima revisión editorial debe priorizar la revisión temática de las preguntas piloto.

## Criterio de calidad de las alternativas

Una alternativa incorrecta debe representar una decisión, concepto o confusión que una persona que está aprendiendo podría considerar razonable; no debe ser una frase absurda ni una pista sobre cuál es la respuesta esperada. Al revisarlas:

- mantén alternativas de la misma categoría, tono y extensión aproximada;
- evita absolutismos que delaten el error, como “siempre”, “nunca”, “garantiza” o “por completo”, salvo que formen parte necesaria del concepto evaluado;
- evita “todas las anteriores”, “ninguna de las anteriores” y pistas gramaticales;
- en ítems con crédito parcial, reserva el puntaje intermedio para una acción útil pero insuficiente, no para un error evidente;
- contrasta los ítems piloto con personas reales: que una alternativa parezca plausible no prueba todavía su dificultad ni su capacidad de discriminar.

## Editar sin desincronizar la aplicación

1. Edita el enunciado y las alternativas en `Áreas/`.
2. Actualiza la respuesta, puntajes y explicación de la misma pregunta en `Claves/`.
3. Conserva los comentarios `diagnostic-v2-question` y `diagnostic-v2-key`: contienen los metadatos que valida el generador.
4. Ejecuta `npm run data:generate:v2` y luego `npm run data:check:v2`.

El directorio superior `CuestionarioDiagnóstico/Áreas` conserva el banco v1 de 195 preguntas como antecedente histórico. No es la fuente del banco v2 de la aplicación.
