# Configuración MCP para Costa

Instrucciones para usar Costa con Claude Desktop y el MCP (Model Context Protocol).

**Para el equipo:** Cada persona debe configurar Claude Desktop en su propio equipo. Este documento y el archivo `claude_desktop_config.costa.example.json` están en el repo para facilitar la configuración.

## Requisitos

- Node.js >= 16
- [Claude Desktop](https://claude.ai/download) instalado
- Costa clonado y dependencias instaladas

## Pasos

### 1. Instalar dependencias

```bash
git pull
npm install
cd mcp-server && npm install
```

### 2. Configurar Claude Desktop (manual)

Cada persona edita su propio `claude_desktop_config.json`. **No borres** otros MCPs (p. ej. Revit).

**Forma más fácil:** Claude → Settings → Developer → **Edit config**.

Añade o actualiza el bloque `costa-mcp` (sustituye `RUTA_AL_REPO_Costa` por tu clon):

```json
"costa-mcp": {
  "command": "C:\\Program Files\\nodejs\\node.exe",
  "args": [
    "RUTA_AL_REPO_Costa\\mcp-server\\node_modules\\tsx\\dist\\cli.mjs",
    "RUTA_AL_REPO_Costa\\mcp-server\\main.ts"
  ]
}
```

Ejemplo completo: `docs/claude_desktop_config.costa.example.json`

**Ubicación del archivo (Windows — importante):**

| Instalación | Ruta |
|-------------|------|
| **Microsoft Store** | `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude_desktop_config.json` |
| Instalador .exe | `%APPDATA%\Claude\claude_desktop_config.json` |

En Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

Si no estás seguro, usa **Edit config** en Claude: abre el archivo correcto.

**Reinicia Claude Desktop** después de guardar.

> Si cambias de carpeta el clon del repo, actualiza las dos rutas en `args` y reinicia Claude.

### 3. Variables de entorno de la app

Crea un archivo `.env` en la raíz del proyecto (o copia `.env.example`):

```
VITE_MCP_WS_URL=ws://localhost:8081
```

### 4. Arrancar

1. **Claude Desktop** – ábrelo (arrancará el MCP automáticamente).
2. **App Costa** – `npm run dev`.
3. Entra a un proyecto en Costa (ProjectDetailsPage con IFCViewer).
4. En Claude, pide por ejemplo: *"Usa costa_load_ifc para cargar el IFC en /ruta/completa/al/archivo.ifc"*.

## Procedimiento rápido (equipo)

Tras cada `git pull`:

```bash
git pull
npm install
```

Si cambió `mcp-server/package-lock.json`: `cd mcp-server && npm install`

**Si el pull tocó `mcp-server/`** (código MCP, no solo docs):

1. **Cierra y reabre Claude Desktop** (Developer → `costa-mcp` = running).
2. `npm run dev` y abre un **proyecto** con IFCViewer.
3. **F5** en el navegador hasta ver en consola: `✅ [Costa MCP] Connected to WebSocket`.
4. En Claude: `costa_ping_store_connection` o `costa_groups_list`.

Si la pestaña llevaba tiempo abierta antes de arrancar Claude, el cliente WS puede agotar reintentos; un **F5 completo** suele bastar (no hace falta reiniciar el PC).

**Si el pull no tocó `mcp-server/`:** basta con tener Claude + Costa abiertos y probar una tool.

Chequeo parcial en PowerShell (puerto, lock, log — **no sustituye** el ping en Claude):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-costa-mcp-health.ps1
```

`RESULT: HEALTHY` confirma sobre todo pasos A+C (puerto + log). Sigue haciendo el ping en Claude (paso D).

Guía corta en finés: `docs/MCP_ASETUKSET.md`

`.env` en la raíz (una vez):

```env
VITE_MCP_WS_URL=ws://localhost:8081
```

### 5. Probar costa_load_ifc

Con la app abierta en un proyecto y Claude Desktop activo:

- *"Usa costa_load_ifc para cargar el IFC en /ruta/completa/al/archivo.ifc"*
- O: *"Carga el IFC en Costa: /ruta/al/archivo.ifc"*

**Nota:** Si tienes también el MCP de MigrationF3 configurado, Claude verá dos herramientas de carga. La de Costa se llama `costa_load_ifc`; indica explícitamente que quieres usar Costa para evitar que Claude llame al MCP equivocado.

El modelo debería aparecer en el IFCViewer.

## Catálogo oficial de herramientas MCP (Costa)

Esta sección es la referencia única para el equipo. Si se añaden herramientas nuevas en `mcp-server/main.ts`, actualiza esta lista en el mismo commit.

> Claude Desktop mostrará únicamente las herramientas que existan realmente en `mcp-server/main.ts` en cada versión del repo.

### Herramientas de conexión y modelo

| Herramienta | Canal | Qué hace |
|-------------|-------|----------|
| `costa_load_ifc` | WebSocket (binario) | Carga un IFC en IFCViewer. Input: `{ "path": "/ruta/completa/al/archivo.ifc" }` |
| `costa_ping_store_connection` | WebSocket | Comprueba que el bridge WS/store está activo. Devuelve stats básicas del store. |
| `costa_get_ifc_types_in_store` | WebSocket | Lista todos los tipos IFC en el CostPage store con conteos. Llamar tras ping para sesiones de mejora Littera. |
| `costa_get_elements` | WebSocket | Lista elementos con filtros opcionales (`ifcType`, `nameContains`, `globalId`, `maxResults`). Usa IFCViewer si está cargado; si no, usa CostStore como fallback. |
| `costa_get_element_properties` | WebSocket | Propiedades y cantidades (`baseQuantities`, `dimensions`) de elementos por `expressId`. |
| `costa_select_elements` | WebSocket | Reemplaza la selección live por los `ids` dados (sin ancla). Ghost = transparencia de materiales en IFCViewer. Input: `{ "ids": [101, 205], "style"?: "cost-select" }`; `visualMode: "isolate"` opcional. Respuesta: `selectedCount` / `ids` del live real. |
| `costa_get_viewer_selection` | WebSocket | Devuelve la selección live actual (`ids`, `fragmentIdMap`, `count`). |
| `costa_groups_list` | WebSocket | Lista grupos CostaBIM (`name` + `expressIds`); mismo documento que UI / `localStorage`. |
| `costa_groups_get_members` | WebSocket | Miembros de un grupo Costa resueltos contra el IFC cargado (solo lectura). |
| `costa_groups_extract` | WebSocket | Extracción IFC selectiva por grupo Costa (props + cantidades base opcionales). |
| `costa_groups_select` | WebSocket | Resalta / aísla un grupo Costa en IFCViewer (`cost-select`; `visualMode: isolate` opcional). |
| `costa_groups_create` | WebSocket | Crea un grupo Costa (`name` + `expressIds`). Falla si el nombre ya existe. Mismo documento que UI / `localStorage`. |
| `costa_groups_update` | WebSocket | Actualiza un grupo existente por `groupId` o `groupName`. Nuevo `name` y/o `expressIds` (reemplaza la lista entera). |
| `costa_groups_create_complement` | WebSocket | **Paso 2 MCP:** nuevo grupo = todos los expressIds del IFC en visor **menos** uno o más grupos Costa existentes. |
| `costa_groups_prepare_measurement_export` | WebSocket | Preflight export Excel medición para grupo(s) Costa. Requiere CostStore (Cost → Send to Quantities & Cost). |
| `costa_groups_export_measurement_excel` | WebSocket | Exporta grupo(s) al Excel IFC Measurement. Columna **Group** (inglés). Filename = nombre del grupo. Descarga en navegador. |
| `costa_filter_and_select_elements` | WebSocket | Filtra y selecciona coincidencias. Con `replaceSelection` true (defecto) y V2: une el live previo como ancla al resultado. `style` opcional (`cost-select` / `search-preview`). |

### Herramientas de análisis Littera/TALO

| Herramienta | Canal | Qué hace |
|-------------|-------|----------|
| `costa_search_littera_catalog` | Local (repo) | Busca en `src/data/littera.json`. Usar **siempre** antes de proponer un código. Soporta `query`, `codePrefix`, `codes`, `categoryContains`. |
| `costa_analyze_littera_by_ifc_type` | WebSocket | Análisis de congruencia Littera agrupado por IFC Type + TALO Code. Devuelve scoring semántico y `approvalPayload`. |
| `costa_suggest_cost_codes` | WebSocket | Sugerencias TALO/Littera desde servicios del cliente para uno o varios elementos. |

### Herramientas de escritura Excel

| Herramienta | Canal | Qué hace |
|-------------|-------|----------|
| `costa_clone_excel_without_changes` | Local | Copia byte a byte el Excel original. **Usar siempre antes de escribir.** |
| `costa_probe_excel_store_ifc_link` | Híbrido | Diagnóstico 3 niveles: Excel / CostStore / IFC para un GUID. Solo lectura. |
| `costa_set_littera_codes_for_guid_in_excel` | Local | Escritura quirúrgica para **un** grupo GUID. `writeMode: "inplace"` (defecto, seguro). Para 2+ grupos usar el batch. |
| `costa_set_littera_codes_batch_in_excel` | Local | Procesa N grupos GUID en un solo ciclo lectura/escritura. Más rápido y seguro para lotes. Siempre `dryRun: true` primero. |
| `costa_fill_talo_in_excel` | Híbrido | Rellena columna TALO Code en Excel con sugerencias del store. |
| `costa_improve_littera_in_excel` | — | **BLOQUEADA** (`WRITE_BLOCKED`). No usar. |
| `costa_export_measurement_excel` | WebSocket | Dispara exportación Excel desde la app (descarga en navegador). |

### Herramientas de aplicación al store y checkpoints

| Herramienta | Canal | Qué hace |
|-------------|-------|----------|
| `costa_apply_cost_codes` | WebSocket | Aplica TALO/Littera directamente en CostStore (en memoria, no en Excel). |
| `costa_list_review_checkpoints` | WebSocket | Lista checkpoints guardados en `localStorage`. |
| `costa_save_review_checkpoint` | WebSocket | Guarda un checkpoint de revisión en `localStorage`. |
| `costa_get_review_checkpoint` | WebSocket | Lee un checkpoint con `resumeInstruction` y estrategia sugerida. |

## Solución de problemas

### Conexión app ↔ MCP

- **"No Costa app WebSocket client connected"** — Abre un proyecto en Costa (IFCViewer montado). Si Claude ya estaba arriba, **F5** en la pestaña del visor.
- **Consola sin `Connected`** tras varios intentos — La pestaña puede haber agotado reintentos WS. **F5** con Claude ya en marcha (`costa-mcp` running).
- **Ping OK pero store vacío** — Normal si no has pasado por CostPage; el bridge puede estar bien con `Connection: ok` y modelo IFC cargado. Para **export de grupos** o Littera: IFCViewer → **Cost** → **Send to Quantities & Cost** → esperar cálculo en Quantities & Cost → volver al visor y reintentar.

### Claude no ve tools o MCP “caído”

1. Developer → `costa-mcp` debe estar **running**.
2. **Reinicia Claude** tras cambios en `mcp-server/`.
3. Log: `%LOCALAPPDATA%\Claude\logs\mcp-server-costa-mcp.log` (Store) o `%APPDATA%\Claude\logs\…` (.exe).
   - Buscar `Bridge primary` o `Bridge secondary` (relay entre instancias de Claude).
   - **Mal:** `Couldn't start for Cowork`, `WebSocket bridge failed`, o `Exiting duplicate` (código antiguo → `git pull` + reiniciar Claude).
4. `netstat -ano | findstr 8081` — idealmente **un** `LISTENING` y al menos un `ESTABLISHED` (navegador conectado).

### Puerto y procesos

- **Puerto 8081 en uso** — Cierra Claude por completo, comprueba que no queden `node.exe` con `mcp-server\main.ts`, vuelve a abrir Claude.
- **Varios LISTENING en 8081** — Suele indicar instancias zombie; cierra Claude, mata procesos huérfanos, reinicia.
- Para cambiar puerto: edita `mcp-server/main.ts` y `VITE_MCP_WS_URL` en `.env`.

### Convivencia con otros MCP

- **Revit** (`claude-in-revit`, etc.) puede convivir en el mismo `claude_desktop_config.json`. No borres otros bloques al añadir `costa-mcp`.
- Claude puede arrancar **varias** instancias del servidor Costa (Cowork/Code); el primary mantiene el WebSocket en :8081 y las secondaries hacen relay. Si algo falla, reiniciar Claude suele ser más fiable que matar puertos a mano.

### Script de diagnóstico

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify-costa-mcp-health.ps1
```

Útil como **prefiltro** (lock, puerto, log). Siempre valida al final con `costa_ping_store_connection` en Claude.
