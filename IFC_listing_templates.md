## Estrategia de listados IFC (plantillas)

Este documento resume cómo se organizan las propiedades IFC en el viewer y cómo podemos extraer **plantillas de listados** automáticamente a partir de un modelo cargado en el navegador.

- **Eje 1 – Tipo IFC (`ifcType`)**: `IfcWindow`, `IfcBuildingElementProxy`, `IfcDoor`, etc. Se usa como primer filtro en el panel de Excel.
- **Eje 2 – Property Sets (Psets)**: cada “listado” o “schedule” suele corresponder a un Pset diferente (p. ej. `1334 01 Laiteluettelo`, `Electrical Equipment Schedule`, `Työskentely, Ikkunat (älä filtteröi, sorting ok)`).
- **Eje 3 – Propiedades dentro del Pset**: cada columna candidata en el Excel corresponde a una clave `Pset.Property`, por ejemplo `Pset_WindowCommon.Reference` o `Keynote ja Type Mark tarkastus.Keynote`.

La idea de **plantilla de listado** es:

- Plantilla = combinación de:
  - Tipos IFC objetivo (ej. solo `IfcWindow`).
  - Psets relevantes (ej. `Pset_WindowCommon`, `Työskentely, Ikkunat …`).
  - Conjunto ordenado de claves `Pset.Property` que se transforman en columnas del Excel.

---

## Script de consola: descubrir plantillas desde un modelo IFC abierto

Con el viewer cargado en el navegador, `IFCViewer.tsx` expone:

- `window.getIFCModel()` → devuelve el `FragmentsGroup` actual.
- `window.getIFCComponents()` → devuelve el contenedor `components`.
- `window.highlighterRef` → highlighter (no es necesario para el escaneo global).

El siguiente script, ejecutado en la **consola del navegador**, recorre todos los elementos del modelo, usa el componente que tenga `getEntityRelations` (nuestro `IfcRelationsIndexer`) y construye un mapa:

- Por **tipo IFC** → Psets → propiedades.

```js
(async () => {
  const getModel = window.getIFCModel;
  const getComponents = window.getIFCComponents;

  if (!getModel || !getComponents) {
    console.error("Falta getIFCModel o getIFCComponents en window.");
    return;
  }

  const model = getModel();
  const components = getComponents();
  if (!model || !components || !components.list) {
    console.error("No hay modelo o components.list disponibles.");
    return;
  }

  // 1) Localizar el componente que expone getEntityRelations (IfcRelationsIndexer)
  let indexer = null;
  for (const comp of components.list.values()) {
    if (comp && typeof comp.getEntityRelations === "function") {
      indexer = comp;
      break;
    }
  }

  if (!indexer) {
    console.error("No se encontró ningún componente con getEntityRelations en components.list.");
    return;
  }

  // 2) Recorrer todos los elementos del modelo (a través de los fragments)
  //    Agrupamos por ifcType -> psetName -> set de propertyNames
  const templates = {};

  for (const fragment of model.items) {
    for (const expressID of fragment.ids) {
      const element = await model.getProperties(expressID);
      if (!element) continue;

      const ifcType = element.constructor?.name || "Unknown";
      if (!templates[ifcType]) {
        templates[ifcType] = {
          count: 0,
          psets: {} // psetName -> Set(propertyNames)
        };
      }
      templates[ifcType].count++;

      // Usar el indexer para obtener relaciones IsDefinedBy del elemento
      const relIds = indexer.getEntityRelations(model, expressID, "IsDefinedBy") || [];

      for (const relId of relIds) {
        const rel = await model.getProperties(relId);
        if (!rel) continue;

        const relName = rel.Name?.value || "";
        const isPset = rel.HasProperties && !rel.Quantities;

        if (!isPset) continue;

        const psetName = relName || `Pset_${rel.expressID}`;
        if (!templates[ifcType].psets[psetName]) {
          templates[ifcType].psets[psetName] = new Set();
        }

        for (const propRef of rel.HasProperties) {
          const prop = await model.getProperties(propRef.value);
          if (!prop) continue;
          const propName = prop.Name?.value || "";
          if (!propName) continue;
          templates[ifcType].psets[psetName].add(propName);
        }
      }
    }
  }

  // 3) Convertir Sets a arrays simples para inspeccionar / copiar
  const serializable = {};
  for (const [ifcType, data] of Object.entries(templates)) {
    serializable[ifcType] = {
      count: data.count,
      psets: {}
    };
    for (const [psetName, propSet] of Object.entries(data.psets)) {
      serializable[ifcType].psets[psetName] = Array.from(propSet).sort();
    }
  }

  console.log("Plantillas detectadas por tipo IFC y Pset:", serializable);
  window.ifcListingTemplates = serializable; // guardar copia global para exportar
})();
```

### Uso práctico del resultado

- `serializable[ifcType].psets[psetName]` da la **lista de propiedades** disponibles para ese Pset y tipo IFC.
- A partir de este objeto se pueden definir plantillas de listados:
  - Seleccionando ciertos `ifcType` + `psetName`.
  - Eligiendo subconjuntos de propiedades como columnas del Excel.

