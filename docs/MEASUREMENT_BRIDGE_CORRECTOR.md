# Bridge measurement corrector v2.3

Post-procesador auditado externamente (`Downloads/_audit/independiente/capa_externa_v2/`).

## Activación

`src/utils/measurementFeatureFlags.ts`:

```ts
export const COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1 = false; // default
```

| Flag | Store (Send to Cost) | Excel puente |
|------|----------------------|--------------|
| `false` | Sin cambios | Sin cambios |
| `true` | Re-stampa `PublishedQuantity` / `quantity` si spec = CORREGIDO | Misma corrección en filas GUID |

## Qué corrige (spec v2.3)

- **defecto_dimensional:** p. ej. `OuterSurfaceArea` publicado como longitud → `Qto.Length`
- **orden_de_magnitud:** p. ej. canto de perfil vs longitud real
- **area_como_rectangulo:** muro con `L×H` cuando IFC tiene `NetSideArea` (solo si `GrossSide ≈ NetSide`)

## Qué no toca

- `baseQuantities` (Qto IFC raw en store)
- Casos **CRITERIO** / **ABSTENCION** (p. ej. 8 muros Lahdesjärvi con `GrossSide ≠ NetSide`)
- Tekla mm/m sin gate de sección implícita

## Trazabilidad

Cuando corrige en store, escribe en `extraProperties`:

- `CostaBIM.BridgeCorrector.V1`
- `CostaBIM.BridgeCorrector.Codigo`
- `CostaBIM.BridgeCorrector.Publicado` (valor anterior)

## Validación Lahdesjärvi (2026-09-18)

PRE mintió en 63 filas; POST (flag ON) alineó 63/63 con IfcOpenShell; criterio #1 PASS.
Informe: `LAHDESJARVI_PRE_vs_POST.md` (carpeta Downloads audit).
