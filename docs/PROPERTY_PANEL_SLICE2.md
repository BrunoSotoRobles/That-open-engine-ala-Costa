# Property panel — Slice 2 (reversible)

## Objetivo

- **View:** cabecera multi-select (`#property-view-multi-host`) cuando `liveBagN > 1`; clic fila → tabla IFC de un solo elemento.
- **Edit:** pestañas View / Edit restauradas; Edit usa `getEditFragmentIdMap()` (cesta si no vacía, si no live).

## Revertir

1. Volver a comentar tab bar + `#property-edit-section` en `IFCViewer.tsx`.
2. Quitar `refreshPropertyViewMultiHeader`, `propertyViewFullMap`, helpers multi-select.
3. Restaurar `onSelectionHighlight` con `updatePropsTable({ fragmentIdMap })` directo.
4. Quitar estilos `.property-view-multi-*` en `style.css`.

## Verificación

1. Lazo N>1 → Properties → resumen + lista; clic fila cambia tabla.
2. N=1 → sin lista; tabla directa.
3. Pestaña Edit → árbol editable; cesta guardada prioriza Edit sobre live.
