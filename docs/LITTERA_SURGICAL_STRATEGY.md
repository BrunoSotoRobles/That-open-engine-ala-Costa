# Littera Surgical Strategy (Excel/Store/IFC)

Objective: edit only Littera content for one target element/group without breaking Excel structure/format.

---

## Flujo Talo 2000 → IFC (escritura de clasificaciones)

### Herramientas involucradas

| Herramienta | Propósito |
|---|---|
| `costa_load_ifc` | Carga el IFC desde ruta de archivo — **OBLIGATORIO antes de escribir** |
| `costa_scan_elements_for_talo` | Escanea el modelo y devuelve grupos (ifcType + nombres reales) **sin asignar** |
| `costa_search_talo_catalog` | Claude busca el código Talo correcto en `src/data/talo2000.json` |
| `costa_write_ifc_classifications` | Escribe las clasificaciones en el IFC y genera archivo descargable |

### Flujo correcto paso a paso

```
1. Cargar IFC desde archivo
   → costa_load_ifc { path: "/ruta/al/modelo.ifc" }
   → Guarda ifcRawBuffer en memoria (necesario para exportar)

2. Escanear elementos (Claude razona sobre nombres reales)
   → costa_scan_elements_for_talo
   → Claude recibe: ifcType, count, nameVariants por grupo
   → Claude llama costa_search_talo_catalog para cada grupo
   → Claude propone mapeo: IfcDoor [Ulko-ovi] → 1.2.4.3 (Ulko-ovet)
                           IfcDoor [Sisäovi]  → 1.3.1.5 (Väliovet)

3. Usuario revisa y confirma

4. Escribir al IFC (dryRun:true primero, luego dryRun:false)
   → costa_write_ifc_classifications { elements: [...], dryRun: false }
   → Descarga automática: modelo-costa-classified.ifc
```

### Por qué costa_load_ifc es obligatorio para escribir

Cuando el IFC se carga desde **fragments cache** (`.frag`), solo existe la representación renderizable — no los bytes originales del archivo `.ifc`. Para exportar un IFC modificado se necesita el buffer raw, que solo está disponible cuando se carga desde el archivo original.

- **dryRun:true** → funciona con fragmentModel (no necesita buffer)
- **dryRun:false** → requiere `ifcRawBuffer` → usar `costa_load_ifc` primero

### Nota sobre confianza de sugerencias

Cuando el IFC se carga vía `costa_load_ifc` o selector de archivo (no fragments cache), `suggestTaloAssignments` opera con IFC type + nombre. Sin `baseQuantities` (disponibles solo desde CostStore/CostPage), la confianza es 0.7–0.85. Suficiente para el 90% de los tipos; para elementos ambiguos, Claude razona sobre los `nameVariants` reales.

---

## Product vision (Claude + user, not headless automation)

The target product is **not** an in-app “magic button” that replaces the user. The target is **reusable tooling** (MCP + WebSocket + surgical Excel writer) so that **Claude** can work **with the user** while Excel, IFC, and Store are linked:

1. User asks to improve Littera assignments.
2. Claude analyzes and **asks where to start** (which `IFC Type` / priority).
3. User chooses; Claude investigates, reports proposals, and **only then** edits Excel **after explicit approval** (`dryRun` → write).

The same workflow applies to **any** compatible IFC+Excel package (no hardcoded project). To resume across chat sessions: keep the **working Excel copy** path, the same IFC loaded in Costa, and note the **last `IFC Type` / batch** (optional: store a named checkpoint in app localStorage via existing review-checkpoint messages).

## Current validated checkpoint (stable)

This checkpoint is validated and should be used as the restart point:

1. `costa_ping_store_connection` works (`connected: true`, store loaded).
2. `costa_probe_excel_store_ifc_link` works and links one element across:
   - Excel group/littera/guid rows,
   - Store object,
   - IFC properties.
3. `costa_clone_excel_without_changes` produces byte-identical copy (`unchanged: true`, `bytesIn == bytesOut`).
4. `costa_set_littera_codes_for_guid_in_excel` and `costa_set_littera_codes_batch_in_excel`:
   - `dryRun: true` works,
   - `dryRun: false` writes in `inplace` mode (cell overwrite only, no row insert/delete).
5. `costa_improve_littera_in_excel` remains intentionally blocked (`WRITE_BLOCKED`).

## Write modes: inplace (vigente) vs v2 (legacy)

**`writeMode: "inplace"` — único modo seguro (política actual):**
- Sobreescribe celdas Littera Code en las filas existentes.
- Filas con código eliminado: se limpia la celda (la fila permanece).
- Nunca llama a `spliceRows` → preserva agrupaciones/outline nativas de Excel.
- Soportado en `costa_set_littera_codes_for_guid_in_excel` y `costa_set_littera_codes_batch_in_excel`.

**`writeMode: "v2"` — legacy, NO usar:**
- Inserta/elimina filas para cuadrar el conteo exacto de códigos.
- `spliceRows` rompe los metadatos de outline de Excel → formato corrupto.
- Existe en el código por compatibilidad histórica; los guiones de sesión prohíben su uso.

**Validación histórica de V2** (registrada para referencia, ya no aplica):
- Fuente: `measurement-ifc-2026-03-31.xlsx`, GUID `3wUI6iW6T9BhoVFf99fdG_`
- Los tres casos (add/edit/delete) funcionaron en un Excel sin agrupaciones nativas.
- Con archivos que tienen outline nativo (botones +/-), V2 corrompe el formato.

## Congruence analysis model (3 contexts) established

The congruence review method is now established and validated for at least one real case:
- Context 1: Excel (`IFC Type`, `Name`, `TALO Code`, current `Littera` set)
- Context 2: IFC/Store (GUID, type, name, key properties, quantities)
- Context 3: External semantic references (public web) for plausibility checks

Decision output contract per element:
- `currentLitteraCodes[]`
- `verdictByCode[]` (`coherente` / `dudoso` / `incongruente` + reason)
- `recommendedKeep[]`
- `recommendedRemove[]`
- `recommendedAdd[]`
- `overallVerdict`
- `confidence`

## Scale-up target (full model)

Current project scale:
- ~1732 elements in Store for this IFC session.

Next operational objective:
- Apply the same 3-context congruence analysis to all relevant elements (grouped by `IFC Type` + normalized `Name` + `TALO Code`) instead of single-element manual runs.
- Prioritize speed with batch execution and deterministic local sources first (Excel + IFC/Store + `littera.json`), using web references only as secondary validation for ambiguous groups.

Expected outcome at model scale:
- Fast audit matrix of all elements/groups with:
  - congruent sets,
  - suspicious/incongruent sets,
  - proposed keep/remove/add actions,
  - confidence ranking for execution order.

## Multi-project portability rules (IFC + Excel packages)

This workflow is intended to run across different IFC+Excel project packages, not only one dataset.

Portability constraints:
- No hardcoded GUIDs, project names, or file-specific assumptions.
- Inputs are always runtime-provided (`excelPath`, active IFC session in Store, optional `sheetName`).
- Grouping/matching stays semantic and reusable:
  - `IFC Type`
  - normalized `Name`
  - `TALO Code`
- Column detection is header-based (case-insensitive), with explicit error reporting when required columns are missing.
- If a specific element/group cannot be linked, skip that case with structured reason; continue batch.

Safety invariants (must hold in all projects):
- Edit only Littera rows inside target group block.
- Never modify existing `TALO Code` values.
- Never modify GUID row content.
- Inserted Littera rows populate only:
  - `IFC Type`
  - `Name`
  - `TALO Code`
  - `Littera Code`
- Non-essential value columns in inserted rows remain empty.

Execution model for Claude-assisted operation:
1. Analyze (read-only) -> produce proposed keep/remove/add per group.
2. User approval gate -> select accepted proposals.
3. `dryRun` preview -> verify row impacts before write.
4. Apply approved changes only -> surgical V2 write.
5. Emit machine-readable audit report (per group/GUID status).

This means: read/probe pipeline is healthy; inplace write is the active safe mode for all Littera edits.

## Why inplace write is used

Global write/re-serialization previously altered sheet presentation in unacceptable ways.
Row insert/delete (V2 legacy) breaks Excel native row grouping/outline metadata via `spliceRows`.
Inplace limits changes to Littera Code cell values only, leaving row structure untouched.

## Non-negotiable constraints

1. Do not edit original file directly.
2. Do not modify TALO column.
3. Do not modify GUID rows.
4. Only edit/add/remove Littera rows inside the target group block.
5. Preserve Excel structure and visual grouping.

## Inplace write operational condition

For `costa_set_littera_codes_for_guid_in_excel` and `costa_set_littera_codes_batch_in_excel` (`dryRun: false`, `writeMode: "inplace"`) to behave predictably:

- The target Littera rows must be identifiable by context columns: `IFC Type`, `Name`, `TALO Code`, `Littera Code`.
- Only the `Littera Code` cell is modified per row; all other columns remain untouched.
- If the group has fewer existing rows than requested codes: extra codes are silently dropped (no new rows created). Use `dryRun: true` first to confirm the row count.
- If the group has more existing rows than requested codes: surplus rows are cleared (Littera Code cell set to empty) but the rows remain in the sheet.

## Confirmed target case

- Element name: `VÄLIOVI VASIKALLINEN:MLO 10+3x21 EI30:1183630`
- GUID: `3wUI6iW6T9BhoVFf99fdG_`
- Existing Littera in block: `433045`
- Desired Littera codes: `433045`, `433065`

## Tools in scope

- `costa_ping_store_connection`
- `costa_get_ifc_types_in_store` (rank IFC types by count)
- `costa_probe_excel_store_ifc_link`
- `costa_analyze_littera_by_ifc_type` (candidate generator + semantic scorer + policy/approval payload)
- `costa_clone_excel_without_changes`
- `costa_set_littera_codes_for_guid_in_excel` (inplace write, single group)
- `costa_set_littera_codes_batch_in_excel` (inplace write, N groups)

## Keimola run: IfcDoor batches (documented)

**Batch 1 (full-batch, remove-only, no adds)** — completed:

- Working file: `measurement-ifc-2026-03-31-ifcdoor-fullbatch1.xlsx` (copy; original untouched).
- Scope: 5 groups, `overallVerdict: incongruente`, policy remove-only (`recommendedAdd` empty), excluded `manual-review` from write per run rules.
- Applied GUIDs (5): `1b5YKyGML0WO0Fji9ycSLb`, `306$a99ezB7BdJ7EFoMnH$`, `1mv8R0PUL3ShYolYIv13q6`, `0uiFb0HaP678EZcyYTY7Tb`, `0uiFb0HaP678EZcyYTY7pu`.
- Metrics: `groupsApplied: 5`, `deletedRows: 50`, `insertedRows: 0`, `touchedGuidRows: false`, `touchedTaloColumn: false`, `noAddsPerformed: true`.

**Batch 2 (manual-review + controlled adds)** — **gray zone, zero automatic writes**:

- Working file: `measurement-ifc-2026-03-31-ifcdoor-batch2-review.xlsx` (cloned from batch1 output).
- Filter: ~20 `dudoso` groups (typical pattern: current code questionable, **no** replacement candidates above confidence threshold in the engine).
- Outcome: **`groupsPlanned: 0`**, **20× `skip`** — no `dryRun` / no write (correct behavior: **do not invent replacements** without evidence).
- Typical skip reasons (examples): material vs IFC name mismatch (wood vs metal), acoustic dB variants, special types (e.g. sectional / sauna / swing door nuances), interior vs exterior + fire-rating ambiguity.

**Next step for Batch 3 (human-governed):** build an **approved mapping table** (IFC name family / dimensions / dB / EI → allowed Littera code(s)), then apply via the same surgical tool with `dryRun` → user `AUTORIZO` → write.

## Resume plan (next session)

1. Re-run validation (ping -> clone -> dryRun -> write).
2. Verify inserted Littera rows only carry `IFC Type`, `Name`, `TALO Code`, `Littera Code`.
3. Verify no visible grouping/outline drift outside target block.
4. Keep `costa_improve_littera_in_excel` blocked until full-writer redesign is complete.

## Acceptance criteria for enabling write

- Target GUID block updated with requested codes.
- No changes in `TALO Code`.
- No changes in GUID rows (content).
- Inserted rows do not copy non-essential value columns.
- No unintended changes in other groups.
- Excel remains visually/structurally equivalent for grouping/outline use in CostPage workflow.

## Excel write: historial de problemas y política vigente (2026-04-02)

### Problema raíz confirmado

`ExcelJS.Worksheet.spliceRows` **rompe irrecuperablemente** los metadatos nativos de agrupación/outline de Excel (botones +/-) cada vez que se usa para insertar o eliminar filas, independientemente de si se lleva cuenta del desplazamiento (`rowOffset`). Esto ocurre porque esos metadatos son atributos XML a nivel de fila que ExcelJS no recalcula correctamente al reordenar.

Intentos previos fallidos:
1. `writeMode: "v2"` (spliceRows por GUID individual) → corrupción tras múltiples llamadas secuenciales.
2. `writeMode: "inplace"` con borrado de filas extra (spliceRows bottom-up + rowOffset) en el tool batch → corrupción igualmente.

### Política vigente (única segura)

**Regla de oro: `writeMode: "inplace"` NUNCA llama a `spliceRows`.**

Comportamiento actual del batch tool (`costa_set_littera_codes_batch_in_excel`) en modo `inplace`:
- **Filas existentes ≤ códigos nuevos:** sobreescribe la celda Littera Code celda por celda. El `rowOffset` no cambia.
- **Filas existentes > códigos nuevos:** las filas sobrantes se dejan en su lugar; solo se limpia la celda Littera Code (`clearLitteraColumnsExcelJs`). No se elimina ninguna fila.
- **Inserción:** no se insertan filas en modo `inplace` (si se necesitan más filas que las existentes, los códigos extra no se escriben).

Consecuencia visible para el usuario: grupos donde se redujo el número de códigos Littera tendrán filas en blanco (vacías) en la columna Littera Code. Las filas físicas permanecen. Esto es deliberado — es el único comportamiento que no corrompe el formato.

### Estado del Excel de trabajo — Keimola IfcWALL (2026-04-02)

El archivo `measurement-ifc-2026-04-02-WORK.xlsx` (clon de trabajo) **quedó corrupto** tras el último batch write (32 grupos IfcWALL + IfcWALLSTANDARDCASE) que usó la versión del inplace-con-borrado. El original (`measurement-ifc-2026-04-02.xlsx`) no fue tocado.

**Para retomar el trabajo de IfcWALL:**
1. Recuperar el original `/Volumes/Untitled/Keimolan koulutus- y opetusrakennus/measurement-ifc-2026-04-02.xlsx` (intacto).
2. Crear nuevo clon con `costa_clone_excel_without_changes`.
3. Repetir el batch con `writeMode: "inplace"` (versión corregida — solo sobreescritura de celdas).
4. El dryRun del batch anterior sigue siendo válido; la propuesta de 32 grupos está en el historial de chat.

---

## Criterio simple de auditoria (version humana)

Para cada grupo (`IFC Type` + `Name` normalizado + `TALO Code`), la decision se toma en 3 pasos:

1. **Leer estado actual** en Excel (`currentLitteraCodes`).
2. **Calcular propuesta** desde contexto tecnico (`IFC/Store` + catalogo local `littera.json`).
3. **Comparar y clasificar**:
   - **Mantener**: codigo actual que sigue siendo coherente con la propuesta.
   - **Eliminar**: codigo actual que no tiene respaldo semantico para ese objeto.
   - **Agregar**: codigo recomendado faltante (solo cuando el usuario lo aprueba explicitamente).

Regla operativa para ejecucion rapida:
- Primer lote: **solo eliminaciones seguras** (sin `add`), porque es el menor riesgo.
- Segundo lote: agregados/reemplazos solo con aprobacion humana.

## Por que hoy se siente lento

La lentitud principal no viene de escribir Excel, viene de la fase de analisis:
- Se revisan muchos elementos (hasta 1732) con mucha variabilidad semantica.
- Se repiten consultas por grupos y tipos.
- A veces se mezcla analisis amplio con pasos de aprobacion en la misma corrida.

Medidas de velocidad acordadas:
- Trabajar por `IFCType` (no por todo el modelo a la vez).
- Limites duros por lote (`elementLimit`, `groupLimit`).
- Fuentes locales primero (`Excel + Store/IFC + littera.json`), web solo para ambiguos.
- Aprobacion por lotes/patrones, no por elemento individual.

## Gap actual vs herramienta objetivo

Estado actual:
- Ya existe pipeline de conexion (`Excel + Store + IFC`) y escritura quirurgica segura V2.
- Ya existe analisis por `IFCType` para proponer `keep/remove/add`.

Lo que falta para la herramienta "inteligente" completa:
- Politica explicita de decision (scoring semantico estable) separada de heuristicas legacy.
- Priorizador automatico de inicio (que IFCType tratar primero segun impacto/riesgo).
- Flujo de aprobacion nativo por lote con trazabilidad de decisiones.
- Reporte final consolidado por corrida (antes/despues + evidencia semantica).

## Tooling status: complete pipeline (implemented)

A full 3-layer pipeline is now implemented in tooling (analysis side), ready for agile Claude workflows:

1. **Candidate Generator**
   - Source: local `littera.json` + filtered candidates from app services.
   - Scope: grouped by `IFC Type + normalized Name + TALO Code`.

2. **Semantic Scorer (explicit)**
   - Per-candidate score with weighted features:
     - base confidence from filtering service,
     - token match (`Name` vs candidate description),
     - IFC-type semantic boost,
     - TALO compatibility boost (prefix),
     - demolition penalty,
     - foreign-category penalty.
   - Output includes feature breakdown per candidate (`reasons`) and final `score`.

3. **Policy + Approval contract**
   - Thresholds:
     - `auto-keep` when `score >= 0.75`
     - `auto-remove` when `score <= 0.35`
     - `manual-review` otherwise
   - Output includes `approvalPayload` per group:
     - `proposedAfterCodes`
     - `autoKeep[]`
     - `autoRemove[]`
     - `manualReview[]`

Implemented endpoint:
- `costa_analyze_littera_by_ifc_type`
  - now returns semantic scoring + policy decisions, not only keep/remove/add.

## Checkpoints verificables con Claude + Excel

Cada avance debe cerrarse con evidencia en JSON y archivo de salida:

1. **Checkpoint A - Analisis por IFCType**
   - salida: ranking + `approvalCandidates[]` completo.
2. **Checkpoint B - Lote aprobado (dryRun)**
   - salida: impacto esperado por GUID/grupo (`willInsertRows`, `willDeleteRows`).
3. **Checkpoint C - Escritura real**
   - salida: `beforeRows/afterRows`, `insertedRows/deletedRows`, invariantes (`touchedGuidRows=false`, `touchedTaloColumn=false`).
4. **Checkpoint D - Verificacion en Excel**
   - evidencia visual/manual de que formato y agrupacion no se rompieron.

## Agile workflow (without micro-batches)

Recommended operational flow for large runs:

1. **Analyze and rank by IFCType**
   - Run `costa_analyze_littera_by_ifc_type` for selected high-volume types.
   - Select starting type by impact + confidence + risk.

2. **Approve by pattern (not by GUID)**
   - Approve `auto-remove` and `auto-keep` in bulk.
   - Keep `manual-review` excluded from automatic write.

3. **DryRun full batch**
   - Execute full approved batch on copy file.
   - Validate expected row deltas (`willInsertRows`, `willDeleteRows`).

4. **Write full batch**
   - Apply only approved groups.
   - Keep invariants: no GUID row content edits, no TALO changes.

5. **Final audit**
   - Consolidated JSON + Excel verification.

## Product vision: what to do next (operational checklist)

Use this checklist whenever you start or resume a Claude session:

1. **Link context**
   - Costa open with IFC loaded and Cost Analysis / store populated.
   - `costa_ping_store_connection` → `connected: true`.

2. **Pick working Excel**
   - Never edit the original export; always clone first (`costa_clone_excel_without_changes`).
   - One canonical **working file** per branch of work (e.g. `...-ifcdoor-fullbatch1.xlsx`).

3. **Choose IFC Type**
   - `costa_get_ifc_types_in_store` → user picks type (or Claude proposes top 3 by impact/risk).

4. **Analyze**
   - `costa_analyze_littera_by_ifc_type` → review `approvalPayload`, `overallVerdict`, `semanticScoring`.

5. **Approve**
   - User approves pattern or list of groups (not blind bulk on gray zone).

6. **dryRun → write**
   - `costa_set_littera_codes_for_guid_in_excel` per approved `sampleGuid`, `dryRun: true` then `false`.

7. **Verify**
   - JSON invariants + spot-check Excel grouping/format.

## Resume protocol (between chat sessions)

Copy/paste this block into a new conversation when you reconnect:

- **Project / package:** (name or path folder)
- **IFC:** loaded in Costa (yes/no)
- **Working Excel path (absolute):** `...`
- **Original Excel (read-only reference):** `...`
- **Last completed:** (e.g. `IfcDoor batch1 write`, `IfcCOLUMN fullbatch1`)
- **Current focus IFC Type:** (e.g. `IfcDoor`)
- **Pending:** (e.g. `IfcDoor batch3 mapping table`, `IfcWALL next`)
- **Invariant:** surgical writer rules (no TALO/GUID edits; Littera block only).

Then run `costa_ping_store_connection` + confirm the working file still exists before any write.

## Frozen policy thresholds (for Claude + user)

These are the default interpretation of tooling output unless you explicitly change them in a session:

| Signal | Meaning |
|--------|---------|
| `auto-keep` | Likely keep code in Excel unless user overrides. |
| `auto-remove` | Candidate for removal in an approved remove-only batch. |
| `manual-review` | **No automatic write** without user decision or mapping table. |
| `recommendedAdd` non-empty | Adds allowed **only** after explicit user approval for that group/pattern. |
| Batch 2 gray zone (all skip) | Expected: engine refuses to invent replacements; use **Batch 3 mapping**. |

## IfcDoor Batch 2.5: assisted clarification (web + IFC context)

When Batch 2 marks groups as `dudoso` / `skip`, the user still needs **structured help** to decide. Claude can use **web search** (in the Claude UI) plus Costa tools to relate **object semantics** (IFC Type, Name, TALO) to **Littera catalog** entries — without inventing codes.

**No new MCP tool is required** for web research: Claude performs search in-chat. The deliverable is a **review table** the user approves before Batch 3 write.

### Ready-to-paste: Claude prompt (Batch 2.5 clarification)

```text
Continuación: IfcDoor — Batch 2.5 (aclarar dudosos con contexto IFC + internet, sin escribir Excel aún).

Contexto del proyecto:
- Excel de trabajo (copia): <PASTE_ABSOLUTE_PATH>
- IFCType en foco: IfcDoor
- Regla: no modificar Excel en este paso salvo que yo diga explícitamente "escribir".

Objetivo:
Para cada grupo "dudoso" que quedó fuera del batch automático, producir un informe que relacione:
(1) objeto IFC / store, (2) códigos Littera actuales y su texto en littera.json, (3) evidencia pública (Finlandia / Talo / prácticas de mediciones) que ayude a interpretar el nombre IFC y el TALO, (4) opciones de decisión para el usuario.

Pasos obligatorios:

1) costa_ping_store_connection — confirmar store.

2) costa_analyze_littera_by_ifc_type:
   - ifcType: IfcDoor
   - groupLimit: 200
   - elementLimit: 2000
   - maxSuggestions: 8
   - minConfidence: 0.5
   Filtrar en tu respuesta solo grupos con overallVerdict "dudoso" o con approvalPayload.manualReview no vacío.

3) Para cada grupo dudoso (máximo 5 por mensaje si hay muchos; si hay 20, procesar en tandas de 5):
   - Identifica sampleGuid, groupKey, taloCode, Name normalizado, elementCount.
   - Para cada código Littera actual: busca en littera.json (vía tu conocimiento del catálogo del proyecto) la descripción, categoría, unidad.
   - Opcional si está disponible: costa_probe_excel_store_ifc_link o lectura coherente del bloque Excel para ese GUID (solo lectura / dryRun conceptual).

4) Búsqueda en internet (3–6 fuentes con URL por grupo):
   - Términos en finés/inglés derivados del Name IFC (ej. väliovi, pariovi, MLO, MO, dB, EI30, nosto-ovi, sauna).
   - "TALO 2000" + familia de puerta si aplica.
   - Objetivo: aclarar **significado del objeto** (interior/exterior, madera/metal, acústica, cortafuego), no adivinar un número Littera al azar.

5) Salida por grupo (JSON + texto breve):
{
  "groupKey": "...",
  "sampleGuid": "...",
  "objectSummary": { "ifcType": "...", "name": "...", "taloCode": "..." },
  "currentLitteraCodes": [{ "code": "...", "descriptionFromCatalog": "...", "whyDubious": "..." }],
  "webInsights": [{ "url": "...", "relevance": "..." }],
  "interpretation": "2-4 frases: qué conflicto hay (material vs nombre, interior vs exterior, etc.)",
  "candidateDirections": [
    "Opción A: mantener X si ...",
    "Opción B: sustituir por familia Y (solo códigos que existan en littera.json; listar códigos a verificar)"
  ],
  "recommendedNextStep": "manual-review | mapping-needed",
  "proposedLitteraCodesForUserApproval": []
}

Reglas estrictas:
- NO inventar códigos Littera de 6 dígitos que no existan en littera.json del proyecto.
- NO escribir Excel en este paso.
- Si no hay evidencia suficiente, decirlo y pedir decisión humana explícita.

Al final del lote: tabla resumen (GUID → conflicto principal → siguiente acción sugerida).
```

## IfcDoor Batch 3: human mapping table (template)

Use this when semantic confidence is too low but you still want a controlled improvement.

Columns (CSV or sheet):

| groupKey | sampleGuid | taloCode | ifcNamePattern | notes | approvedLitteraCodes (ordered) | approvedBy | date |
|----------|------------|----------|----------------|-------|-------------------------------|------------|------|
| `ifcdoor|1.3.1.5|...` | `...` | `1.3.1.5` | regex or exact normalized name | why this row exists | `433045;433065` | you | 2026-04-01 |

Application rule:

- Claude applies **only** rows you filled with `approvedLitteraCodes`.
- Order = Excel row order for `costa_set_littera_codes_for_guid_in_excel` (`litteraCodes` array).

## Ready-to-paste: Claude prompt for Batch 3 (mapping-driven)

```text
Context resume: IfcDoor Batch 3 — apply user-approved mapping only.
Working Excel: <PASTE_ABSOLUTE_PATH_TO_BATCH2_OR_LATEST_WORKING_FILE>
Rules: no TALO/GUID edits; Littera block only; clone to new output before writes.

1) costa_ping_store_connection
2) I will paste a mapping table (groupKey or sampleGuid -> approvedLitteraCodes). Parse it.
3) costa_clone_excel_without_changes -> outputPath: <same-folder>-ifcdoor-batch3-mapped.xlsx
4) For each approved row: costa_set_littera_codes_for_guid_in_excel dryRun:true, then after my "AUTORIZO" dryRun:false.
5) Consolidated JSON summary + invariant checks.

Do not invent codes: only codes from my table or from littera.json that I explicitly list per row.
```

## IfcDoor Batch 3 — Familia C (registrado 2026-04-01)

**Decisión humana:** Familia C (acústicas VÄLIOVI VO, dB en nombre IFC): **436230 en todos los grupos** — *laakaovi, viilupintainen, dB* (KPL, PUUOVET, ARK XX). El catálogo no distingue 39 / 44 / 48 dB en puerta de madera; antes de afirmar ausencia de códigos, usar `costa_search_littera_catalog` sobre `src/data/littera.json` (no inferir desde `__costStore`).

**Archivo de trabajo (clon):** `measurement-ifc-2026-03-31-ifcdoor-batch3-mapped.xlsx` (clon sin cambios estructurales previos al write).

**Mapeo aprobado (sustitución in-place 436135 → 436230 en columna Littera Code):**

| # | sampleGuid | Nombre IFC | Elem. | beforeCode | afterCode |
|---|------------|------------|-------|------------|-----------|
| C1 | `2ZSu7zUDH1HhAKozvHlspX` | VÄLIOVI VASIKALLINEN VO 9+3 39dB | 11 | 436135 | 436230 |
| C2 | `2ZSu7zUDH1HhAKozvHlnAJ` | VÄLIOVI VO 10 39dB | 18 | 436135 | 436230 |
| C3 | `2dsMf6iinBcfYkeUnt4fVJ` | VÄLIOVI VO 10 48dB | 6 | 436135 | 436230 |
| C4 | `1mv8R0PUL3ShYolYIv1Sph` | VÄLIOVI VO 10 44dB | 2 | 436135 | 436230 |

**DryRun consolidado (ya ejecutado; listo para write):**

```json
{
  "ok": true,
  "familia": "C — Acústicas dB",
  "targetFile": "measurement-ifc-2026-03-31-ifcdoor-batch3-mapped.xlsx",
  "dryRuns": [
    {
      "guid": "2ZSu7zUDH1HhAKozvHlspX",
      "nombre": "VÄLIOVI VASIKALLINEN VO 9+3 39dB",
      "elementos": 11,
      "groupRow": 76,
      "guidRow": 78,
      "beforeCode": "436135",
      "afterCode": "436230",
      "willInsertRows": 0,
      "willDeleteRows": 0,
      "touchedGuidRows": false,
      "touchedTaloColumn": false
    },
    {
      "guid": "2ZSu7zUDH1HhAKozvHlnAJ",
      "nombre": "VÄLIOVI VO 10 39dB",
      "elementos": 18,
      "groupRow": 89,
      "guidRow": 91,
      "beforeCode": "436135",
      "afterCode": "436230",
      "willInsertRows": 0,
      "willDeleteRows": 0,
      "touchedGuidRows": false,
      "touchedTaloColumn": false
    },
    {
      "guid": "2dsMf6iinBcfYkeUnt4fVJ",
      "nombre": "VÄLIOVI VO 10 48dB",
      "elementos": 6,
      "groupRow": 109,
      "guidRow": 111,
      "beforeCode": "436135",
      "afterCode": "436230",
      "willInsertRows": 0,
      "willDeleteRows": 0,
      "touchedGuidRows": false,
      "touchedTaloColumn": false
    },
    {
      "guid": "1mv8R0PUL3ShYolYIv1Sph",
      "nombre": "VÄLIOVI VO 10 44dB",
      "elementos": 2,
      "groupRow": 153,
      "guidRow": 155,
      "beforeCode": "436135",
      "afterCode": "436230",
      "willInsertRows": 0,
      "willDeleteRows": 0,
      "touchedGuidRows": false,
      "touchedTaloColumn": false
    }
  ],
  "summary": {
    "allDryRunsOk": true,
    "totalGroups": 4,
    "totalEstimatedElements": 37,
    "totalWillInsertRows": 0,
    "totalWillDeleteRows": 0,
    "operation": "in-place replace 436135 → 436230 en columna Littera Code",
    "touchedGuidRows": false,
    "touchedTaloColumn": false
  }
}
```

**Nota:** `willInsertRows` / `willDeleteRows` en 0 porque la operación es sustitución in-place (1 código → 1 código); no cambia el número de filas del bloque Littera.

**Gate de escritura:** no ejecutar `dryRun: false` / escritura real hasta que el usuario escriba explícitamente: **`AUTORIZO BATCH3 WRITE`**.

**Pendiente al retomar:** ejecutar los 4 grupos con `dryRun: false` sobre `batch3-mapped.xlsx` tras la autorización; opcionalmente preparar Familias A y B en paralelo en la misma sesión si se desea una sola autorización.

---

## Canales de comunicación: MCP vs WebSocket

Costa usa dos canales distintos. Conocer la diferencia evita confusión al depurar:

| Canal | Qué es | Herramientas típicas |
|--------|--------|----------------------|
| **MCP (stdio)** | `mcp-server/main.ts` habla con Claude por protocolo MCP. Ejecuta código en la máquina donde corre el servidor (lee disco del repo). | `costa_search_littera_catalog`, `costa_clone_excel_without_changes`, `costa_set_littera_codes_batch_in_excel`, `costa_set_littera_codes_for_guid_in_excel` |
| **WebSocket (puerto 8081)** | La app Costa en el navegador conecta al MCP; el servidor reenvía peticiones que necesitan el modelo IFC o el store en memoria. | `costa_ping_store_connection`, `costa_get_ifc_types_in_store`, `costa_analyze_littera_by_ifc_type`, `costa_get_elements`, `costa_get_element_properties`, `costa_load_ifc` |

- **`costa_search_littera_catalog`** está solo en MCP: lee `src/data/littera.json` en el repo, no pasa por el navegador.
- **Cualquier herramienta que necesite el IFC cargado o el store activo** requiere app abierta + WebSocket conectado (verificar con `costa_ping_store_connection`).
- Si una herramienta no responde: primero verificar MCP arrancado; para herramientas del modelo, además Costa abierta en la página del proyecto con IFC cargado.

---

## Guion para iniciar una nueva sesión (proyecto nuevo o retomar)

### Mensaje de inicio para Claude (pegar al abrir chat)

```text
Tengo Costa abierta con el IFC cargado.
Excel de trabajo: <RUTA_ABSOLUTA_AL_.xlsx>

Quiero mejorar los códigos Littera. Sigue estas reglas sin excepción:
1. No toques el Excel original nunca. Trabaja siempre en un clon.
2. Usa costa_search_littera_catalog para verificar cualquier código antes de proponerlo.
3. Para cada grupo: dryRun:true primero. No escribas nada hasta que yo diga AUTORIZO.
4. writeMode debe ser siempre "inplace". Nunca uses "v2".
5. Empieza con: ping → inventario de tipos IFC → espera mi elección.
```

### Mensaje de continuación (sesión anterior ya en progreso)

```text
Continúo el trabajo Costa / Littera.
Estado: lee docs/LITTERA_SURGICAL_STRATEGY.md (última sección registrada).
IFC actual: <nombre o ruta>. Excel de trabajo: <ruta absoluta al .xlsx>.
Siguiente paso: <ej. repetir batch IfcWALL con inplace corregido / analizar IfcSLAB>.
Reglas: catálogo Littera = src/data/littera.json vía costa_search_littera_catalog; writeMode: inplace siempre.
```

### Pasos fijos de arranque (toda sesión)

1. `costa_ping_store_connection` → debe indicar conexión OK.
2. `costa_get_ifc_types_in_store` → mostrar al usuario **todos** los tipos IFC con conteos (fundamental para que sepa que Claude enlaza el modelo completo).
3. Clonar el Excel de trabajo (`costa_clone_excel_without_changes`). Nunca editar el original.
4. Elegir IFC Type → analizar → dryRun → esperar **AUTORIZO** → escribir.

---

## Uso en finés / Suomenkielinen pikaohje

Claude ymmärtää suomea. Käytä englanninkielisiä MCP-työkalun nimiä (`costa_search_littera_catalog`, `costa_ping_store_connection`, jne.).

**Lyhyt aloitusviesti (suomeksi):**

```text
Jatkamme Costa-projektia. IFC: <polku>. Excel: <polku>.
Seuraava askel: <esim. Littera-koodien tarkistus / dryRun>.
Säännöt: täydellinen Littera-luettelo on repossa src/data/littera.json — käytä costa_search_littera_catalog;
älä päätä puuttuvia koodeja vain storen perusteella. writeMode: inplace aina.
```

Käyttäjä voi kirjoittaa suomeksi: rakennuksen kuvaukset, kysymykset, hyväksynnät ("hyväksyn kirjoituksen", "jatka seuraavalla erällä"). Tiedostopolut, GUID:t ja Littera-numerot (6 numeroa) kannattaa pitää tarkkana.

---

## Archivos de referencia clave

| Archivo | Contenido |
|---------|-----------|
| `docs/LITTERA_SURGICAL_STRATEGY.md` | **Este archivo** — estrategia, progreso de batches, política de escritura, guion de sesión |
| `docs/MCP_SETUP.md` | Configuración del equipo (Claude Desktop, dependencias, arranque) |
| `docs/MCP_IFC_WRITE_SPEC.md` | Especificación futura: escritura de TALO/Littera directamente en el IFC |
| `docs/LITTERA_FINNISH_CONTEXT_AND_SYSTEM.md` | Contexto finlandés (TALO, tipos de construcción, patrones Littera por parte del edificio) |
| `src/data/littera.json` | Catálogo oficial Littera — siempre buscar vía `costa_search_littera_catalog` |
