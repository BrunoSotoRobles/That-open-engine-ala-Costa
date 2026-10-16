# Costa groups — Slice 1 (reversible)

**Estado:** aplicado para prueba. Si no convence → revertir este slice y volver al punto de conversación (sesión RAM only, Save = solo live).

## Qué incluye

1. **Save group** = unión **cesta ∪ live** (`savedFragmentIdMap` ∪ `highlighter.selection.select`).
2. **Formato canónico** (UI = Claude): `{ version, updatedAt, groups: [{ id, name, expressIds }] }`.
3. **Persistencia** `localStorage` clave `costa.namedGroups.v1` (kill-switch `COSTA_GROUPS_LOCAL_STORAGE`).
4. Tras cargar IFC: `rebindNamedGroupMaps(model)` para Select/Isolate (ya **no** se hace `clearNamedGroups` al load — eso vaciaba localStorage).
5. Consola: `window.costaGroupsGetDocument()` (puente temporal hasta MCP).

## MCP (Slice 2)

| Tool | Uso |
|------|-----|
| `costa_groups_list` | Documento de grupos Costa |
| `costa_groups_get_members` | `groupId` o `groupName` → miembros desde IFC |
| `costa_groups_extract` | Tabla IFC del grupo (sin CostStore, sin escribir IFC) |
| `costa_groups_select` | Resaltar / aislar grupo en visor (azul `cost-select`) |

## Flujo MCP típico (punta de lanza)

```
costa_groups_list → elegir grupo
costa_groups_select → ver en 3D qué mide Claude
costa_groups_get_members → confirmar miembros
costa_groups_extract → props + cantidades IFC del alcance
```

## Qué NO incluye (siguiente)

- Herramientas MCP Tree/Search/Group.
- Key por proyecto/modelo (hoy un blob global por origen).
- Escritura de grupos en IFC.

## Cómo probar

1. Selección 3D y/o Add preview → cesta; Save selection con nombre.
2. F5 → pie Grouping debe listar el grupo; Select debe funcionar tras load del mismo IFC.
3. `costaGroupsGetDocument()` en consola → mismo shape name+expressIds.

## Revertir

```text
git checkout -- src/utils/costaGroups.ts src/utils/costaGroupsDocument.ts src/react-components/IFCViewer.tsx
git checkout -- docs/COSTA_GROUPS_SLICE1.md docs/ELEMENT_SEARCH_AND_SAVED_SELECTION.md
git checkout -- tests/costaGroups.document.test.ts
# o borrar esos paths si eran untracked
localStorage.removeItem("costa.namedGroups.v1")
```

Kill-switch sin git: `COSTA_GROUPS_LOCAL_STORAGE = false` en `costaGroups.ts`.
