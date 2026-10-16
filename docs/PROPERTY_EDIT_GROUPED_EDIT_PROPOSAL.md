# Propuesta: edición agrupada en panel Edit properties

Documento de diseño (sin implementar). Contexto: pestaña **Edit** del panel Property Information, borrador local `propertyDraftStore` / `window.costaPropertyDraftStore`, campos v1 **Name**, **Description** (IfcRoot) y propiedades **Costa** (`costa_*` en IfcPropertySet).

## Situación actual

- Con varios elementos seleccionados, el árbol repite **un bloque por elemento** (cabecera + IfcRoot + Costa).
- Cada `expressId` tiene su entrada en `drafts[expressId]`.
- Editar un campo en un elemento no propaga automáticamente al resto de la selección (salvo flujos bulk futuros o manuales).

## Objetivo

**Agrupar la edición** cuando hay selección múltiple y los elementos comparten campos, para evitar scroll y árboles duplicados.

## Dos niveles posibles

### 1. Agrupar solo la UI (más simple)

Un bloque **«N elementos seleccionados»** con los mismos campos editables; al escribir (o al guardar) se aplican cambios a todos los `expressId` de la selección actual.

- Ventaja: menos ruido visual, modelo mental claro.
- Riesgo: sobrescribir valores distintos sin aviso.

### 2. Agrupar por valor compartido (más fino)

Fusionar visualmente solo cuando **todos tienen el mismo valor**; si difieren, estado **«Varios valores»** / campo vacío con placeholder; el primer cambio unifica.

| Campo | Todos iguales | Distintos |
|--------|----------------|-----------|
| Name | Un input con valor común | «Varios valores» o lista colapsable |
| Description | Igual | Igual |
| `costa_*` (mismo Pset) | Una fila por propiedad | Filas extra o «solo en algunos» |

## Campos recomendados en v1

- **IfcRoot — Name / Description**: siempre agrupables a nivel selección.
- **Costa Psets**: agrupar por `(psetName, propertyName)`:
  - Mismo valor en todos → un input.
  - Valores mixtos → indicador «mixto».
  - Propiedad solo en parte de la selección → «Presente en k/N» + opción «añadir al resto».

## Flujo de usuario sugerido

1. Selección múltiple → resumen: **«5 elementos · IfcBEAM (3), IfcWALL (2)»**.
2. Secciones IfcRoot y Costa **una sola vez**.
3. Política de propagación explícita (ver decisiones).
4. **Discard** limpia borradores de todos los `expressId` de la selección actual.

## Decisiones de producto (pendientes)

1. **Propagación**: al escribir vs solo con botón «Apply to selection».
2. **Valores distintos**: vacío + «Varios valores», valor del primero con aviso, o moda.
3. **IfcType distinto**: ¿mismos campos para todos o solo intersección?
4. **Psets Costa parciales**: ¿añadir propiedad nueva a todos al guardar o solo a quien ya tiene el Pset?
5. **Undo / Discard**: coherente con borrador local por elemento.

## Encaje con MCP / backend

La agrupación es **UI + staging**. El contrato futuro `costa_write_ifc_properties` puede seguir siendo lista `{ expressId, changes[] }`. Un cambio agrupado en pantalla se traduce en N entradas iguales en el payload.

## Esfuerzo orientativo

| Alcance | Esfuerzo |
|---------|----------|
| UI agrupada + propagar Name/Description | Moderado |
| Detección mismo valor / mixto | Medio |
| Costa con Psets parciales | Más delicado (IFC + UX) |

## Referencias en código

- `IFCViewer.tsx`: `propertyDraftStore`, `buildPropertyEditTreeData`, `syncPropertyDraftsFromSelection`
- Selección: `highlighter.selection.select`, `getSelectionExpressIds`

## Selección guardada (implementado)

Antes de agrupar la UI de edición, el panel **Element Search** permite acumular elementos en `propertyDraftStore.savedFragmentIdMap`. Cuando esa cesta tiene elementos, **Edit properties** usa `getEditFragmentIdMap()` (cesta prioritaria frente al highlight 3D).

Documentación completa: [ELEMENT_SEARCH_AND_SAVED_SELECTION.md](./ELEMENT_SEARCH_AND_SAVED_SELECTION.md).

Flujo recomendado para edición multi-elemento manual:

1. Buscar con filtros (tipo IFC, keywords, GUID).
2. Previsualizar filas → **Add preview to saved selection**.
3. Abrir pestaña **Edit** (borradores por `expressId` en la cesta).
4. Futuro: sustituir N árboles por un bloque agrupado leyendo la misma cesta.
