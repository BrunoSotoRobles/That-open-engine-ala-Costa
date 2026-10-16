# Contexto finlandés y sistema Littera – Documento de referencia

Este documento fija el contexto de uso de Littera en Finlandia para nuestros tipos de proyecto y cómo lo refleja la app. Sirve para refinar la lógica de sugerencias y, después, contrastarlo con la práctica real.

---

## 1. Contexto finlandés (resumen para la app)

### 1.1 Tipología de proyecto

La app se centra en proyectos **estándar en Finlandia**: halls con paneles sandwich y zócalo de hormigón prefabricado (sokkelit), típicamente para:

- Centros logísticos
- Pabellones deportivos
- Tiendas (Sale, S-market, etc.)

No es un caso genérico: es un subconjunto muy repetido del TALO/Littera, donde la asociación de tareas suele ser estable.

### 1.2 Cómo se piensa la descomposición de tareas

En la práctica finlandesa la descomposición no se hace por “palabras clave” que el usuario escribe, sino por:

- **Rakennusosa / TALO:** parte del edificio (alapohja, runko, ulkoseinät, katto, väliseinät, ikkunat/ovet).
- **Työvaihe (fase de trabajo):** toimitus (suministro), asennus (montaje), saumat (juntas), o en obra in situ: muottityö, raudoitus, betonointi, hierto, eriste, varusteet.
- **Contrato:** material, labor en obra, o **aliurakka** (subcontrata que incluye elemento + colocación). Muchas partidas se resuelven con **un solo Littera** cuando el paquete es completo.

La separación habitual en precios es: **material**, **labor** (työ), **subcontract** (aliurakka); en obra a menudo subcontract con valor bajo para tareas puntuales, o un subcontract completo que incluye suministro e instalación.

### 1.3 Patrones por parte del edificio

| Parte | En práctica finlandesa | Paquetes de tarea típicos |
|-------|------------------------|----------------------------|
| **Sokkelit (perusmuuri, peruspilarit, peruspalkit)** | Prefabricado: elemento + montaje + juntas. A veces bitumi/eriste como partida aparte. | toimitus, asennus, saumat |
| **Alapohjalaatta (losa de planta baja)** | In situ: muottityö, raudoitus, betonointi, hierto, eriste, varusteet; en halls a veces códigos “especiales” (p. ej. 287). Elementti: toimitus, asennus, saumat. | paikallavalu por työvaihe, o elementti (toimitus, asennus, saumat) |
| **Välipohjat (forjados intermedios)** | Mismo patrón: in situ (muottityö, raudoitus, betonointi, hierto, eriste) o elementti (toimitus, asennus, saumat, pintavalu). | Idem alapohja |
| **Kantavat seinät (muros portantes)** | Betonielementit: suunnittelu (opcional), toimitus, asennus, saumat. En halls se usan también soluciones tipo harjaTT-laatat. | toimitus, asennus, saumat |
| **Ulkoseinät sandwich** | Elementos sandwich: toimitus, asennus, saumat. Muy frecuente como **kokonaisurakka** (suministro + montaje). | toimitus, asennus, saumat |
| **Vesikattorakenteet** | Kate (impermeabilización), eriste (térmico), varusteet (räystäät, kourut, vedenpoisto). Minimikaltevuudet por material (bitumikermi, PVC, pelti). | kate, eriste, varusteet |
| **Räystäsrakenteet** | Räystäät, vedenpoisto; a menudo mismo contratista que la kate. | kate, eriste, varusteet |
| **Väliseinät** | **Muuraus:** muuraus, raudoitus, aukonylitys, liitokset. **Kevytseinä:** runko + levytys (kipsilevy/GN), eriste, liitokset. | Por tipo (muuraus vs kevyt), 2–4 partidas |
| **Ikkunat / ovet** | Toimitus, asennus, listoitus, kittaus. A menudo ofertado como kokonaisurakka (avaimet käteen). | toimitus, asennus, listoitus, kittaus |

**Fuentes / referencias (contexto):** Rakennustieto, elementtisuunnittelu.fi (Betoniteollisuus ry), HalliPES (puuinfo), guías de sandwich-elementit (säilytys, kuljetus, asennus), Suomen Betoniyhdistys (paikallavalut pinnat), documentación de vesikatto (kattoliitto, rakentajaninfo).

---

## 2. Nuestro sistema (qué tenemos hoy)

### 2.0 Modelo de costes (FinnishCostValues)

El sistema usa **solo** cuatro magnitudes por elemento y por Littera:

- **material** (tarvikepanokset / KL2)
- **labor** (työpanokset / KL1)
- **subcontract** (palvelut / KL3, aliurakka)
- **total**

No se usan **equipment** ni **overhead** como conceptos separados. En export se usa **Subcontract Cost**; en import se lee Subcontract Cost, con fallback a Equipment + Overhead para compatibilidad con archivos antiguos.

### 2.1 Fuentes de datos

| Recurso | Contenido | Uso en la app |
|---------|-----------|----------------|
| **littera.json** | Catálogo de códigos Littera: descripción, unidad, categoría, keywords. Sin precios. | Filtrado, búsqueda, validación. |
| **littera-prices.json** | Precios por clave `litteraCode\|unit`: material, labor, subcontract, total. Incluye todos los Littera del catálogo (con costes ausentes = {}). | getPriceForLittera(); relleno de costes en import Excel y Measurement Data. |
| **talo_littera_mapping.json** | Mapeo Nimikkeistö (TALO) → Määräluettelo → Littera (código, descripción, unidad, categoría). ~1950 entradas. | TaloLitteraMappingService: getLitteraMappingsForNimikkeisto(); LitteraFilteringService, LitteraTemplateService. |
| **littera-filter-templates.csv** | Plantillas de filtro: por Nimikkeistö, IFC Type, Rakennusmenetelmä (elementti, paikallavalettu, sandwich, …), Vaadittu konteksti (autohall, garage, elementti, …), Työvaihe (toimitus, asennus, saumat, muottityö, …), Littera-koodialue, Yksikkö, Avainsanat, Prioriteetti, Max Codes. | LitteraTemplateService (findTemplate por elemento); LitteraFilteringService para acotar candidatos Littera. |
| **littera-filter-templates.generated.csv** | Versión generada desde talo_littera_mapping; misma estructura. | Alternativa o complemento a la plantilla manual. |

### 2.2 Flujo actual

1. **IFC** → elementos (tipo, nombre, cantidades).
2. **TALO** → sugerencias con TaloSuggestionService (regex, heurísticas por tipo IFC, unidad); el usuario asigna o corrige.
3. **Littera** → sugerencias con LitteraSuggestionService (mapTaloToLittera muy limitado —solo 1.2/1.3—, hints de nombre US1/VS4, keywords + tipo IFC). El **mapeo rico** (talo_littera_mapping) y las **plantillas** se usan en LitteraFilteringService y LitteraTemplateService, pero **no** en suggestLitteraAssignments. Por eso la sugerencia automática no se considera suficientemente exacta; la asignación de Littera sigue dependiendo mucho del usuario (tabla + export/import Excel).
4. **Costos** → getPriceForLittera(litteraCode, unit) desde littera-prices; agregación a nivel elemento y tabla.

### 2.3 Tipología que queremos soportar bien

- Halls con sandwich + sokkelit prefabricados (logística, deporte, retail).
- Objetivo: cuando la lógica de sugerencia se refine, que priorice **TALO + método constructivo + tipología** y ofrezca **1–2 Littera muy sólidos** por elemento (o el conjunto canónico de 2–4 códigos cuando el contrato se desglosa por työvaihe), no listas genéricas basadas en keywords.

---

## 3. Correspondencia contexto ↔ sistema

| Contexto finlandés | En nuestros datos |
|-------------------|-------------------|
| Sokkelit prefabricados: toimitus, asennus, saumat | 1212 + elementti + elementti → plantilla 315 (M2); mapping 3152020, 3152040, 3152060 (sokkelielementti, sokkelipalkki). |
| Sandwich ulkoseinät: toimitus, asennus, saumat | 1241 + elementti + sandwich → plantilla 315 (M2, JM). |
| Alapohjalaatta hall (in situ) | 1221 + paikallavalettu + autohall,garage → 287 (muottityö, raudoitus, betonointi, hierto, eriste, …). |
| Alapohjalaatta elementti | 1221 + elementti → 315 (toimitus, asennus, saumat). |
| Välipohja in situ / elementti | 1235 + paikallavalettu o elementti → 331, 334 / 315. |
| Kantavat seinät elementti | 1232 + elementti → 315 (ERÄ, M2, KPL, JM). |
| Vesikatto: kate, eriste, varusteet | 1261, 1262 → 371–376, 375 (M2, JM, KPL). |
| Väliseinät muuraus / kevyt | 1311 + muuraus o kevyt → 454, 485 / 456 (muuraus, runko_ja_levy, liitokset). |
| Ikkunat / ovet: toimitus, asennus, listoitus, kittaus | 1242, 1315 → 413–416, 433–437. |

**Gaps conocidos:**

- La **sugerencia** (suggestLitteraAssignments) no usa talo_littera_mapping ni las plantillas como fuente principal; usa lógica hardcoded (1.2/1.3) y keywords. Por tanto la correspondencia “contexto → sistema” existe en **datos y plantillas**, pero no aún en la **salida** de la sugerencia.
- Las **keywords** en plantillas (sokkelielementti, kantava, sandwich, asennus, …) son para que la plantilla identifique la fila correcta (TALO + método + contexto), no para que el usuario las escriba en el modelo IFC.

---

## 4. Principios para refinar

- **Sugerencia basada en estructura, no en texto libre:** TALO (ya asignado) + método constructivo (elementti, paikallavalettu, sandwich, …) + opcionalmente tipología de proyecto (hall). No depender de que el nombre del elemento contenga palabras clave.
- **Usar el mapeo y las plantillas como fuente de verdad:** Para un TALO + método + contexto, los candidatos Littera deben venir de talo_littera_mapping y de la fila de plantilla correspondiente (rango de códigos, actividades, unidades).
- **Priorizar 1–2 Littera cuando el paquete es aliurakka completa:** En muchos casos (sandwich, sokkelit, ventanas/puertas) la práctica es un código o un conjunto muy pequeño; la sugerencia no debe devolver listas largas por defecto.
- **No activar sugerencia automática hasta que sea suficientemente exacta:** Preferir que el usuario asigne Littera (tabla, Excel) mientras la lógica no esté basada en TALO + método + mapping/plantillas.

**Fuera de alcance por ahora (explícito):**

- Cubrir todos los tipos de edificio; el refinamiento se hace para halls (sandwich + sokkelit, logística/deporte/retail).
- Resolver casos donde el usuario quiera desglose muy fino por työvaihe y al mismo tiempo “un código por elemento” en UI; se puede documentar más adelante.

---

## 5. Pendiente para contrastar

Lista de afirmaciones o preguntas para validar después (con proyectos reales, expertos o datos):

- [ ] Para **1241 sandwich** en un hall, ¿se suele usar 1 código (kokonaisurakka) o 2–3 (toimitus, asennus, saumat por separado)?
- [ ] ¿El contexto **autohall, garage** en plantillas es adecuado para logística / retail (S-market, Sale) o conviene un contexto “hall” más genérico?
- [ ] Para **1212 sokkelit**, ¿los códigos 3152020, 3152040, 3152060 cubren la práctica habitual o faltan variantes (espesor, no portante/portante)?
- [ ] En **1221 alapohjalaatta** para hall, ¿la distinción 287 (autohalli) vs 231–260 (genérico) coincide con cómo se presupuesta en obra?
- [ ] Para **vesikatto (1261, 1262)**, ¿kate + eriste + varusteet se contratan como un aliurakka o por partidas separadas con frecuencia?
- [ ] ¿Las unidades en littera-prices y en el mapping (M2, JM, KPL, BRM2, ERÄ) coinciden con las que se usan en ofertas/mediciones para estos proyectos?

---

## 6. Contrastar con sample de datos (sin afectar el flujo actual)

Al abrir Cost Page sin cargar datos, hay dos samples disponibles:

- **Load Sample Data:** proyecto residencial (Helsinki, 5 plantas); TALO 1232, 1311, 1234, 1325, 2430, 3310, 4100, 2210. Sirve para probar la tabla y el flujo general.
- **Load Hall Sample:** proyecto tipo hall (sandwich + sokkelit) pensado para **contrastar** este documento. No sustituye al sample residencial ni cambia el comportamiento por defecto de la app.

**Contenido del Hall Sample** (`src/data/__examples__/sampleHallCostData.ts`):

| id  | name (resumido)                    | TALO | tipo IFC   | Cantidades (ej.) |
|-----|------------------------------------|------|------------|------------------|
| 101 | Sokkelielementti (kantava) AS      | 1212 | IfcWall    | 320 m²           |
| 102 | Sandwich-ulkoseinäelementti        | 1241 | IfcWall    | 1200 m²          |
| 103 | Alapohjalaatta (autohalli)         | 1221 | IfcSlab    | 2500 m², 375 m³  |
| 104 | Kantavat seinäelementit           | 1232 | IfcWall    | 180 m²           |
| 105 | Vesikattorakenteet                 | 1261 | IfcRoof    | 2500 m²          |
| 106 | Ikkunat, toimitus ja asennus       | 1242 | IfcWindow  | 24 KPL, 72 m²    |
| 107 | Kevyt väliseinä, runko ja levytys  | 1311 | IfcWall    | 240 m²           |

Los costes del hall sample vienen a 0 para que la tabla y el flujo de asignación de Littera/cálculo se prueben sin cifras fijas. Para contrastar:

1. Cargar **Load Hall Sample**.
2. Revisar en la tabla qué TALO y nombres tiene cada fila.
3. Comparar con la sección 3 (correspondencia) y con las plantillas `littera-filter-templates.csv`: para cada TALO + tipo IFC, ¿qué Littera esperaríamos según el doc?
4. (Opcional) Asignar Littera manualmente o vía Excel y comprobar que los rangos/códigos que usamos coinciden con lo documentado.

Así se puede validar el documento frente a un conjunto de datos estable sin tocar el sample residencial ni el flujo actual.

---

*Documento vivo: refinar en conversación y actualizar este archivo. Después, contrastar con práctica y datos.*
