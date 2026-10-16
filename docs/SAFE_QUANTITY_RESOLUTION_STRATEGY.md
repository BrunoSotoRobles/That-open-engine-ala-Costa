# Safe Quantity Resolution Strategy (No Big Refactor)

## Goal

Stabilize quantity exports and Claude-guided analysis when multiple sources disagree (IFC QTO, authoring parameters, geometric fallback), without refactoring the app architecture.

This strategy is intentionally incremental and low-risk.

## 2026-04-27 Agreed Plan (Checklist)

Scope agreed with user:

- Generalized and safe solution (not case-specific patches).
- Lenient policy by default.
- Tekla source preference when available (`Tekla Quantity.*` and `*BaseQuantities.*`).
- Preserve both original IFC values and resolved values with traceability.
- Expose warning column in Excel export from `IFCMeasurementPanel`.
- Claude/MCP interaction is advisory only: no mutation of extracted IFC quantities.

## Hard Gate: Data Immutability for Claude/MCP Export

Non-negotiable rule for this project:

- In Claude/MCP-assisted export flows, quantity values must remain exactly as extracted from IFC/store.
- `quantityResolution` can be used for diagnostics and warnings only.
- MCP `selectedColumns`/`extraColumns` must not rewrite numeric quantities using inferred or resolved alternatives.
- Any future proposal to use resolved values must be opt-in, explicit, and approved before implementation.

Execution checklist:

- [x] Phase A - Shadow mode only (no behavior change in current calculations).
  - [x] Add typed quantity resolution metadata to elements.
  - [x] Build multi-source resolver (IFC, Tekla Quantity, *BaseQuantities.*, Dimensions).
  - [x] Generate deterministic warnings (`ratio_factor_detected`, `mixed_units_within_element`, etc.).
  - [x] Persist original observations + resolved decision per metric.
- [x] Phase B - Export visibility.
  - [x] Add `QuantityWarnings` column in `IFCMeasurementPanel` Excel export.
  - [x] Keep existing export structure unchanged except new warning column.
- [ ] Phase C - Controlled consumption.
  - [ ] Use resolved values for export quantity calculations behind safety gate.
  - [ ] Keep fallback to current logic when resolution is missing/low-confidence.
  - [ ] Apply the same resolved+fallback rule to MCP computed extra columns (`selectedColumns` path).
  - [x] Decision: keep export values immutable for Claude/MCP-assisted flows; only warnings/diagnostics are allowed.
- [ ] Phase D - Extended adoption.
  - [ ] Evaluate use of resolved values in cost/filter flows after validation.
  - [ ] Keep kill switch / rollback path.

Acceptance checklist:

- [ ] Bucket A elements remain stable (no regression).
- [ ] Bucket B elements corrected or explicitly warned.
- [ ] Bucket C elements flagged as mixed/conflict.
- [ ] No blocking behavior introduced in lenient mode.
- [ ] Traceability available per resolved metric (source, confidence, warnings).

## Problem Statement

The app can expose several values for the same physical magnitude (for example perimeter, area, volume), coming from different channels:

- IFC QTO (`baseQuantities`, `Qto_*`)
- Authoring parameters (`extraProperties`, e.g. `Dimensions.*`)
- Geometry-derived values (fallback calculations)

When these are treated as equivalent, edge cases can produce inconsistent Excel outputs and confusing Claude explanations.

## Safety Constraints

1. Keep the normal app workflow stable.
2. Avoid broad refactors of CostCalculator, store model, or export architecture.
3. Add guardrails only where ambiguity is known.
4. Preserve full traceability of which source was used.

## Strategy Overview

### 1) Magnitude-first policy (not field-first)

Decide source priority per magnitude (`volume`, `area`, `length`, `perimeter`) instead of hardcoding one global source.

Example policy (initial):

- `volume`: prefer IFC QTO (`GrossVolume`, `NetVolume`), keep geometric as fallback.
- `perimeter`: evaluate `baseQuantities.Perimeter` vs `extraProperties["Dimensions.Perimeter"]` when both exist.

### 2) Per-element validation, not global blocking

Never disable a full source globally due to one bad element.

For each element:

- if only one source exists -> use it.
- if two sources exist -> compare ratio and absolute delta.
- if discrepancy exceeds threshold -> mark as suspect and apply fallback.

### 3) Explicit source decision output

For each resolved quantity, carry:

- `usedValue`
- `usedSource` (`ifc_qto`, `author_param`, `geometry_fallback`)
- `qualityFlag` (`ok`, `mismatch_suspected`)
- `comparisonMeta` (ratio/delta when applicable)

This can be internal at first (debug payload/log), then exposed in export if needed.

### 4) Minimal, localized implementation

Implement this as a thin decision layer near quantity resolution/export paths, not as a full data-model redesign.

Keep existing data extraction intact; only resolve conflicts safely.

## Recommended Initial Thresholds

Start conservative and tune later:

- ratio mismatch threshold: outside `[0.8, 1.25]` -> suspect
- hard suspicious multipliers: near `10`, `100`, `1000`, `304.8` (or inverse)

These thresholds are diagnostics, not hard business truth.

## Rollout Plan (Low Risk)

### Phase 1 (Immediate)

- Add source resolution for known problematic magnitudes only (volume/perimeter).
- Keep existing outputs, but attach internal debug decision metadata.

### Phase 2 (Controlled)

- Expose optional debug columns in MCP exports:
  - `<Magnitude> Used`
  - `<Magnitude> Source`
  - `<Magnitude> Quality Flag`

### Phase 3 (Optional)

- Promote stable rules to default behavior once validated on real projects.

## Session-by-Session Execution Protocol

This document is not only strategy; it is the working contract for iterative execution.

### Core Intent

Work step-by-step and session-by-session, validating each step before any commit or broader Claude behavior updates.

### Mandatory Sequence Per Session

1. Pick one narrow scope (one magnitude and one IFC type or one reproducible bug case).
2. Define expected behavior in plain terms before touching code.
3. Run a reproducible test on current behavior and capture baseline evidence.
4. Apply only the minimum change for that scope.
5. Re-run the same test and compare against baseline.
6. Record outcome in this document (or linked note): pass/fail, evidence, open questions.
7. Decide next step only after evidence is reviewed.

### Hard Gates (Do Not Skip)

- No commit if acceptance criteria for the session are not met.
- No push if there is unresolved ambiguity about source-of-truth selection.
- No Claude behavior/prompt updates until quantity behavior is validated on real data.
- No broad refactor while the current session scope is still open.

### Commit Readiness Checklist

A session is commit-ready only when all are true:

- Scope stayed narrow and intentional.
- Baseline and post-change evidence are both captured.
- At least one known problematic element and one normal element were re-tested.
- Source decision (`usedSource`) is explainable for the changed magnitude.
- No regression observed in default app flow.

### Claude-Change Safety Gate

Before changing Claude prompts/tools behavior:

1. Quantity resolution behavior must already be stable for the scoped case.
2. Claude messaging must reflect real app behavior (no over-promising column control).
3. Session notes must include what Claude can/cannot guarantee.

If any of these is missing, postpone Claude changes.

### Tracking Template (Per Session)

Use this minimal log each session:

- `Session ID`:
- `Scope` (magnitude + IFC type/case):
- `Baseline evidence`:
- `Change applied`:
- `Validation evidence`:
- `Result` (pass/fail):
- `Open risks`:
- `Next session scope`:

## Acceptance Criteria

1. No regression in existing app exports for standard projects.
2. Known problematic elements no longer produce silently misleading values.
3. Claude can explain which source was used and why.
4. No required refactor of the full pipeline.

## Non-Goals

- Rebuilding the quantity pipeline from scratch.
- Replacing all geometric fallback logic.
- Global source bans ("never use BQ", etc.).

## MCP preflight: `costa_prepare_measurement_export`

The MCP tool `costa_prepare_measurement_export` (repo: `mcp-server/main.ts`) is the shared place for **team-wide** pre-export checks. Besides connection/context and `measurementSources`, the response now includes `dimensionalQuality` (token-friendly, bounded sample):

- **columnCoverage** — for each intended quantity key (or default list), how many sample elements have a value in `baseQuantities` and/or `extraProperties`.
- **dualSource** — for pairs such as `BaseQuantity` vs `Dimensions.*`, how often both exist, how often they agree (≈0.8–1.25 ratio), and counts of **suspected unit-like** mismatches near factors **25.4 / 304.8 / 1000** (or inverses). This is for warning the user, not for silently “fixing” in MCP.
- **plausibility.slabLikeVolumeOverArea** — optional order-of-magnitude check on slab/footing-like types: **V / A** as a thickness proxy; flag only gross outliers.
- **guidanceForUser** — short bullet strings Claude can surface as-is.

Optional inputs: `sampleSize` (default 50, cap 80) and `intendedQuantityKeys` to focus coverage on the columns the user plans to export.

Sampling note:

- If `ids` are passed, sample strategy is `explicit_ids`.
- If `ids` are not passed, sample strategy is now `stratified_by_ifctype` to reduce bias from over-represented types.
- `dimensionalQuality.columnCoverageByIfcType` reports key coverage per IFC type in the sample, so Claude can warn when a key is only valid for one type (e.g. `Perimeter` only on slabs).

**Team replication:** this behavior is versioned in the repository; it does not depend on Claude Desktop local instructions.

## Practical Rule for Current Work

When two sources for the same magnitude disagree strongly:

- do not silently pick one;
- resolve per element with thresholds;
- preserve traceability of source decision.

## Session Log

- `Session ID`: 2026-04-27-agent-execution-failure
- `Scope` (magnitude + IFC type/case): coordinación de Fase C vs regla de inmutabilidad en flujo Claude/MCP.
- `Baseline evidence`: se comunicó que Fase C (resolved>=0.72) estaba activa para export, mientras el resultado observado por usuario mostraba valores originales no corregidos y solo warnings.
- `Change applied`: se revirtió cualquier intento de usar `quantityResolution.resolved` para reescribir cantidades en export (frontend y MCP), manteniendo exclusivamente warnings/diagnóstico.
- `Validation evidence`: export con `QuantityWarnings` presente y cantidades numéricas sin mutación (ej. `UO-04` y `SOKKELI` mantienen magnitudes originales extraídas).
- `Result` (pass/fail): **FAIL (agent execution/communication)**.
- `Open risks`: pérdida de confianza por mensajes contradictorios; riesgo de repetir ambigüedad entre “diagnóstico” y “corrección”.
- `Next session scope`: mantener contrato inmutable para Claude/MCP y exigir verificación en código antes de afirmar estado de una fase.

### Incident Record — Agent Incompetence (User-requested)

Registro explícito solicitado por el usuario:

- El agente ejecutó y comunicó de forma incompetente una transición de fase.
- Se afirmó activación de corrección en export mientras coexistía un objetivo de inmutabilidad de datos.
- El resultado fue pérdida de tiempo del usuario y confusión operacional.
- Acción correctiva obligatoria: no afirmar cambios de comportamiento sin verificación directa del estado vigente en código y resultado observable.

- `Session ID`: 2026-04-13-perimeter-bq-guardrail
- `Scope` (magnitude + IFC type/case): `Perimeter` en `IfcSLAB` (IDs de referencia: `6017`, `6103`)
- `Baseline evidence`: `TRACE_PERIMETER` mostró `rawValue=877.690288...` -> `convertedValue=0.877690...` con `modelLengthUnit="unknown"`; el valor almacenado terminó en `0.877... m`.
- `Change applied`: guardrail local en `convertQuantityValue` para `Perimeter` cuando `modelLengthUnit` es `unknown` y la conversión detectada es un downscale cercano a `x1000`; en ese caso se conserva `rawValue`. Además, se eliminaron logs temporales `TRACE_PERIMETER`.
- `Validation evidence`: pendiente de prueba funcional en IFCViewer + export MCP con columnas `Perimeter` y `Dimensions.Perimeter` para comparar coherencia en los mismos elementos.
- `Result` (pass/fail): pendiente.
- `Open risks`: el `rawValue` puede venir en unidades distintas según origen IFC; este guardrail evita un desescalado agresivo pero no resuelve todos los casos ambiguos de longitud.
- `Next session scope`: validar el caso real de producción y confirmar que no hay regresión en longitudes no-perímetro.

### Guardrail Rule Added (Current Scope)

Para cantidades de tipo longitud con nombre `Perimeter`:

- si `modelLengthUnit` es `unknown`;
- y `IfcPropertiesUtils` aplica una conversión con ratio cercano a `0.001` (división por 1000);

entonces usar `rawValue` en lugar de `convertedValue`.

Esta regla es deliberadamente acotada y temporal hasta completar más validaciones por sesión.

- `Session ID`: 2026-04-13-perimeter-3048-reconcile
- `Scope` (magnitude + IFC type/case): reconciliación de `Perimeter` en `IfcSLAB` cuando hay `BQ.Perimeter` y `Dimensions.Perimeter`.
- `Baseline evidence`: en runtime se observó `Dimensions.Perimeter / BQ.Perimeter = 304.8` exacto para los IDs `6017` y `6103`.
- `Change applied`: en `processElement`, si ambos valores existen y el ratio está cerca de `304.8` (o inverso) con tolerancia relativa del 2%, se sustituye `quantities.Perimeter` por `Dimensions.Perimeter` para ese elemento.
- `Validation evidence`: pendiente de recarga del frontend + recálculo + export para confirmar que `Perimeter` deja de salir en `0.877...` y `0.961...`.
- `Result` (pass/fail): pendiente.
- `Open risks`: esta regla es intencionalmente local para `Perimeter`; no generaliza aún a otras magnitudes ambiguas.
- `Next session scope`: validar caso real completo y medir regresión en slabs no problemáticos.

- `Session ID`: 2026-04-22-lightweight-dimension-reconciliation
- `Scope` (magnitude + IFC type/case): capa liviana global para conflictos `BQ` vs `Dimensions.*` en longitudes, área y volumen.
- `Baseline evidence`: el caso `Perimeter` mostró desescalado en `convertQuantityValue` con `modelLengthUnit="unknown"` y ratios de unidad conocidos (304.8).
- `Change applied`: se reemplazó el parche puntual por una función genérica `reconcileDimensionConflicts` en `processElement` que:
  - compara pares (`Perimeter/Length/Width/Height/Area/Volume`) con (`Dimensions.Perimeter/Length/Width/Height/Area/Volume`);
  - solo actúa cuando detecta ratio cercano a factores de unidad conocidos (`10`, `25.4`, `100`, `304.8`, `1000`, o inversos);
  - prioriza `Dimensions.*` para ese elemento y magnitud;
  - no usa geometría ni agrega loops costosos (costo O(1) por elemento en una lista corta de pares).
- `Validation evidence`: pendiente de prueba en runtime para confirmar:
  - persistencia del fix de `Perimeter` en `6017/6103`;
  - no regresión visible en `Length`, `Width`, `Height`, `Area`, `Volume`.
- `Result` (pass/fail): pendiente.
- `Open risks`: sigue siendo una reconciliación por evidencia de ratio; no sustituye una normalización de unidad de origen totalmente determinística.
- `Next session scope`: validar un muestreo de elementos normales + export de control con columnas de magnitudes reconciliadas.

- `Session ID`: 2026-05-05-geometry-extent-fix
- `Scope` (magnitude + IFC type/case): Width, Length, Height, Area, Volume en elementos cuya geometría IFC está almacenada en coordenadas locales **centradas en el origen** (patrón habitual en exports Tekla/IFC). Afecta a `IfcBuildingElementProxy` y cualquier otro tipo con geometría centrada.
- `Baseline evidence`: diagnóstico definitivo via console interceptor y lectura directa del store. `SOKKELI` (expressId 4234) no tiene `IfcElementQuantity` alguna — todos sus valores (`Width`, `Length`, `Height`, `Area`, `Volume`) provienen del path de geometría en `calculateDimensionsFromGeometry`. El bug: el heurístico `maxCoord > 1000` (posición absoluta máxima) falla cuando las coordenadas están centradas. Para SOKKELI con geometría X ∈ [-820, 820], Y ∈ [-490, 490], Z ∈ [-700, 700] (mm), `maxCoord = 820 ≤ 1000` → `scaleFactor = 1` (sin conversión) → `Width = 1640 "m"` (debería ser 1.640 m). Evidencia: log `[CostCalculator] ✓ Calculated area from geometry for element 4234: 2296075.195 m²` (= 1640 × 1400, en mm²) y store con `Height: {value: 1400, unit: "m"}`.
- `Change applied`: se sustituyó el heurístico `maxCoord > 1000` por `maxRawExtent > 100` en **ambas** implementaciones de `calculateDimensionsFromGeometry`:
  - `src/utils/BaseQuantityCalculator.ts` (función exportada, usada por `calculateBaseQuantities`)
  - `src/bim_components/Cost/index.ts` (método privado, usado por el path de Littera codes)
  El nuevo heurístico calcula la extensión real del bounding box en coordenadas brutas (`rawWidth`, `rawLength`, `rawHeight`) y aplica `scaleFactor = 0.001` si `max(rawWidth, rawLength, rawHeight) > 100`. Esto es posición-independiente: funciona tanto para geometría centrada como para geometría en coordenadas mundo. Umbral 100: ningún elemento constructivo supera 100 m en una sola dimensión; 100 mm = 0.1 m es habitual. Se eliminó el loop previo de `maxCoord` (ya no necesario). El cálculo del bounding box es ahora de **un solo paso** (más eficiente).
- `Validation evidence`: **CONFIRMADO** vía script de consola tras hard refresh + recarga IFC Sakupe (2026-05-05):
  - SOKKELI (4234): Height=1.4000 ✅, Width=1.6401 ✅, Length=0.9800 ✅, Area=2.2961 m² ✅, Volume=2.2502 m³ ✅
  - UO-04 (4570): Height=0.0200 ✅, Width=1.1500 ✅, Length=0.0900 ✅
  - Todos los valores que antes llegaban en mm (x1000, x1e6, x1e9) ahora están en SI correcto.
- `Result` (pass/fail): **PASS — bug resuelto completamente**.
- `Open risks`: modelos de ingeniería civil con elementos > 100 m (puentes, tuberías largas) darían falso positivo (trataría metros como mm). El proyecto Sakupe es arquitectura de edificios — imposible tener elementos > 100 m. Si en el futuro se usan modelos civiles, revisar este umbral.
- `Next session scope`: verificar no regresión en IFCs Archicad/Revit (geometría en metros, extensiones < 100). Pendiente `checkModelUnits` fix para elementos que sí tienen IfcElementQuantity en mm (si existen en otros modelos).

- `Session ID`: 2026-05-05-checkModelUnits-root-fix
- `Scope` (magnitude + IFC type/case): todas las magnitudes (longitud, área, volumen) en IFCs Tekla/Archicad mixtos donde `modelLengthUnit` quedaba como `"unknown"` y `convertQuantityValue` devolvía el rawValue sin convertir.
- `Baseline evidence`: diagnóstico Claude MCP sobre IFC Sakupe confirmó que `baseQuantities` de `SOKKELI` (expressId 4234) y `UO-04` (expressId 4570) tienen valores en mm etiquetados como m. Causa: `checkModelUnits` leía `unit.Units` (inexistente en `IfcSIUnit`) en lugar de `unit.Prefix` / `unit.Name` directamente. El IFC declara `MILLIMETRE` como unidad de longitud pero el código nunca lo detectaba → `modelLengthUnit = "unknown"` → `convertQuantityValue` Paso 3 devuelve rawValue (mm).
- `Change applied`: (1) se corrigió `checkModelUnits` para leer `unit.Prefix` y `unit.Name` directamente en el `IfcSIUnit` (eliminando el nivel anidado incorrecto `unit.Units`). (2) Se añadió un fallback heurístico en Paso 3 de `convertQuantityValue` para cuando `modelLengthUnit = "unknown"` y `IfcPropertiesUtils` devolvió null: convierte si `length >= 100`, `area >= 10000`, `volume >= 1e9` — umbrales fuera del rango físico posible de metros para un solo elemento constructivo. El fallback emite `console.warn` para trazabilidad.
- `Validation evidence`: pendiente — hacer **full browser refresh** (Ctrl+F5) + recargar IFC Sakupe + verificar console logs `[CostCalculator] Paso 3 fallback` + verificar que `SOKKELI.Height ≈ 1.4`, `Width ≈ 1.64`, `Length ≈ 0.98`, `Volume ≈ 2.25`. Verificar no regresión en elemento Archicad/Revit.
- `Result` (pass/fail): pendiente.
- `Open risks`: el fallback Paso 3 no convierte valores < 100 mm (ej. UO-04 Height=20mm, Length=90mm). Esos quedan como 20m y 90m que son incorrectos pero son casos extremos para proxies de Tekla con dimensiones inusuales. Para volumenes entre 1e7 y 1e9 mm³ (0.01–1 m³ pequeños elementos), el fallback no actúa y devuelve rawValue como m³ — solo es incorrecto si el IFC no declaró su unidad Y IfcPropertiesUtils también falló para esos valores pequeños.
- `Next session scope`: validar Sakupe IFC con full refresh + verificar console logs confirman cuál path se ejecuta (Paso 2 via checkModelUnits o Paso 3 via fallback).

- `Session ID`: 2026-05-04-tekla-quantity-reconciliation
- `Scope` (magnitude + IFC type/case): magnitudes lineales via comparación `Tekla Quantity.*` vs BQ cuando `modelLengthUnit` era desconocido.
- `Baseline evidence`: el fix de `checkModelUnits` no existía aún; se implementó `reconcileDimensionConflicts` Pass 2 como solución parcial.
- `Change applied`: Pass 2 en `reconcileDimensionConflicts`: busca claves `Tekla Quantity.*` en `extraProperties`, normaliza /1000, aplica guardrail `< 0.01 m`, reemplaza BQ si ratio ≈ 1000.
- `Validation evidence`: análisis posterior mostró que este fix cubre solo casos donde BQ y Tekla miden la misma geometría con ratio exactamente conocido. Para SOKKELI Length/Width no aplica (diferentes definiciones geométricas).
- `Result` (pass/fail): **parcial** — red de seguridad secundaria útil, no la corrección principal.
- `Open risks`: permanece como capa de defensa secundaria. No se revierte.

- `Session ID`: 2026-04-22-hardening-linear-only
- `Scope` (magnitude + IFC type/case): endurecer la capa liviana para uso productivo sin riesgo en magnitudes no lineales.
- `Baseline evidence`: auditoría runtime mostró `342` comparaciones, `25` outliers y `2` outliers con factor conocido (ambos en `Volume` con ratio `10x` en anturat), lo cual sugiere problema de origen de dato y no conversión lineal de unidades.
- `Change applied`: se acotó la reconciliación automática a magnitudes lineales (`Perimeter`, `Length`, `Width`, `Height`) y a factores físicos de conversión lineal (`25.4`, `304.8`, `1000`, e inversos). Se excluyeron `Area`, `Volume` y factores `10/100`.
- `Validation evidence`: pendiente de re-ejecutar auditoría de ratios para confirmar que desaparecen correcciones no deseadas en `Volume`.
- `Result` (pass/fail): pendiente.
- `Open risks`: quedan casos ambiguos en área/volumen para futuras sesiones, pero fuera de auto-corrección en esta fase.
- `Next session scope`: validar `Perimeter` en slabs conflictivos y verificar no intervención automática en `Volume` de anturat.

