# Property panel — Slice 1 (reversible)

## Objetivo

Alinear el botón **Properties** con el flujo habitual en visores BIM: la bolsa live (`highlighter.selection.select`) alimenta el panel; el botón abre/cierra el layout `second` y re-sincroniza la tabla.

## Cambios

| Pieza | Comportamiento |
|-------|----------------|
| Toolbar **Properties** | Toggle `main` ↔ `second`; al abrir, `onHighlight.trigger(liveBag)` |
| Sin selección | Panel abierto con tabla vacía (mensaje That Open / sin filas) |
| Model / Selection abierto | Abrir Properties cambia a `second` (panel exclusivo 26rem) |
| Selección 3D con `classifications` | Sin auto-cambio de layout; banner `#mw-live-selection-hint` con `liveBagN` |

## Revertir

1. Restaurar `onShowProperties` stub en `IFCViewer.tsx` (componente, fuera de `setupUI`).
2. Quitar `onTogglePropertiesPanel`, `updatePropertiesToolbarButton`, `id="properties-panel-toggle-btn"`.
3. Quitar llamadas a `updatePropertiesToolbarButton` en `onSelectionHighlight` / `onClear`.
4. Borrar este doc si se desea.

## Verificación manual

1. Lazo N elementos → layout `main` → Properties → panel con datos.
2. Properties otra vez → cierra (`main`), selección y pintura intactas.
3. Model/Selection abierto + selección → Properties → panel visible.
4. `costaSelectionAudit()` → `liveBagN` coherente tras abrir panel.

## Multi-select View (cabecera)

Con `liveBagN > 1`: cabecera `#property-multi-summary` con texto `N elements selected`. La tabla IFC lista todos los elementos. Sin navegación Prev/Next.
