# Brújula TIC

Aplicación web interactiva para responder el cuestionario de diagnóstico de áreas TIC.

## Qué hace

- presenta una primera pasada de 65 preguntas esenciales;
- registra respuesta, confianza y tiempo activo por pregunta;
- solicita tres valoraciones de interés al terminar cada área;
- propone hasta cuatro áreas para el nivel aplicado y hasta dos para profundización;
- genera resultados por área y nivel, sin reducir el perfil a una sola nota;
- guarda el avance en el almacenamiento local del navegador;
- permite descargar los resultados en JSON e imprimir el resumen.

El tiempo no limita ni penaliza. El contador se pausa manualmente y deja de avanzar cuando la pestaña no está visible.

## Ejecutar en local

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

La aplicación queda disponible normalmente en `http://localhost:3000`.

## Mantener sincronizado el banco

Las preguntas se leen desde `../CuestionarioDiagnóstico/Áreas` y las respuestas desde `../CuestionarioDiagnóstico/Claves`.

```bash
npm run data:generate
```

El generador comprueba 13 áreas, 15 preguntas por área, tres alternativas, claves asociadas e identificadores únicos.

## Validación

```bash
npm run lint
npm test
```

`npm test` compila la aplicación y verifica la estructura completa del banco generado.
