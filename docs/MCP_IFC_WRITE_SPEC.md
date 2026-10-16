# Especificacion: Escritura IFC de TALO 2000 y Littera via WebSocket (IFCViewer)

## Objetivo

Definir como el bridge WebSocket de `IFCViewer` debe **escribir directamente en el IFC** los codigos de clasificacion:

- `TALO 2000 Hankenimikkeisto`
- `Littera` (como propiedad IFC)

Esta especificacion asume:

- Flujo unico: `MCP Server <-> websocket-client.ts <-> IFCViewer`
- Sin fallback a `CostStore` para persistencia
- Sin modificaciones de geometria

## Alcance

- Actualizar elementos IFC individuales por `expressId` y/o `GlobalId`
- Soportar lotes de elementos
- Crear o actualizar clasificaciones y propiedades semanticas
- Exportar un IFC modificado como nuevo archivo

Fuera de alcance:

- Cambios geometricos
- Sincronizacion con `CostPage` como fuente de verdad
- Reglas de coste avanzadas (solo escritura de codigos)

## Ubicacion actual de lectura (referencia)

La logica de lectura ya existe en `src/bim_components/Cost/index.ts`:

- TALO por clasificaciones IFC (`HasAssociations`, `IfcClassificationReference`, `IfcRelAssociatesClassification`)
- Fallback de lectura por Property Sets (`TALO*`, `TALO2000*`, `Keynote` para Revit)
- Littera por propiedades (`COSTA LITTERA` y variantes con `LITTERA`)

Esto define el contrato de interoperabilidad que la escritura debe respetar.

## Modelo de escritura propuesto

### 1) TALO 2000 como clasificacion IFC (obligatorio)

Por cada elemento objetivo:

1. Resolver `IfcProduct` por `expressId` o `GlobalId`.
2. Garantizar existencia de `IfcClassification` para sistema TALO 2000 (reutilizar si ya existe).
3. Crear/reusar `IfcClassificationReference` con:
   - `Identification`: codigo TALO normalizado (ej: `1.2.3`)
   - `Name`: nombre opcional del codigo
   - `ReferencedSource`: referencia al `IfcClassification` TALO
4. Vincular elemento con `IfcRelAssociatesClassification`.
5. Si ya existe vinculacion TALO previa:
   - Actualizar referencia existente o
   - Reemplazar relacion segun politica de overwrite.

### 2) Littera como propiedad IFC (obligatorio)

Por cada elemento objetivo:

1. Garantizar un `IfcPropertySet` de clasificacion Costa (nombre sugerido: `Pset_CostaClassification`).
2. Escribir/actualizar propiedades `IfcPropertySingleValue`:
   - `COSTA LITTERA` (codigo)
   - `COSTA LITTERA NAME` (opcional)
   - `COSTA LITTERA CATEGORY` (opcional)
3. Vincular el `Pset` al elemento mediante `IfcRelDefinesByProperties` (crear o reutilizar).

### 3) Espejo opcional de TALO en propiedad (recomendado para compatibilidad)

Aunque TALO se escribe por clasificacion, se recomienda tambien guardar:

- `TALO2000_Code`
- `TALO2000_Name` (opcional)

en `Pset_CostaClassification` para trazabilidad y compatibilidad entre visores.

## Contrato WebSocket (nuevo)

Agregar mensaje dedicado (nombre sugerido):

- `costa_write_ifc_classifications`

Payload sugerido:

- `requestId: string`
- `ifcWriteMode: "update" | "replace_talo"`
- `elements: Array<{ expressId?: number; globalId?: string; taloCode: string; taloName?: string; litteraCode?: string; litteraName?: string; litteraCategory?: string }>`
- `exportFilename?: string`

Respuesta sugerida:

- `ok: boolean`
- `written: number`
- `failed: number`
- `errors: Array<{ id?: number; globalId?: string; error: string }>`
- `outputFile?: string` (si se exporta en el flujo)

### Propiedades Costa (Name, Description, `costa_*` Psets)

Implementado en `mcp-server/ifcPropertyWriter.ts`:

- **MCP:** `costa_write_ifc_properties` (`dryRun:true` por defecto; `dryRun:false` escribe en servidor).
- **Visor → servidor:** `costa_viewer_write_ifc_properties` (botón *Save to IFC* en Property Information → Edit).
- **Ruta fuente:** `lastLoadedIfcPath` tras `costa_load_ifc`, o `ifcFilePath` / `window.ifcSourcePath` (el mensaje `costa_load_ifc:filename` incluye `sourcePath`).
- **Salida:** nuevo archivo `{basename}-costa-properties.ifc` (no sobrescribe el original).

Payload por elemento:

- `expressId` / `globalId`
- `name`, `description` (IfcRoot)
- `costaProperties`: `{ psetName, propertyName, value }[]` (IfcPropertySet bajo namespace `costa` / `costa_*`)

## Validaciones obligatorias

Antes de escribir:

- Validar formato TALO (normalizado a puntos)
- Validar existencia de elemento destino
- Validar Littera contra catalogo permitido (si aplica)
- Rechazar payload sin identificador de elemento

Durante escritura:

- Operacion idempotente (segunda ejecucion no duplica relaciones)
- Evitar crear multiples `IfcClassification` TALO equivalentes

## Politica de overwrite (sin fallback)

- TALO:
  - Si existe clasificacion TALO previa y `ifcWriteMode="replace_talo"`, reemplazar.
  - Si `ifcWriteMode="update"`, mantener y no sobrescribir salvo coincidencia de origen.
- Littera:
  - Actualizar propiedad existente en `Pset_CostaClassification`.
  - Si no existe, crear.

## Export del IFC modificado

Requisito funcional:

- Siempre generar un IFC de salida (nuevo archivo), nunca sobrescribir silenciosamente el original.

Sugerencia de nombre:

- `<original>-costa-classified.ifc`

## Compatibilidad por origen

- Revit: compatible (ya usa propiedades y en algunos casos Keynote)
- Archicad: TALO en clasificacion, Littera en propiedad (alineado con flujo esperado)
- Tekla: compatible via clasificacion IFC + propiedades Costa

## Criterios de aceptacion

1. Al reabrir el IFC exportado, los codigos TALO aparecen en clasificacion IFC de los elementos escritos.
2. Al reabrir el IFC exportado, `COSTA LITTERA` aparece en propiedades del elemento.
3. `Cost/index.ts` vuelve a leer TALO/Littera correctamente sin logica adicional.
4. No hay cambios geometricos en el modelo.
5. El proceso reporta errores por elemento sin abortar todo el lote.

## Notas de implementacion para despues

- Mantener toda la escritura en el flujo de `websocket-client.ts` + utilitario IFC writer dedicado.
- Evitar mezclar esta operacion con `costa_apply_cost_codes` (store-only).
- Separar fases:
  1. Resolucion de destinos
  2. Escritura semantica IFC
  3. Export de archivo
  4. Respuesta por WebSocket

## Restriccion del proyecto (confirmada)

- No se actualizaran dependencias en este repositorio.
- La implementacion debe funcionar con el stack actual de Costa como orquestador.
- La compatibilidad con Revit, Archicad y Tekla es obligatoria.

## Estrategia recomendada de backend (sin upgrades en este repo)

### Opcion objetivo

Usar Costa MCP como **orquestador** y delegar la escritura IFC a un **writer backend externo** (servicio o CLI), versionado de forma independiente.

Motivo:

- Permite mantener este proyecto estable (sin cambios de version de `web-ifc`/That Open en Costa).
- Reduce riesgo de incompatibilidades de export IFC en toolchains antiguas.
- Facilita endurecer pruebas de interoperabilidad por plataforma (Revit/Archicad/Tekla).

### Flujo propuesto end-to-end

1. Claude llama tool MCP (ej: `costa_write_ifc_classifications`).
2. `mcp-server/main.ts` valida payload y prepara job de escritura.
3. MCP invoca writer externo (HTTP o proceso local).
4. Writer:
   - abre IFC origen,
   - aplica TALO (clasificacion) y Littera (propiedades),
   - exporta nuevo IFC.
5. Writer devuelve ruta/metadata + resumen de cambios.
6. MCP responde por WebSocket al cliente con resultado y errores por elemento.

### Contrato MCP <-> Writer (minimo)

Request sugerido:

- `inputIfcPath: string`
- `outputIfcPath?: string`
- `mode: "update" | "replace_talo"`
- `elements: Array<{ expressId?: number; globalId?: string; taloCode: string; taloName?: string; litteraCode?: string; litteraName?: string; litteraCategory?: string }>`
- `metadata?: { source: "costa-mcp"; sessionId?: string; user?: string }`

Response sugerida:

- `ok: boolean`
- `outputIfcPath?: string`
- `written: number`
- `failed: number`
- `errors: Array<{ expressId?: number; globalId?: string; error: string }>`
- `report?: { taloUpdated: number; litteraUpdated: number; createdPsets: number; updatedPsets: number }`

### Reglas de compatibilidad obligatorias

- Mantener TALO en `IfcClassificationReference` + `IfcRelAssociatesClassification`.
- Mantener Littera en `IfcPropertySingleValue` dentro de `Pset_CostaClassification`.
- No borrar clasificaciones no TALO existentes.
- No sobrescribir IFC original; siempre generar archivo de salida nuevo.
- Resolver elementos por `GlobalId` cuando exista (mas estable entre exports), usando `expressId` como apoyo.

### Estrategia de verificacion por plataforma

Para aceptar una version de writer, validar el IFC resultante en:

- Revit: TALO visible en clasificacion; Littera visible en propiedades.
- Archicad: TALO en clasificacion de ocurrencia/tipo segun export; Littera en propiedad.
- Tekla: lectura consistente de clasificacion + propiedad en importadores habituales.

### Nota sobre stack actual de Costa

El repositorio ya contiene utilidades de escritura IFC (`src/utils/ifcConverter.ts`), pero estan orientadas a generar modelo nuevo y no son base suficiente por si solas para garantizar edicion robusta de IFC existentes multi-origen.

## Propuesta UI en IFCViewer (sin implementar aun)

Se recomienda crear un componente adicional para `src/react-components/IFCViewer.tsx` que orqueste la publicacion del IFC clasificado.

Nombre sugerido:

- `IFCClassificationPublishPanel`

Responsabilidad:

- Mostrar resumen de sugerencias aceptadas.
- Pedir confirmacion explicita antes de escribir en IFC.
- Disparar operacion MCP de escritura IFC.
- Mostrar progreso y resultado (escritos/fallidos/errores).
- Permitir recarga automatica o manual del IFC generado.

No responsabilidad:

- No calcular sugerencias TALO/Littera.
- No editar geometria.
- No reemplazar el motor del viewer.

## Especificacion de interaccion (UX + MCP)

### Actores

- Usuario en `IFCViewer`
- Cliente WebSocket (`websocket-client.ts`)
- MCP Server (`mcp-server/main.ts`)
- IFC Writer backend externo

### Estados de UI

- `idle`: sin operacion en curso.
- `review_ready`: hay sugerencias listas para confirmar.
- `writing`: operacion de escritura en backend en curso.
- `completed`: IFC generado con exito.
- `completed_with_errors`: IFC generado con errores parciales.
- `failed`: error general, sin archivo valido.

### Flujo principal

1. Usuario ejecuta sugerencia masiva de TALO/Littera.
2. UI presenta resumen:
   - elementos analizados,
   - elementos con sugerencia,
   - confianza promedio,
   - cambios pendientes.
3. Usuario confirma "Escribir en IFC".
4. Cliente envia request `costa_write_ifc_classifications`.
5. MCP valida y delega al writer backend.
6. Writer devuelve resultado y ruta de IFC generado.
7. UI muestra resultado:
   - exito total o parcial,
   - errores por elemento,
   - opcion de recargar modelo.
8. Recarga:
   - modo automatico: `costa_load_ifc` con `outputIfcPath`,
   - modo manual: mostrar ruta y accion "Cargar version clasificada".

### Mensajes de usuario (sugeridos)

- En confirmacion:
  - "Se escribiran clasificaciones TALO y propiedades Littera en un nuevo IFC. El archivo original no sera modificado."
- En exito:
  - "Se genero una nueva version del IFC con codigos incorporados."
- En parcial:
  - "La exportacion finalizo con incidencias en algunos elementos. Revise el detalle."
- En error:
  - "No fue posible generar el IFC clasificado. Intente nuevamente."

### Reglas UX obligatorias

- Confirmacion explicita antes de persistir.
- Mostrar siempre que el resultado es un archivo nuevo.
- Nunca ocultar errores por elemento.
- Permitir reintento sin perder el resumen de cambios.
- Registrar timestamp y ruta del ultimo IFC generado.

### Telemetria/registro recomendado

- `sessionId`
- `inputIfcPath`
- `outputIfcPath`
- `elementCountRequested`
- `written`
- `failed`
- `elapsedMs`
- `writerVersion` (si esta disponible)
