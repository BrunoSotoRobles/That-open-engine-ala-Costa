# Capa externa v2.3 — auditoría offline

Post-procesador **IFC + Excel puente CostaBIM**, auditado en Downloads (Vuosaaren, Lahdesjärvi, Kilonhoiva).

## Uso offline (Python)

Los scripts canónicos viven en:

`Downloads\_audit\independiente\capa_externa_v2\`

```bash
python extraer_baseline.py "<ifc>" "<baseline.pkl>"
python capa_externa_v2.py --baseline "<baseline.pkl>" --xlsx "<puente.xlsx>" --label <etiqueta> --out-dir .
```

Documentación PASS: `CAPA_EXTERNA_v2_PASS.md` (misma carpeta Downloads).

## Espejo en el repo (TypeScript)

`src/utils/measurementBridgeCorrector/` — misma spec v2.3.

| Flag | Default | Store (Send to Cost) | Excel puente |
|------|---------|----------------------|--------------|
| `COSTA_MEASUREMENT_BRIDGE_CORRECTOR_V1` | **`false`** | Sin efecto | Sin efecto |
| `true` | Re-stampa `PublishedQuantity` | Corrige filas GUID al exportar |

Documentación: `docs/MEASUREMENT_BRIDGE_CORRECTOR.md`

**Reversible:** flag `false` → comportamiento Costa previo. No muta `baseQuantities`.

**Validado:** Lahdesjärvi PRE vs POST 63/63 (IfcOpenShell), informe en Downloads.
