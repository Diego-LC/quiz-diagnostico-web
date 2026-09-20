# Brújula TIC

Aplicación web interactiva para responder el cuestionario de diagnóstico de áreas TIC.

## Qué hace

- ofrece cuatro rutas: panorámica (52 preguntas), recomendada adaptativa (76–114), profunda (152 de base) y enfoque manual (24 por área);
- utiliza un banco v2 de 312 preguntas (24 por área, ocho por nivel), con metadatos de subcompetencia, proceso cognitivo, versión, trazabilidad y estado de revisión;
- registra respuesta, confianza y tiempo activo por pregunta;
- solicita tres valoraciones de interés al terminar cada área;
- propone hasta cuatro áreas para el nivel aplicado y hasta dos para profundización;
- genera resultados por área y nivel, sin reducir el perfil a una sola nota;
- solicita un nombre para crear un perfil local y guarda el avance en el almacenamiento local del navegador;
- muestra el tiempo de la pregunta actual y el tiempo empleado en la respuesta anterior;
- permite responder con teclado (`1`–`4` o `A`/`B`/`C`/`D`), marcar confianza (`Q`/`G`, `W`, `E`/`S`) y pausar/reanudar (`P`), avanzando automáticamente;
- admite alternativas con crédito parcial en preguntas aplicadas y muestra puntaje ganado/posible además de aciertos binarios;
- activa comprobaciones adaptativas cuando la señal es intermedia, contradictoria o de baja confianza;
- guarda un historial local de intentos completados para comparar rutas y progreso;
- ofrece un tema claro u oscuro con cambio animado y preferencia guardada localmente;
- interpreta formato Markdown en preguntas, alternativas y explicaciones (por ejemplo, código entre comillas inversas);
- permite descargar los resultados en JSON e imprimir el resumen.

El tiempo no limita ni penaliza. El contador se pausa manualmente y deja de avanzar cuando la pestaña no está visible.
El perfil y el avance son locales a cada navegador y dispositivo; no constituyen una cuenta ni una sincronización en la nube.

## Ejecutar en local

Requiere Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

La aplicación queda disponible normalmente en `http://localhost:3000`.

## Mantener sincronizado el banco

El banco editable que utiliza la aplicación forma parte de este mismo repositorio:

- `CuestionarioDiagnóstico/Banco v2/Áreas`: preguntas mostradas por la aplicación;
- `CuestionarioDiagnóstico/Banco v2/Claves`: respuestas, puntajes y explicaciones;
- `CuestionarioDiagnóstico/Banco v2/manifest.json`: áreas y cuatro subcompetencias por área.

Los directorios `CuestionarioDiagnóstico/Áreas` y `Claves` preservan el banco v1 de 195 preguntas como antecedente; no alimentan la aplicación actual.

```bash
npm run data:generate       # banco original compatible
npm run data:generate:v2    # regenera la salida de la aplicación desde Banco v2
npm run data:check:v2       # comprueba que el Markdown y la salida estén sincronizados
```

El generador original comprueba 13 áreas, 15 preguntas por área, tres alternativas, claves asociadas e identificadores únicos. El generador v2 comprueba 13 áreas, 24 preguntas por área, 8 por nivel, cuatro subcompetencias y exactamente dos preguntas por cada combinación nivel × subcompetencia. También valida claves, puntajes y alternativas consecutivas A–C o A–D; las 117 preguntas v2 añadidas deben conservar cuatro alternativas y estado piloto hasta su revisión temática.

Después de editar una pregunta o clave v2, ejecuta `npm run data:generate:v2` antes de probar la aplicación. Las preguntas incorporadas se marcan como `pilot` hasta una revisión temática explícita; sus resultados no reemplazan una validación psicométrica o profesional.

## Licencias

- El código de la aplicación, scripts y pruebas se distribuye bajo [MIT](LICENSE).
- El banco de preguntas y el contenido educativo se distribuyen bajo [CC BY-NC-SA 4.0](LICENSE-CONTENIDOS.md).

Si incorporas material de terceros, conserva la atribución y la licencia que corresponda a su autoría.

## Validación

```bash
npm run lint
npm test
```

`npm test` compila la aplicación y verifica la estructura de los bancos original y v2, incluidos niveles, identificadores, opciones y puntajes.
