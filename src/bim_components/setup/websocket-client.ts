import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as WEBIFC from "web-ifc";
import { CostCalculator } from "../Cost";
import { useCostStore } from "../../stores/CostStore";
import { summarizeAbPolicies } from "../../utils/abPolicySummary";
import { aggregateStoreElementsByIfcType } from "../../utils/storeIfcTypeAggregation";
import { getMeasurementFeatureFlagsSnapshot } from "../../utils/measurementFeatureFlags";
import {
  detectIfcOriginKind,
  proposeFacadeLayerAssembly,
  resolveLayerRole,
  FACADE_ASSEMBLY_KEY,
  FACADE_TALO_HINT,
  DEFAULT_HOST_NAMES,
  DEFAULT_LAYER_NAMES,
  DEFAULT_OTHER_WALL_NAMES,
} from "../../utils/layerAssemblyPolicy";
import { PIECE_WIDTH_M, computeFootprintEdges, computeSpanLinePoints, resolveFieldLength, resolvePerpWidth, computePieceCount } from "../../utils/ontelolaattaUtils";
import { suggestTaloAssignments } from "../../services/TaloSuggestionService";
import { suggestLitteraAssignments } from "../../services/LitteraSuggestionService";
import { LitteraFilteringService } from "../../services/LitteraFilteringService";
import litteraDictJson from "../../data/littera.json";
import { getMainGroupFromLitteraCode, getMainGroupFromTaloCode } from "../../utils/costGroupUtils";
import {
  buildFragmentIdMapForIds,
  getExpressIdsFromFragmentIdMap,
  inferIfcType,
  queryIfcElements,
  type IfcElementQueryFilters,
  type IfcElementQueryRow,
} from "../../utils/ifcElementQuery";
import {
  applyMcpAutoSelectionVisual,
  buildCostaViewerSelectionState,
  getViewerSelectionSnapshotLegacy,
  type CostaResetViewerVisualOptions,
} from "../../utils/costaViewerStateMcp";
import {
  createNamedGroupFromExpressIds,
  enrichNamedGroupsWithGlobalIds,
  getCostaGroupsBucketMeta,
  getCostaGroupsDocument,
  refreshCostaGroupsBucketIfcFileName,
  updateNamedGroup,
} from "../../utils/costaGroups";
import {
  collectExpressIdsFromFragmentModel,
  createComplementNamedGroup,
  extractCostaGroupFromIfc,
  readCostaGroupMembersFromIfc,
  resolveCostaGroup,
} from "../../utils/costaGroupsMcp";
import {
  COSTA_MCP_COMPLEMENT_USE_STORE_V1,
  COSTA_MCP_STRICT_V1,
} from "../../utils/measurementFeatureFlags";
import { countFragmentIdMap } from "../../utils/viewerSelection";
const MCP_WS_URL_FROM_ENV =
  typeof import.meta !== "undefined" ? String(import.meta.env?.VITE_MCP_WS_URL ?? "").trim() : "";
const MCP_WS_URL = MCP_WS_URL_FROM_ENV || "ws://localhost:8081";

function refreshCostaGroupsUi(): void {
  if (typeof window === "undefined") return;
  (
    window as unknown as { __costaRefreshMwGroupingFooter?: () => void }
  ).__costaRefreshMwGroupingFooter?.();
  (
    window as unknown as { __costaRefreshMeasurementGroupSelect?: () => void }
  ).__costaRefreshMeasurementGroupSelect?.();
  try {
    window.dispatchEvent(new CustomEvent("costa-named-groups-changed"));
  } catch {
    /* noop */
  }
}

function serializeNamedGroupForMcp(group: {
  id: string;
  name: string;
  expressIds: number[];
  elementCount: number;
}) {
  return {
    id: group.id,
    name: group.name,
    expressIds: group.expressIds,
    memberCount: group.expressIds.length,
  };
}

/** Resuelve components vivos del visor (no la referencia del closure del WebSocket). */
function resolveLiveComponents(fallback?: OBC.Components): OBC.Components | null {
  if (typeof window === "undefined") return fallback ?? null;
  if (!(window as unknown as { __ifcViewerActive?: boolean }).__ifcViewerActive) {
    return null;
  }
  const fromWindow = (
    window as unknown as { getIFCComponents?: () => OBC.Components }
  ).getIFCComponents?.();
  if (fromWindow) {
    try {
      fromWindow.get(OBC.IfcLoader);
      return fromWindow;
    } catch {
      return null;
    }
  }
  return fallback ?? null;
}

function sendMcpIfcLoadAck(
  ws: WebSocket | null | undefined,
  payload: { ok: boolean; queued?: boolean; message?: string; error?: string }
): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "costa_load_ifc:ack", ...payload }));
}

/** Carga bytes IFC enviados por costa_load_ifc. Reutilizable al abrir IFCViewer. */
export async function loadMcpIfcFromBytes(
  uint8Array: Uint8Array,
  components: OBC.Components,
  ws?: WebSocket | null
): Promise<{ ok: boolean; queued?: boolean; error?: string }> {
  const ifcLoader = components.get(OBC.IfcLoader);

  (window as any).ifcRawBuffer = uint8Array;
  if (!(window as any).ifcFilename || (window as any).ifcFilename === "mcp-loaded-model.ifc") {
    (window as any).ifcFilename = "mcp-loaded-model.ifc";
  }

  const ifcLoaderRaw = ifcLoader as { webIfc: unknown; cleanUp: () => void };
  if (ifcLoaderRaw.webIfc === null) {
    ifcLoaderRaw.cleanUp();
  }

  const model = await ifcLoader.load(uint8Array);
  if (!model) {
    throw new Error("IfcLoader.load returned no model");
  }

  (window as any).fragmentModelRef = model;
  console.log("✅ [Costa MCP] IFC loaded successfully");
  sendMcpIfcLoadAck(ws, { ok: true });
  return { ok: true };
}

/** Si MCP envió IFC mientras CostPage estaba activa, cargar al montar IFCViewer. */
export async function processPendingMcpIfcLoad(
  components: OBC.Components,
  ws?: WebSocket | null
): Promise<boolean> {
  const pending = (window as unknown as { __pendingMcpIfcLoad?: Uint8Array }).__pendingMcpIfcLoad;
  if (!pending?.length) return false;

  delete (window as unknown as { __pendingMcpIfcLoad?: Uint8Array }).__pendingMcpIfcLoad;
  console.log("[Costa MCP] Loading buffered IFC from MCP (viewer now active)…");
  try {
    await loadMcpIfcFromBytes(pending, components, ws);
    return true;
  } catch (err) {
    console.error("[Costa MCP] Buffered IFC load failed:", err);
    sendMcpIfcLoadAck(ws, {
      ok: false,
      error: `IFC load error: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalización local para comparación/agrupación interna (lowercase + colapsa espacios).
// Distinta de normalizeRevitName en costTableGrouping.ts que conserva el case y solo recorta el sufijo :NNN.
function normalizeRevitName(name: string): string {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/g, "")
    .replace(/\s+/g, " ");
}

function tokenizeForSemanticMatch(input: string): string[] {
  return String(input ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9åäö]+/gi, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

function taloPrefix4(taloCode: string): string {
  const m = String(taloCode ?? "").trim().match(/^(\d+\.\d+\.\d+\.\d+)/);
  return m ? m[1] : "";
}

function getFragmentModelRef(): any | null {
  return (window as any)?.fragmentModelRef ?? null;
}

function getCostStoreData(): any[] {
  const globalStore = (window as any)?.__costStore?.getState?.() as any;
  const store = (globalStore ?? useCostStore.getState()) as any;
  const fromCostData = Array.isArray(store?.costData) ? store.costData : [];
  const fromAnalysis = Array.isArray(store?.analysisResult?.elementCosts)
    ? store.analysisResult.elementCosts
    : [];
  const fromCostPageSnapshot = Array.isArray((window as any)?.__costPageEffectiveData)
    ? (window as any).__costPageEffectiveData
    : [];

  // Priorizar costData; si esta vacio, usar el snapshot de analysisResult.
  if (fromCostData.length > 0) return fromCostData;
  if (fromAnalysis.length > 0) return fromAnalysis;
  if (fromCostPageSnapshot.length > 0) return fromCostPageSnapshot;
  return [];
}

/** Costa Measurement Excel export: prefer populated CostStore (Cost → Send to Quantities & Cost). */
function pickCostStoreElementsByIds(ids: number[]): any[] {
  const requestedIds = new Set(ids.map((n) => Number(n)).filter((n) => !isNaN(n)));
  if (!requestedIds.size) return [];
  return getCostStoreData().filter((el: any) => {
    const id = Number(el?.id ?? el?.expressId);
    return !isNaN(id) && requestedIds.has(id);
  });
}

function pickCostStoreElementsByIfcTypes(ifcTypes: string[]): any[] {
  const typeSet = new Set(ifcTypes.map((t) => String(t).toLowerCase()));
  return getCostStoreData().filter((el: any) =>
    typeSet.has(String(el?.type ?? "").toLowerCase())
  );
}

function mapElementForMcp(el: any) {
  const extra = el?.extraProperties ?? {};
  const blocked = extra["CostaBIM.PublishedBlocked"] === 1;
  const contribute = blocked ? 0 : extra["CostaBIM.ContributeToMaara"];
  const publishedRaw = blocked
    ? null
    : extra["CostaBIM.PublishedQuantity"] ??
      (typeof el?.quantity === "number" ? el.quantity : null);
  const published = contribute === 0 && !blocked ? 0 : publishedRaw;
  return {
    id: Number(el?.id ?? el?.expressId),
    globalId: el?.globalId ?? null,
    name: el?.name ?? "",
    type: el?.type ?? "",
    floor: el?.floor ?? null,
    taloCode: el?.taloCode ?? "",
    taloName: el?.taloName ?? "",
    quantity: blocked ? 0 : contribute === 0 ? 0 : typeof el?.quantity === "number" ? el.quantity : published,
    publishedQuantity: blocked ? null : published,
    publishedUnit: blocked ? null : contribute === 0 ? extra["CostaBIM.LayerOwnUnit"] ?? null : extra["CostaBIM.PublishedUnit"] ?? null,
    layerRole: extra["CostaBIM.LayerRole"] ?? extra["CostaBIM.LayerRoleProposed"] ?? null,
    contributeToMaara: blocked ? 0 : contribute === 0 ? 0 : 1,
    layerOwnQuantity: extra["CostaBIM.LayerOwnQuantity"] ?? null,
    baseQuantities: el?.baseQuantities ?? {},
    extraProperties: extra,
  };
}

function getCostStoreStats() {
  const globalStore = (window as any)?.__costStore?.getState?.() as any;
  const store = (globalStore ?? useCostStore.getState()) as any;
  const fromCostData = Array.isArray(store?.costData) ? store.costData.length : 0;
  const fromAnalysis = Array.isArray(store?.analysisResult?.elementCosts)
    ? store.analysisResult.elementCosts.length
    : 0;
  const fromSnapshot = Array.isArray((window as any)?.__costPageEffectiveData)
    ? (window as any).__costPageEffectiveData.length
    : 0;
  return {
    source: globalStore ? "window.__costStore" : "useCostStore",
    costData: fromCostData,
    analysisElementCosts: fromAnalysis,
    costPageSnapshot: fromSnapshot,
    abPolicies: summarizeAbPolicies(getCostStoreData()),
    featureFlags: getMeasurementFeatureFlagsSnapshot(),
    layerAssembly: (store as any)?.layerAssembly ?? useCostStore.getState().layerAssembly,
  };
}

function getViewerIfcOriginKind() {
  const w = window as unknown as {
    __ifcSourceSoftware?: string;
    ifcFilename?: string;
    __ifcApplicationName?: string;
  };
  return detectIfcOriginKind(w.__ifcSourceSoftware, w.ifcFilename, w.__ifcApplicationName);
}

/** CostStore first; if CostPage is still computing, the loaded IFC in the viewer. */
async function collectTaloElementPool(): Promise<{ pool: any[]; source: "costStore" | "fragmentModel" | "empty" }> {
  const costData = getCostStoreData();
  if (costData.length > 0) return { pool: costData as any[], source: "costStore" };

  const fragmentModel = getFragmentModelRef();
  if (!fragmentModel) return { pool: [], source: "empty" };

  const pool: any[] = [];
  const seenExpressIds = new Set<number>();
  try {
    outer: for (const fragment of fragmentModel.items as any[]) {
      for (const expressId of fragment.ids as any) {
        const idNum = Number(expressId);
        if (!Number.isFinite(idNum) || seenExpressIds.has(idNum)) continue;
        seenExpressIds.add(idNum);
        let element: any = null;
        try {
          element = await fragmentModel.getProperties(idNum);
        } catch {
          continue;
        }
        if (!element) continue;
        pool.push({
          id: idNum,
          expressId: idNum,
          globalId: element.GlobalId?.value ?? null,
          name: element.Name?.value ?? "",
          type: inferIfcType(element.type),
          taloCode: "",
        });
        if (pool.length >= 30000) break outer;
      }
    }
  } catch (e) {
    console.warn("[Costa MCP] collectTaloElementPool:", e);
  }
  return { pool, source: pool.length > 0 ? "fragmentModel" : "empty" };
}

function inferLitteraRole(name: string): string {
  const n = String(name || "").toLowerCase();
  if (n.includes("toimitus")) return "supply";
  if (n.includes("asennus")) return "installation";
  if (n.includes("sauma") || n.includes("tiiv")) return "joints-sealing";
  if (n.includes("maala") || n.includes("pinta") || n.includes("viimeist")) return "finishing";
  return "general";
}

function inferCostComponentsFromLitteraDescription(description: string): string[] {
  const d = String(description || "").toLowerCase();
  const components = new Set<string>();

  // Heurísticas semánticas basadas en el propio catálogo (strings Finnish).
  // - "toimitus" / suministro -> material
  // - "asennus" / instalación -> labor
  // - "asennettuna" suele implicar "entregado + instalado", por eso cuenta para material y labor.
  // - "kuljetus" / transporte -> subcontract
  // - "urakka" / workpackage -> subcontract (si aparece en el texto)
  // - "listoitus", "maalaus", "pinta", etc. -> labor (acabados)
  if (d.includes("toimitus")) components.add("material");
  if (d.includes("asennus")) components.add("labor");
  if (d.includes("asennett")) {
    components.add("labor");
    components.add("material");
  }
  if (d.includes("kuljet")) components.add("subcontract");
  if (d.includes("urakka")) components.add("subcontract");
  if (d.includes("listoit") || d.includes("maala") || d.includes("pinta") || d.includes("viimeist")) {
    components.add("labor");
  }

  // Si no hay señales claras, no asumimos: dejamos sin componente explícito.
  return Array.from(components);
}

function includesDemolitionTerms(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return /(^|\W)(purku|purkaminen|demolition|poisto)(\W|$)/i.test(t);
}

function hasStrongFurnishingSemanticMatch(elementName: string, litteraDescription: string): boolean {
  const n = String(elementName || "").toLowerCase();
  const d = String(litteraDescription || "").toLowerCase();
  const keywords = [
    "peili",
    "hylly",
    "lokerikko",
    "taso",
    "kaluste",
    "kaappi",
    "tuoli",
    "poyta",
    "penkki",
  ];
  return keywords.some((kw) => n.includes(kw) && d.includes(kw));
}

export type { IfcElementQueryFilters, IfcElementQueryRow };

function resolveMcpVisualMode(msg: {
  visualMode?: string;
  isolate?: boolean;
}): "ghost" | "isolate" | "none" {
  const raw =
    typeof msg.visualMode === "string" && msg.visualMode.trim()
      ? String(msg.visualMode).trim().toLowerCase()
      : "";
  if (raw === "isolate" || msg.isolate === true) return "isolate";
  if (raw === "none") return "none";
  return "ghost";
}

/** @deprecated Use buildCostaViewerSelectionState via MCP — legacy live-bag snapshot. */
export function getViewerSelectionSnapshot(): {
  ok: boolean;
  error?: string;
  count: number;
  ids: number[];
  fragmentIdMap: Record<string, number[]>;
} {
  return getViewerSelectionSnapshotLegacy();
}

export function setupMCPWebSocket(components?: OBC.Components): WebSocket | null {
  if (typeof WebSocket === "undefined") {
    console.log("[Costa MCP] Skipping WebSocket: WebSocket API not available in this runtime.");
    return null;
  }

  if (!MCP_WS_URL_FROM_ENV) {
    console.log("[Costa MCP] VITE_MCP_WS_URL not set; using default ws://localhost:8081.");
  }

  const existing = (window as unknown as { mcpWebSocket?: WebSocket }).mcpWebSocket;
  if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
    return existing;
  }

  console.log("[Costa MCP] Connecting to", MCP_WS_URL);
  const ws = new WebSocket(MCP_WS_URL as string);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    console.log("✅ [Costa MCP] Connected to WebSocket");
    (window as any).__mcpReconnectAttempts = 0; // reset backoff counter on success
  };

  ws.onmessage = async (event: MessageEvent) => {
    try {
      // 1) IFC binary sent from MCP (load-ifc tool)
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        console.log("📦 [Costa MCP] Received IFC data from Claude");

        try {
          let uint8Array: Uint8Array;
          if (event.data instanceof ArrayBuffer) {
            uint8Array = new Uint8Array(event.data);
          } else {
            const arrayBuffer = await event.data.arrayBuffer();
            uint8Array = new Uint8Array(arrayBuffer);
          }

          const liveComponents = resolveLiveComponents(components);
          if (!liveComponents) {
            (window as unknown as { __pendingMcpIfcLoad?: Uint8Array }).__pendingMcpIfcLoad =
              uint8Array;
            console.warn(
              "[Costa MCP] IFCViewer not active (e.g. on CostPage). IFC buffered — open a project to display it."
            );
            sendMcpIfcLoadAck(ws, {
              ok: true,
              queued: true,
              message:
                "IFC buffered until IFCViewer opens. Navigate to /project/… to load the model in the 3D viewer.",
            });
            return;
          }

          await loadMcpIfcFromBytes(uint8Array, liveComponents, ws);
        } catch (err) {
          console.error("[Costa MCP] IFC load failed:", err);
          sendMcpIfcLoadAck(ws, {
            ok: false,
            error: `IFC load error: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }

      // 2) JSON messages for future tools (get-measurement-state, etc.)
      if (typeof event.data === "string") {
        const msg = JSON.parse(event.data) as {
          type: string;
          requestId?: string;
          ids?: number[];
          ifcType?: string;
          nameContains?: string;
          globalId?: string;
          ifcTypes?: string[];
          taloCodes?: string[];
          litteraMainGroups?: number[];
          maxTypes?: number;
          includeCounts?: boolean;
          sessionId?: string;
          checkpoint?: Record<string, unknown>;
          filename?: string;
          maxResults?: number;
          maxSuggestions?: number;
          ifcTypeReview?: string;
          groupLimit?: number;
          elementLimit?: number;
          minConfidence?: number;
          extraColumns?: Array<{ key: string; header?: string }>;
          extraValuesById?: Record<string, Record<string, unknown>>;
          isolate?: boolean;
          visualMode?: "ghost" | "isolate" | "none";
          elements?: Array<{
            expressId?: number;
            globalId?: string;
            taloCode?: string;
            taloName?: string;
            litteraCode?: string;
            litteraName?: string;
            litteraCategory?: string;
          }>;
          dryRun?: boolean;
          outputFilename?: string;
          autoAssign?: boolean;
          skipExisting?: boolean;
          returnElements?: boolean;
          assignments?: Array<{
            id: number;
            taloCode?: string;
            litteraCode?: string;
            litteraName?: string;
            litteraCategory?: string | null;
            litteraUnit?: string;
            litteraSeries?: Array<{
              litteraCode: string;
              litteraName?: string;
              litteraCategory?: string | null;
              litteraUnit?: string;
            }>;
            mode?: "append" | "replace";
            allowTaloChange?: boolean;
            allowLitteraReplace?: boolean;
          }>;
        };

        // Mensaje de metadatos previo al binario IFC (enviado por costa_load_ifc)
        if (msg.type === "costa_load_ifc:filename") {
          if ((msg as any).filename) {
            (window as any).ifcFilename = String((msg as any).filename);
            (window as any).__ifcSourceSoftware = undefined;
            refreshCostaGroupsBucketIfcFileName();
            console.log(`[Costa MCP] IFC filename received: ${(window as any).ifcFilename}`);
          }
          return; // sin requestId — no requiere respuesta
        }

        if (!msg.type || !msg.requestId) return;

        if (msg.type === "costa_get_elements") {
          const fragmentModel = getFragmentModelRef();
          try {
            if (!fragmentModel) {
              ws.send(
                JSON.stringify({
                  type: "costa_get_elements:result",
                  requestId: msg.requestId,
                  result: {
                    count: 0,
                    truncated: false,
                    elements: [],
                    source: "empty",
                    error:
                      "No IFC in the viewer yet (fragmentModelRef missing). This tool reads the loaded model, not CostPage. Wait until the 3D is visible, or use costa_filter_and_select_elements.",
                  },
                })
              );
              return;
            }
            const { elements, truncated } = await queryIfcElements(fragmentModel, {
              ifcType: msg.ifcType,
              nameContains: msg.nameContains,
              globalId: msg.globalId,
              maxResults: msg.maxResults,
            });
            ws.send(
              JSON.stringify({
                type: "costa_get_elements:result",
                requestId: msg.requestId,
                result: {
                  count: elements.length,
                  truncated,
                  elements,
                  source: "fragmentModel",
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_get_elements:result",
                requestId: msg.requestId,
                result: {
                  count: 0,
                  truncated: false,
                  elements: [],
                  error: `Send error: ${err instanceof Error ? err.message : String(err)}`,
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_get_viewer_selection") {
          try {
            const state = buildCostaViewerSelectionState();
            ws.send(
              JSON.stringify({
                type: "costa_get_viewer_selection:result",
                requestId: msg.requestId,
                result: state,
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_get_viewer_selection:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                  liveBag: { count: 0, ids: [] },
                  searchCatalog: { count: 0, ids: [] },
                  autoSelection: { count: 0, ids: [] },
                  preview: { count: 0, ids: [] },
                  manualPaint: { count: 0, ids: [] },
                  groupAddMode: { activeId: null, pendingAddIds: [] },
                  treeScope: null,
                  lastPaintChannel: null,
                  effectiveForSaveGroup: { count: 0, ids: [] },
                  notes: [],
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_reset_viewer_visual_state") {
          try {
            const resetFn = window.__costaResetViewerVisualState;
            if (!resetFn) {
              throw new Error("Viewer reset hook not ready (IFCViewer not mounted).");
            }
            const opts = (msg.options ?? msg) as CostaResetViewerVisualOptions;
            await resetFn({
              hider: opts.hider === true,
              liveSelection: opts.liveSelection === true,
              treeScope: opts.treeScope === true,
              searchCatalog: opts.searchCatalog === true,
              searchFilters: opts.searchFilters === true,
              groupAddMode: opts.groupAddMode === true,
              autoAndPreviewPaint: opts.autoAndPreviewPaint === true,
            });
            const state = buildCostaViewerSelectionState();
            ws.send(
              JSON.stringify({
                type: "costa_reset_viewer_visual_state:result",
                requestId: msg.requestId,
                result: { ok: true, state },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_reset_viewer_visual_state:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_list") {
          try {
            const document = getCostaGroupsDocument();
            const bucketMeta = getCostaGroupsBucketMeta();
            const fragmentModel = getFragmentModelRef();
            ws.send(
              JSON.stringify({
                type: "costa_groups_list:result",
                requestId: msg.requestId,
                result: {
                  ...document,
                  groupCount: document.groups.length,
                  modelLoaded: Boolean(fragmentModel),
                  source: "costaGroupsDocument",
                  activeFingerprint: bucketMeta.activeFingerprint,
                  activeFingerprintShort: bucketMeta.activeFingerprintShort,
                  bucketCount: bucketMeta.bucketCount,
                  buckets: bucketMeta.buckets,
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_list:result",
                requestId: msg.requestId,
                result: {
                  version: 1,
                  updatedAt: Date.now(),
                  groups: [],
                  groupCount: 0,
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_create") {
          const fragmentModel = getFragmentModelRef();
          const expressIds = Array.isArray(msg.expressIds)
            ? msg.expressIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
            : [];
          const result = createNamedGroupFromExpressIds(
            String(msg.name ?? ""),
            expressIds,
            fragmentModel
          );
          if (result.ok) {
            refreshCostaGroupsUi();
            if (fragmentModel) {
              void enrichNamedGroupsWithGlobalIds(fragmentModel).then(() => refreshCostaGroupsUi());
            }
            ws.send(
              JSON.stringify({
                type: "costa_groups_create:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  group: serializeNamedGroupForMcp(result.group),
                  unresolvedIds: result.unresolvedIds,
                  modelLoaded: Boolean(fragmentModel),
                  source: "costaGroupsDocument",
                },
              })
            );
          } else {
            ws.send(
              JSON.stringify({
                type: "costa_groups_create:result",
                requestId: msg.requestId,
                result: { ok: false, error: result.error },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_update") {
          const fragmentModel = getFragmentModelRef();
          const hasExpressIds = Array.isArray(msg.expressIds);
          const expressIds = hasExpressIds
            ? msg.expressIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
            : undefined;
          const hasName = typeof msg.name === "string";
          if (!hasName && !hasExpressIds) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_update:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: "Provide name and/or expressIds to update.",
                },
              })
            );
            return;
          }
          const result = updateNamedGroup(
            { groupId: msg.groupId, groupName: msg.groupName },
            {
              ...(hasName ? { name: msg.name } : {}),
              ...(hasExpressIds ? { expressIds } : {}),
            },
            fragmentModel
          );
          if (result.ok) {
            refreshCostaGroupsUi();
            if (fragmentModel) {
              void enrichNamedGroupsWithGlobalIds(fragmentModel).then(() => refreshCostaGroupsUi());
            }
            ws.send(
              JSON.stringify({
                type: "costa_groups_update:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  group: serializeNamedGroupForMcp(result.group),
                  unresolvedIds: result.unresolvedIds,
                  modelLoaded: Boolean(fragmentModel),
                  source: "costaGroupsDocument",
                },
              })
            );
          } else {
            ws.send(
              JSON.stringify({
                type: "costa_groups_update:result",
                requestId: msg.requestId,
                result: { ok: false, error: result.error },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_create_complement") {
          const fragmentModel = getFragmentModelRef();
          const ifcTypes = Array.isArray(msg.ifcTypes)
            ? msg.ifcTypes.map((x: unknown) => String(x)).filter(Boolean)
            : undefined;
          const storeExpressIds = getCostStoreData()
            .map((el: any) => Number(el?.id ?? el?.expressId))
            .filter((n: number) => !isNaN(n) && n > 0);
          const result = createComplementNamedGroup(
            {
              name: String(msg.name ?? ""),
              excludeGroupId: (msg as { excludeGroupId?: string }).excludeGroupId,
              excludeGroupName: (msg as { excludeGroupName?: string }).excludeGroupName,
              excludeGroupIds: Array.isArray(
                (msg as { excludeGroupIds?: unknown }).excludeGroupIds
              )
                ? (msg as { excludeGroupIds: unknown[] }).excludeGroupIds.map((x) =>
                    String(x)
                  )
                : undefined,
              excludeGroupNames: Array.isArray(
                (msg as { excludeGroupNames?: unknown }).excludeGroupNames
              )
                ? (msg as { excludeGroupNames: unknown[] }).excludeGroupNames.map((x) =>
                    String(x)
                  )
                : undefined,
              ifcTypes,
            },
            fragmentModel,
            {
              useStoreUniverse: COSTA_MCP_COMPLEMENT_USE_STORE_V1,
              storeExpressIds,
            }
          );
          if (result.ok) {
            refreshCostaGroupsUi();
            if (fragmentModel) {
              void enrichNamedGroupsWithGlobalIds(fragmentModel).then(() => refreshCostaGroupsUi());
            }
            const strictWarnings: string[] = [];
            if (COSTA_MCP_STRICT_V1) {
              const ifcCount =
                result.ifcUniverseCount ??
                (fragmentModel ? collectExpressIdsFromFragmentModel(fragmentModel).length : 0);
              const storeCount = result.storeUniverseCount ?? storeExpressIds.length;
              if (storeCount > 0 && ifcCount > 0) {
                const deltaRatio = Math.abs(ifcCount - storeCount) / Math.max(storeCount, 1);
                if (deltaRatio > 0.05) {
                  if (result.universeSource === "store") {
                    strictWarnings.push(
                      `Viewer IFC (${ifcCount}) vs CostStore (${storeCount}) differ by ${(deltaRatio * 100).toFixed(1)}%. Complement uses store universe; 3D may show elements not in määrä.`
                    );
                  } else {
                    strictWarnings.push(
                      `IFC universe (${ifcCount}) differs from CostStore (${storeCount}) by ${(deltaRatio * 100).toFixed(1)}%. Enable complementUseStoreV1 or re-sync Send to Cost.`
                    );
                  }
                }
              }
              if (
                result.complementCount !== undefined &&
                result.group.expressIds.length !== result.complementCount
              ) {
                strictWarnings.push(
                  `Group expressIds (${result.group.expressIds.length}) != complementCount (${result.complementCount}).`
                );
              }
            }
            ws.send(
              JSON.stringify({
                type: "costa_groups_create_complement:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  operation: result.operation,
                  group: serializeNamedGroupForMcp(result.group),
                  universeCount: result.universeCount,
                  universeSource: result.universeSource,
                  ifcUniverseCount: result.ifcUniverseCount,
                  storeUniverseCount: result.storeUniverseCount,
                  strictWarnings: strictWarnings.length ? strictWarnings : undefined,
                  excludedFromUniverse: result.excludedFromUniverse,
                  excludedCount: result.excludedCount,
                  complementCount: result.complementCount,
                  ifcTypes: result.ifcTypes,
                  excludeGroups: result.excludeGroups,
                  unresolvedIds: result.unresolvedIds,
                  modelLoaded: Boolean(fragmentModel),
                  source: "costaGroupsDocument",
                },
              })
            );
          } else {
            ws.send(
              JSON.stringify({
                type: "costa_groups_create_complement:result",
                requestId: msg.requestId,
                result: { ok: false, error: result.error },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_get_members") {
          const liveComponents = resolveLiveComponents(components);
          const fragmentModel = getFragmentModelRef();
          if (!fragmentModel || !liveComponents) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_get_members:result",
                requestId: msg.requestId,
                result: {
                  error: "No IFC model loaded in the viewer.",
                  members: [],
                  unresolvedIds: [],
                },
              })
            );
            return;
          }
          const resolved = resolveCostaGroup(msg.groupId, msg.groupName);
          if ("error" in resolved) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_get_members:result",
                requestId: msg.requestId,
                result: { error: resolved.error, members: [], unresolvedIds: [] },
              })
            );
            return;
          }
          try {
            const indexer = liveComponents.get(OBC.IfcRelationsIndexer);
            const { members, unresolvedIds } = await readCostaGroupMembersFromIfc(
              fragmentModel,
              indexer,
              resolved.group.expressIds
            );
            ws.send(
              JSON.stringify({
                type: "costa_groups_get_members:result",
                requestId: msg.requestId,
                result: {
                  group: {
                    id: resolved.group.id,
                    name: resolved.group.name,
                    memberCount: resolved.group.expressIds.length,
                  },
                  members,
                  unresolvedIds,
                  source: "ifc",
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_get_members:result",
                requestId: msg.requestId,
                result: {
                  error: err instanceof Error ? err.message : String(err),
                  members: [],
                  unresolvedIds: [],
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_extract") {
          const liveComponents = resolveLiveComponents(components);
          const fragmentModel = getFragmentModelRef();
          if (!fragmentModel || !liveComponents) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_extract:result",
                requestId: msg.requestId,
                result: {
                  error: "No IFC model loaded in the viewer.",
                  rowCount: 0,
                  rows: [],
                },
              })
            );
            return;
          }
          const resolved = resolveCostaGroup(msg.groupId, msg.groupName);
          if ("error" in resolved) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_extract:result",
                requestId: msg.requestId,
                result: { error: resolved.error, rowCount: 0, rows: [] },
              })
            );
            return;
          }
          try {
            const indexer = liveComponents.get(OBC.IfcRelationsIndexer);
            const payload = await extractCostaGroupFromIfc(
              fragmentModel,
              indexer,
              resolved.group,
              {
                includeBaseQuantities: msg.includeBaseQuantities,
                includeProperties: msg.includeProperties,
                psetNameContains: msg.psetNameContains,
                maxMembers: msg.maxMembers,
              }
            );
            ws.send(
              JSON.stringify({
                type: "costa_groups_extract:result",
                requestId: msg.requestId,
                result: payload,
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_extract:result",
                requestId: msg.requestId,
                result: {
                  error: err instanceof Error ? err.message : String(err),
                  rowCount: 0,
                  rows: [],
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_groups_select") {
          const liveComponents = resolveLiveComponents(components);
          const fragmentModel = getFragmentModelRef();
          if (!fragmentModel || !liveComponents) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_select:result",
                requestId: msg.requestId,
                result: { ok: false, error: "No IFC model loaded in the viewer." },
              })
            );
            return;
          }
          const resolved = resolveCostaGroup(msg.groupId, msg.groupName);
          if ("error" in resolved) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_select:result",
                requestId: msg.requestId,
                result: { ok: false, error: resolved.error },
              })
            );
            return;
          }
          const ids = resolved.group.expressIds;
          if (ids.length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_select:result",
                requestId: msg.requestId,
                result: { ok: false, error: "Group has no members." },
              })
            );
            return;
          }
          try {
            const selection = await buildFragmentIdMapForIds(fragmentModel, ids);
            if (!selection || Object.keys(selection).length === 0) {
              ws.send(
                JSON.stringify({
                  type: "costa_groups_select:result",
                  requestId: msg.requestId,
                  result: {
                    ok: false,
                    error: "No matching elements in loaded IFC for this group.",
                    groupId: resolved.group.id,
                    groupName: resolved.group.name,
                  },
                })
              );
              return;
            }
            const visualMode = resolveMcpVisualMode(msg);
            const isolatedCount = countFragmentIdMap(selection as Record<string, Set<number>>);
            const resolvedExpressIds = new Set(
              getExpressIdsFromFragmentIdMap(selection as Record<string, Set<number>>)
            );
            const isolatedExpressCount = resolvedExpressIds.size;
            const matchedExpressCount = ids.filter((id) => resolvedExpressIds.has(Number(id))).length;
            if (COSTA_MCP_STRICT_V1 && visualMode === "isolate" && isolatedCount === 0) {
              ws.send(
                JSON.stringify({
                  type: "costa_groups_select:result",
                  requestId: msg.requestId,
                  result: {
                    ok: false,
                    error:
                      "isolate matched 0 fragments for this group — check group GUIDs vs loaded IFC.",
                    groupId: resolved.group.id,
                    groupName: resolved.group.name,
                    requestedCount: ids.length,
                    isolatedCount: 0,
                    visualMode,
                  },
                })
              );
              return;
            }
            await applyMcpAutoSelectionVisual(selection as Record<string, Set<number>>, visualMode);
            try {
              const world = (window as any).worldRef;
              world?.renderer?.update?.();
            } catch {
              /* ignore */
            }
            const state = buildCostaViewerSelectionState();
            const notes = [...(state.notes ?? [])];
            const strictWarnings: string[] = [];
            if (visualMode === "isolate" && isolatedCount > 0) {
              notes.push(
                "isolate uses Hider only — autoSelectionCount stays 0; see isolatedExpressCount (unique expressIds)."
              );
            }
            if (
              visualMode === "isolate" &&
              isolatedCount > matchedExpressCount &&
              matchedExpressCount > 0
            ) {
              notes.push(
                `isolatedCount (${isolatedCount}) counts fragment indices; isolatedExpressCount (${isolatedExpressCount}) is the membership metric on multi-fragment hosts.`
              );
            }
            if (
              COSTA_MCP_STRICT_V1 &&
              matchedExpressCount > 0 &&
              matchedExpressCount < ids.length
            ) {
              strictWarnings.push(
                `Group partially stale: ${matchedExpressCount}/${ids.length} expressIds resolve in loaded IFC (${((matchedExpressCount / ids.length) * 100).toFixed(2)}%).`
              );
              notes.push(
                `Partial match: ${matchedExpressCount}/${ids.length} group members belong to this model.`
              );
            }
            ws.send(
              JSON.stringify({
                type: "costa_groups_select:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  groupId: resolved.group.id,
                  groupName: resolved.group.name,
                  requestedCount: ids.length,
                  matchedExpressCount,
                  isolatedCount,
                  isolatedExpressCount,
                  autoSelectionCount: state.autoSelection.count,
                  autoSelectionIds: state.autoSelection.ids,
                  liveBagCount: state.liveBag.count,
                  visualMode,
                  strictWarnings: strictWarnings.length ? strictWarnings : undefined,
                  notes,
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_groups_select:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_filter_and_select_elements") {
          if (!components) {
            ws.send(
              JSON.stringify({
                type: "costa_filter_and_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: "Selection requires IFCViewer context." },
              })
            );
            return;
          }
          const fragmentModel = getFragmentModelRef();
          if (!fragmentModel) {
            ws.send(
              JSON.stringify({
                type: "costa_filter_and_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: "No IFC model loaded yet." },
              })
            );
            return;
          }

          try {
            const indexer = components.get(OBC.IfcRelationsIndexer);
            const respectTreeScope = msg.respectTreeScope === true;
            const treeIds =
              respectTreeScope && typeof window !== "undefined"
                ? window.__costaGetTreeScopeIds?.()
                : null;
            const { elements, truncated } = await queryIfcElements(
              fragmentModel,
              {
                ifcType: msg.ifcType,
                nameContains: msg.nameContains,
                globalId: msg.globalId,
                maxResults: msg.maxResults ?? 2000,
                searchInDescription: false,
                searchInPropertyNames: false,
                expressIdAllowList:
                  treeIds && treeIds.length > 0 ? treeIds : undefined,
              },
              { indexer }
            );
            if (elements.length === 0) {
              ws.send(
                JSON.stringify({
                  type: "costa_filter_and_select_elements:result",
                  requestId: msg.requestId,
                  result: {
                    ok: false,
                    error: respectTreeScope && treeIds && treeIds.length > 0
                      ? "No elements matched the filter within Model Tree scope."
                      : "No elements matched the filter.",
                    matchedCount: 0,
                    selectedCount: 0,
                    truncated,
                    respectTreeScope,
                  },
                })
              );
              return;
            }

            const ids = elements.map((el) => el.expressId);
            const selection = await buildFragmentIdMapForIds(fragmentModel, ids);
            if (!selection || Object.keys(selection).length === 0) {
              ws.send(
                JSON.stringify({
                  type: "costa_filter_and_select_elements:result",
                  requestId: msg.requestId,
                  result: {
                    ok: false,
                    error: "Could not build selection map.",
                    matchedCount: elements.length,
                    selectedCount: 0,
                    truncated,
                    respectTreeScope,
                  },
                })
              );
              return;
            }

            const visualMode = resolveMcpVisualMode(msg);
            await applyMcpAutoSelectionVisual(selection as Record<string, Set<number>>, visualMode);
            const state = buildCostaViewerSelectionState();

            ws.send(
              JSON.stringify({
                type: "costa_filter_and_select_elements:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  matchedCount: elements.length,
                  autoSelectionCount: state.autoSelection.count,
                  autoSelectionIds: state.autoSelection.ids,
                  liveBagCount: state.liveBag.count,
                  truncated,
                  ids,
                  visualMode,
                  respectTreeScope,
                  treeScopeCount: treeIds?.length ?? 0,
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_filter_and_select_elements:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                  matchedCount: 0,
                  selectedCount: 0,
                  truncated: false,
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_list_store_elements") {
          const maxResults =
            typeof msg.maxResults === "number" && msg.maxResults > 0
              ? Math.min(msg.maxResults, 200000)
              : 200000;
          const ifcTypes = Array.isArray(msg.ifcTypes)
            ? msg.ifcTypes.map((t: unknown) => String(t).toLowerCase()).filter(Boolean)
            : [];
          const typeSet = ifcTypes.length ? new Set(ifcTypes) : null;

          const isDeprioritizedStoreType = (ifcType: string): boolean => {
            const key = String(ifcType ?? "")
              .trim()
              .toUpperCase()
              .replace(/^IFC/, "");
            return key.includes("FASTENER") || key.includes("MECHANICALFASTENER");
          };

          /** Round-robin by IFC type — avoids document-order bias on large heterogeneous models. */
          const stratifiedSliceByType = (rows: any[], cap: number): any[] => {
            if (rows.length <= cap) return rows;
            const byType = new Map<string, any[]>();
            for (const el of rows) {
              const t = String(el?.type ?? "Unknown");
              const arr = byType.get(t) ?? [];
              arr.push(el);
              byType.set(t, arr);
            }
            const primary = [...byType.keys()].filter((t) => !isDeprioritizedStoreType(t)).sort();
            const low = [...byType.keys()].filter((t) => isDeprioritizedStoreType(t)).sort();
            const order = [...primary, ...low];
            const cursors = new Map(order.map((t) => [t, 0]));
            const out: any[] = [];
            while (out.length < cap) {
              let added = false;
              for (const t of order) {
                if (out.length >= cap) break;
                const pool = byType.get(t) ?? [];
                let i = cursors.get(t) ?? 0;
                if (i >= pool.length) continue;
                out.push(pool[i]);
                cursors.set(t, i + 1);
                added = true;
              }
              if (!added) break;
            }
            return out;
          };

          try {
            const costData = getCostStoreData();
            const filtered = costData.filter((el: any) => {
              if (!typeSet) return true;
              return typeSet.has(String(el?.type ?? "").toLowerCase());
            });
            const sliced =
              !typeSet && filtered.length > maxResults
                ? stratifiedSliceByType(filtered, maxResults)
                : filtered.slice(0, maxResults);
            const elements = sliced
              .map((el: any) => ({
                id: Number(el?.id ?? el?.expressId),
                globalId: el?.globalId ?? null,
                name: el?.name ?? "",
                type: el?.type ?? "",
              }))
              .filter((el: any) => !isNaN(el.id));

            ws.send(
              JSON.stringify({
                type: "costa_list_store_elements:result",
                requestId: msg.requestId,
                result: {
                  count: elements.length,
                  truncated: costData.length > elements.length,
                  source: costData.length > 0 ? "costStore" : "empty",
                  elements,
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_list_store_elements:result",
                requestId: msg.requestId,
                result: {
                  count: 0,
                  truncated: false,
                  source: "empty",
                  elements: [],
                  error: `Send error: ${err instanceof Error ? err.message : String(err)}`,
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_get_ifc_types_in_store") {
          const includeCounts = msg.includeCounts !== false; // default true
          const maxTypes =
            typeof msg.maxTypes === "number" && msg.maxTypes > 0 ? Math.min(msg.maxTypes, 200) : 200;

          const costData = getCostStoreData();
          const entries = aggregateStoreElementsByIfcType(costData).map(({ ifcType, count }) => ({
            type: ifcType,
            count,
          }));

          const limited = entries.slice(0, maxTypes);

          try {
            ws.send(
              JSON.stringify({
                type: "costa_get_ifc_types_in_store:result",
                requestId: msg.requestId,
                result: {
                  totalDistinctTypes: entries.length,
                  totalElementsConsidered: costData.length,
                  types: includeCounts ? limited : limited.map((x) => x.type),
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_get_ifc_types_in_store:result",
                requestId: msg.requestId,
                result: { ok: false, error: `Send error: ${err instanceof Error ? err.message : String(err)}` },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_ping_store_connection") {
          try {
            const stats = getCostStoreStats();
            const totalElements = getCostStoreData().length;
            const origin = getViewerIfcOriginKind();
            ws.send(
              JSON.stringify({
                type: "costa_ping_store_connection:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  storeReady: totalElements > 0,
                  fragmentModelLoaded: Boolean(getFragmentModelRef()),
                  totalElements,
                  sourceStats: stats,
                  abPolicies: stats.abPolicies,
                  featureFlags: stats.featureFlags,
                  origin,
                  layerAssembly: {
                    confirmed: stats.layerAssembly?.confirmed === true,
                    current: stats.layerAssembly ?? null,
                    proposal: totalElements > 0 ? proposeFacadeLayerAssembly(getCostStoreData(), origin) : null,
                    note:
                      totalElements === 0 && getFragmentModelRef()
                        ? "IFC is in the viewer; CostPage store is still empty. Layer-assembly confirm can use fragment IDs. Do not treat storeReady as a blocker for Talo write to hostIds."
                        : undefined,
                  },
                  timestamp: new Date().toISOString(),
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_ping_store_connection:result",
                requestId: msg.requestId,
                result: { ok: false, error: `Ping error: ${err instanceof Error ? err.message : String(err)}` },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_analyze_littera_by_ifc_type") {
          const ifcType = String(msg.ifcTypeReview ?? msg.ifcType ?? "").trim();
          if (!ifcType) {
            ws.send(
              JSON.stringify({
                type: "costa_analyze_littera_by_ifc_type:result",
                requestId: msg.requestId,
                result: { ok: false, error: "ifcType is required." },
              })
            );
            return;
          }

          const groupLimit =
            typeof msg.groupLimit === "number" && msg.groupLimit > 0 ? Math.min(msg.groupLimit, 500) : 50;
          const elementLimit =
            typeof msg.elementLimit === "number" && msg.elementLimit > 0 ? Math.min(msg.elementLimit, 5000) : 500;
          const maxSuggestions =
            typeof msg.maxSuggestions === "number" && msg.maxSuggestions > 0
              ? Math.min(msg.maxSuggestions, 8)
              : 5;
          const minConfidence =
            typeof msg.minConfidence === "number"
              ? Math.max(0, Math.min(1, msg.minConfidence))
              : 0.5;
          const autoKeepThreshold = 0.75;
          const autoRemoveThreshold = 0.35;

          try {
            const data = getCostStoreData().filter(
              (el: any) => String(el?.type ?? "").toLowerCase() === ifcType.toLowerCase()
            );
            const limited = data.slice(0, elementLimit);
            const groups = new Map<
              string,
              {
                ifcType: string;
                taloCode: string;
                name: string;
                nameNormalized: string;
                ids: number[];
                guids: string[];
                currentCodes: string[];
                sample: any;
              }
            >();

            for (const el of limited) {
              const taloCode = String(el?.taloCode ?? "").trim();
              const name = String(el?.name ?? "").trim();
              const nameNorm = normalizeRevitName(name);
              const key = `${ifcType.toLowerCase()}|${taloCode}|${nameNorm}`;
              if (!groups.has(key)) {
                groups.set(key, {
                  ifcType: String(el?.type ?? ifcType),
                  taloCode,
                  name,
                  nameNormalized: nameNorm,
                  ids: [],
                  guids: [],
                  currentCodes: [],
                  sample: el,
                });
              }
              const g = groups.get(key)!;
              const idNum = Number(el?.id ?? el?.expressId);
              if (!isNaN(idNum)) g.ids.push(idNum);
              const guid = String(el?.globalId ?? "").trim();
              if (guid) g.guids.push(guid);
              const codes = Array.isArray(el?.litteraCodes)
                ? el.litteraCodes.map((x: any) => String(x?.litteraCode ?? "").trim()).filter(Boolean)
                : [];
              for (const c of codes) {
                if (!g.currentCodes.includes(c)) g.currentCodes.push(c);
              }
            }

            const filteringService = new LitteraFilteringService();
            const dict = Array.isArray(litteraDictJson) ? (litteraDictJson as any[]) : [];
            const byCode = new Map<string, any>(dict.map((e: any) => [String(e?.littera ?? "").trim(), e]));

            const grouped = Array.from(groups.entries()).slice(0, groupLimit);
            const out: any[] = [];
            for (const [groupKey, g] of grouped) {
              const suggestionInput = {
                ...g.sample,
                litteraCode: undefined,
                litteraName: undefined,
                litteraCategory: undefined,
                litteraCodes: undefined,
              };
              let suggested: any[] = [];
              try {
                const filteredCodes = await filteringService.getFilteredLitteraCodes(
                  suggestionInput as any,
                  Math.min(maxSuggestions * 3, 15)
                );
                suggested = (Array.isArray(filteredCodes) ? filteredCodes : []).slice(0, maxSuggestions);
              } catch {
                suggested = [];
              }

              // Candidate Generator + Semantic Scorer (v1 explicit contract)
              const nameTokens = new Set(tokenizeForSemanticMatch(g.nameNormalized));
              const taloPrefix = taloPrefix4(g.taloCode);
              const candidates = (Array.isArray(suggested) ? suggested : [])
                .map((s: any) => {
                  const litteraCode = String(s?.litteraCode ?? "").trim();
                  if (!litteraCode) return null;
                  const entry = byCode.get(litteraCode) ?? {};
                  const desc = String(entry?.description ?? s?.description ?? s?.litteraName ?? "");
                  const category = String(entry?.category ?? s?.category ?? "").toLowerCase();
                  const baseConfidence =
                    typeof s?.relevanceScore === "number"
                      ? Math.max(0, Math.min(1, s.relevanceScore / 300))
                      : (typeof s?.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5);
                  const descTokens = new Set(tokenizeForSemanticMatch(desc));
                  const tokenHits = Array.from(nameTokens).filter((t) => descTokens.has(t)).length;
                  const tokenScore = Math.min(1, tokenHits / 3);
                  const demolitionPenalty = includesDemolitionTerms(desc) ? 0.35 : 0;
                  const typeBoost =
                    ifcType.toLowerCase().includes("door") && /ovi|door/.test(desc.toLowerCase()) ? 0.2 :
                    ifcType.toLowerCase().includes("window") && /ikkuna|window/.test(desc.toLowerCase()) ? 0.2 :
                    ifcType.toLowerCase().includes("column") && /pilari|column/.test(desc.toLowerCase()) ? 0.2 :
                    ifcType.toLowerCase().includes("wall") && /seinä|wall/.test(desc.toLowerCase()) ? 0.2 :
                    ifcType.toLowerCase().includes("slab") && /laatta|slab|pohja/.test(desc.toLowerCase()) ? 0.2 :
                    0;
                  const taloCompat = taloPrefix && String(entry?.taloCode ?? "").startsWith(taloPrefix) ? 0.15 : 0;
                  const foreignCategoryPenalty =
                    ifcType.toLowerCase().includes("door") && /väliseinä|wall/.test(category) ? 0.2 :
                    ifcType.toLowerCase().includes("column") && /ovi|door|window|ikkuna/.test(category) ? 0.2 :
                    0;

                  const score = Math.max(
                    0,
                    Math.min(
                      1,
                      0.5 * baseConfidence +
                        0.2 * tokenScore +
                        typeBoost +
                        taloCompat -
                        demolitionPenalty -
                        foreignCategoryPenalty
                    )
                  );

                  return {
                    litteraCode,
                    confidence: baseConfidence,
                    score: Number(score.toFixed(3)),
                    reasons: {
                      baseConfidence: Number(baseConfidence.toFixed(3)),
                      tokenScore: Number(tokenScore.toFixed(3)),
                      typeBoost: Number(typeBoost.toFixed(3)),
                      taloCompat: Number(taloCompat.toFixed(3)),
                      demolitionPenalty: Number(demolitionPenalty.toFixed(3)),
                      foreignCategoryPenalty: Number(foreignCategoryPenalty.toFixed(3)),
                    },
                  };
                })
                .filter(Boolean) as any[];

              const recommended = candidates
                .filter((x: any) => x.score >= minConfidence)
                .sort((a: any, b: any) => b.score - a.score)
                .slice(0, maxSuggestions);
              const recommendedCodes = Array.from(new Set(recommended.map((x: any) => x.litteraCode)));
              const currentCodes = Array.from(new Set(g.currentCodes));
              const recommendedKeep = currentCodes.filter((c) => recommendedCodes.includes(c));
              const recommendedRemove = currentCodes.filter((c) => !recommendedCodes.includes(c));
              const recommendedAdd = recommendedCodes.filter((c) => !currentCodes.includes(c));
              const topConfidence = recommended.length > 0 ? Math.max(...recommended.map((x: any) => x.score)) : 0;
              const overallVerdict =
                currentCodes.length === 0
                  ? "sin_littera"
                  : recommendedRemove.length === 0 && recommendedAdd.length === 0
                    ? "coherente"
                    : topConfidence >= minConfidence
                      ? "incongruente"
                      : "dudoso";

              const decisionByCode = currentCodes.map((code) => {
                const cand = candidates.find((x: any) => x.litteraCode === code);
                const score = cand?.score ?? 0;
                const action =
                  score >= autoKeepThreshold
                    ? "auto-keep"
                    : score <= autoRemoveThreshold
                      ? "auto-remove"
                      : "manual-review";
                return { litteraCode: code, score: Number(score.toFixed(3)), action };
              });

              out.push({
                groupKey,
                ifcType: g.ifcType,
                taloCode: g.taloCode,
                name: g.name,
                sampleGuid: g.guids[0] ?? null,
                elementCount: g.ids.length,
                currentLitteraCodes: currentCodes.map((code) => ({
                  litteraCode: code,
                  litteraName: String(byCode.get(code)?.description ?? ""),
                })),
                recommendedKeep,
                recommendedRemove,
                recommendedAdd,
                confidence: Number(topConfidence.toFixed(3)),
                overallVerdict,
                semanticScoring: {
                  minConfidence,
                  autoKeepThreshold,
                  autoRemoveThreshold,
                  candidates,
                  decisionByCode,
                },
                approvalPayload: {
                  sampleGuid: g.guids[0] ?? null,
                  proposedAfterCodes: recommendedCodes,
                  autoKeep: decisionByCode.filter((x: any) => x.action === "auto-keep").map((x: any) => x.litteraCode),
                  autoRemove: decisionByCode.filter((x: any) => x.action === "auto-remove").map((x: any) => x.litteraCode),
                  manualReview: decisionByCode.filter((x: any) => x.action === "manual-review").map((x: any) => x.litteraCode),
                },
              });
            }

            const byVerdict = out.reduce(
              (acc: any, g: any) => {
                acc[g.overallVerdict] = (acc[g.overallVerdict] ?? 0) + 1;
                return acc;
              },
              { coherente: 0, dudoso: 0, incongruente: 0, sin_littera: 0 }
            );

            ws.send(
              JSON.stringify({
                type: "costa_analyze_littera_by_ifc_type:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  ifcType,
                  limits: { elementLimit, groupLimit, maxSuggestions, minConfidence },
                  policy: { autoKeepThreshold, autoRemoveThreshold },
                  totalElementsOfType: data.length,
                  elementsAnalyzed: limited.length,
                  groupsAnalyzed: out.length,
                  byVerdict,
                  groups: out,
                },
              })
            );
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "costa_analyze_littera_by_ifc_type:result",
                requestId: msg.requestId,
                result: { ok: false, error: error instanceof Error ? error.message : String(error) },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_list_review_checkpoints") {
          try {
            const storageKey = "__costaReviewCheckpoints";
            const raw = localStorage.getItem(storageKey);
            const store = raw ? (JSON.parse(raw) as Record<string, any>) : {};
            const entries = Object.entries(store).map(([sessionId, cp]) => ({
              sessionId,
              updatedAt: cp?.updatedAt ?? null,
              ifcType: cp?.ifcType ?? null,
              truncated: Boolean(cp?.truncated),
              previousStats: cp?.previousStats ?? null,
            }));
            entries.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

            ws.send(
              JSON.stringify({
                type: "costa_list_review_checkpoints:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  count: entries.length,
                  checkpoints: entries,
                },
              })
            );
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "costa_list_review_checkpoints:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_save_review_checkpoint") {
          const sessionId = String(msg.sessionId ?? "").trim();
          const checkpoint = (msg.checkpoint ?? {}) as Record<string, unknown>;
          if (!sessionId) {
            ws.send(
              JSON.stringify({
                type: "costa_save_review_checkpoint:result",
                requestId: msg.requestId,
                result: { ok: false, error: "sessionId is required." },
              })
            );
            return;
          }

          try {
            const storageKey = "__costaReviewCheckpoints";
            const raw = localStorage.getItem(storageKey);
            const store = raw ? (JSON.parse(raw) as Record<string, any>) : {};
            const previous = store[sessionId] ?? {};

            // Merge shallowly to preserve long-running session metadata (e.g. patternStatsByIfcType)
            // while allowing each save to override current batch fields.
            const merged = {
              ...previous,
              ...checkpoint,
              sessionId,
              updatedAt: new Date().toISOString(),
            };
            store[sessionId] = {
              ...merged,
            };
            localStorage.setItem(storageKey, JSON.stringify(store));

            ws.send(
              JSON.stringify({
                type: "costa_save_review_checkpoint:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  sessionId,
                  updatedAt: store[sessionId].updatedAt,
                },
              })
            );
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "costa_save_review_checkpoint:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_get_review_checkpoint") {
          const sessionId = String(msg.sessionId ?? "").trim();
          if (!sessionId) {
            ws.send(
              JSON.stringify({
                type: "costa_get_review_checkpoint:result",
                requestId: msg.requestId,
                result: { ok: false, error: "sessionId is required." },
              })
            );
            return;
          }

          try {
            const storageKey = "__costaReviewCheckpoints";
            const raw = localStorage.getItem(storageKey);
            const store = raw ? (JSON.parse(raw) as Record<string, any>) : {};
            const cp = store[sessionId];
            if (!cp) {
              ws.send(
                JSON.stringify({
                  type: "costa_get_review_checkpoint:result",
                  requestId: msg.requestId,
                  result: { ok: false, sessionId, error: "Checkpoint not found." },
                })
              );
              return;
            }

            const rules = Array.isArray(cp.rules) ? cp.rules.map((r: any) => String(r)) : [];
            const ifcType = String(cp.ifcType ?? "");
            const truncated = Boolean(cp.truncated);
            const previous = (cp.previousStats ?? {}) as any;

            // Automatic decision helper (WebSocket-side): no prompt dependency.
            // If no changes were applied repeatedly and most results are omit/manual, recommend moving on.
            const patternStatsByIfcType = (cp.patternStatsByIfcType ?? {}) as Record<string, any>;
            const typeStats = patternStatsByIfcType[ifcType] ?? {};
            const sampleCount = Number(typeStats.sampleCount ?? previous.processed ?? 0) || 0;
            const applied = Number(typeStats.applied ?? previous.applied ?? 0) || 0;
            const omitted = Number(typeStats.omitted_confidence ?? previous.omitted_confidence ?? 0) || 0;
            const manual = Number(typeStats.manual_review ?? previous.manual_review ?? 0) || 0;
            const unresolvedRatio = sampleCount > 0 ? (omitted + manual) / sampleCount : 0;

            const defaultPolicy = {
              minSampleForPattern: 40,
              minUnresolvedRatio: 0.8,
            };
            const policy = {
              ...defaultPolicy,
              ...(cp.autoStrategyPolicy ?? {}),
            };
            const shouldCloseType =
              sampleCount >= Number(policy.minSampleForPattern) &&
              applied === 0 &&
              unresolvedRatio >= Number(policy.minUnresolvedRatio);

            const recommendedNextAction = shouldCloseType
              ? "close_ifcType_and_move_next"
              : (truncated ? "continue_same_ifcType_next_batch" : "ifcType_completed");

            const decisionReason = shouldCloseType
              ? "Pattern confirmed: high unresolved ratio with zero applied changes."
              : (truncated
                  ? "More elements remain in current ifcType."
                  : "Current ifcType appears complete.");
            const resumeInstruction =
              `Retoma revisión Littera. Contexto: ifcType=${ifcType || "<pendiente>"}, ` +
              `truncated=${truncated}, continuar siguiente batch del mismo tipo.\n` +
              `Reglas vigentes:\n` +
              `${rules.length ? rules.map((r: string, i: number) => `${i + 1}. ${r}`).join("\n") : "- (sin reglas guardadas)"}\n` +
              `Estado anterior: ${JSON.stringify(previous)}.\n` +
              `Recomendación automática: ${recommendedNextAction} (${decisionReason}).`;

            ws.send(
              JSON.stringify({
                type: "costa_get_review_checkpoint:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  sessionId,
                  checkpoint: cp,
                  strategy: {
                    policy,
                    sampleCount,
                    applied,
                    omitted_confidence: omitted,
                    manual_review: manual,
                    unresolvedRatio,
                    recommendedNextAction,
                    decisionReason,
                  },
                  resumeUx: {
                    sessionId,
                    ifcType,
                    truncated,
                    recommendedNextAction,
                    decisionReason,
                    previousStats: previous,
                    rulesCount: rules.length,
                  },
                  resumeInstruction,
                },
              })
            );
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "costa_get_review_checkpoint:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_get_element_properties") {
          const fragmentModel = getFragmentModelRef();
          const ids = Array.isArray(msg.ids) ? msg.ids.map((n) => Number(n)).filter((n) => !isNaN(n)) : [];
          if (ids.length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_get_element_properties:result",
                requestId: msg.requestId,
                result: { count: 0, elements: [], error: "No ids provided." },
              })
            );
            return;
          }

          const idSet = new Set(ids.map((n) => Number(n)));
          const fromStore = getCostStoreData()
            .filter((el: any) => idSet.has(Number(el?.id ?? el?.expressId)))
            .map((el: any) => mapElementForMcp(el));
          const storeIdSet = new Set(fromStore.map((el: any) => Number(el.id)));
          const missingIds = ids.filter((id) => !storeIdSet.has(id));

          // Prefer CostPage store: it already has LayerRole / PublishedQuantity / wall face.
          // Recalculating via CostCalculator after an MCP reconnect often returns 0 rows.
          if (missingIds.length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_get_element_properties:result",
                requestId: msg.requestId,
                result: { count: fromStore.length, elements: fromStore, source: "costStore" },
              })
            );
            return;
          }

          const costCalculator = components ? components.get(CostCalculator) : null;
          if (!fragmentModel || !costCalculator || missingIds.length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_get_element_properties:result",
                requestId: msg.requestId,
                result: {
                  count: fromStore.length,
                  elements: fromStore,
                  source: "costStore",
                  missingIds: missingIds.length ? missingIds : undefined,
                },
              })
            );
            return;
          }

          try {
            const fragmentIdMap = await buildFragmentIdMapForIds(fragmentModel, missingIds);
            const raw = await costCalculator.calculateMaterialCosts(fragmentIdMap);
            const missingSet = new Set(missingIds);
            const fromCalc = (raw || [])
              .filter((el: any) => missingSet.has(Number(el.id)))
              .map((el: any) => mapElementForMcp(el));
            const elements = [...fromStore, ...fromCalc];
            ws.send(
              JSON.stringify({
                type: "costa_get_element_properties:result",
                requestId: msg.requestId,
                result: {
                  count: elements.length,
                  elements,
                  source: fromStore.length ? "mixed" : "calculator",
                  missingIds: missingIds.filter((id) => !fromCalc.some((el: any) => Number(el.id) === id)),
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_get_element_properties:result",
                requestId: msg.requestId,
                result: {
                  count: fromStore.length,
                  elements: fromStore,
                  source: "costStore",
                  error: fromStore.length
                    ? undefined
                    : `IFC properties error: ${err instanceof Error ? err.message : String(err)}`,
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_suggest_cost_codes") {
          const ifcTypes = Array.isArray(msg.ifcTypes) ? msg.ifcTypes.filter((t) => typeof t === "string") : [];
          const taloCodes = Array.isArray(msg.taloCodes)
            ? msg.taloCodes.filter((t: unknown): t is string => typeof t === "string")
            : [];
          const litteraMainGroups = Array.isArray(msg.litteraMainGroups)
            ? msg.litteraMainGroups.filter(
                (g: unknown): g is number => typeof g === "number" && Number.isFinite(g)
              )
            : [];
          const ids = Array.isArray(msg.ids) ? msg.ids.map((n) => Number(n)).filter((n) => !isNaN(n)) : [];
          const nameContains = msg.nameContains?.trim() ?? "";
          const nameRegex = nameContains ? new RegExp(escapeRegExp(nameContains), "i") : null;
          const maxResults =
            typeof msg.maxResults === "number" && msg.maxResults > 0 ? Math.min(msg.maxResults, 1000) : 250;
          const maxSuggestions =
            typeof msg.maxSuggestions === "number" && msg.maxSuggestions > 0
              ? Math.min(msg.maxSuggestions, 8)
              : 3;

          try {
            if (ids.length === 0 && ifcTypes.length === 0 && taloCodes.length === 0 && litteraMainGroups.length === 0 && !nameRegex) {
              ws.send(
                JSON.stringify({
                  type: "costa_suggest_cost_codes:result",
                  requestId: msg.requestId,
                  result: { count: 0, elements: [], error: "Provide ids, ifcTypes, or nameContains." },
                })
              );
              return;
            }

            const ifcTypeSet = new Set(ifcTypes.map((t) => String(t).toLowerCase()));
            const requestedIds = new Set(ids);
            const taloCodeSet = new Set(taloCodes.map((c: string) => String(c).trim()));
            const litteraMainGroupSet = new Set(litteraMainGroups.map((g: number) => Number(g)));
            const subset = getCostStoreData().filter((el: any) => {
              const id = Number(el?.id ?? el?.expressId);
              const typeOk =
                ifcTypeSet.size === 0 || ifcTypeSet.has(String(el?.type ?? "").toLowerCase());
              const idOk = requestedIds.size === 0 || (!isNaN(id) && requestedIds.has(id));
              const nameOk = !nameRegex || nameRegex.test(String(el?.name ?? ""));

              const taloOk =
                taloCodeSet.size === 0 || taloCodeSet.has(String(el?.taloCode ?? "").trim());

              const primaryLitteraCode = Array.isArray(el?.litteraCodes)
                ? el?.litteraCodes?.[0]?.litteraCode
                : el?.litteraCode;
              const primaryMainGroup = getMainGroupFromLitteraCode(String(primaryLitteraCode ?? ""));
              const groupOk = litteraMainGroupSet.size === 0 || litteraMainGroupSet.has(primaryMainGroup);

              return typeOk && idOk && taloOk && groupOk && nameOk;
            });

            const dict = Array.isArray(litteraDictJson) ? (litteraDictJson as any[]) : [];
            const litteraByCode = new Map<string, any>(
              dict.map((e: any) => [String(e?.littera ?? "").trim(), e])
            );
            const limited = subset.slice(0, maxResults);
            const filteringService = new LitteraFilteringService();
            const elements = await Promise.all(
              limited.map(async (el: any) => {
                const talo = suggestTaloAssignments(el, maxSuggestions);

                // Importante: para Claude evaluamos el motor de sugerencias, no la asignación ya aplicada.
                // Ignoramos códigos Littera actuales para que el resultado use solo la lógica de filtrado/validación.
                const suggestionInput = {
                  ...el,
                  litteraCode: undefined,
                  litteraName: undefined,
                  litteraCategory: undefined,
                  litteraCodes: undefined,
                };

                // Littera: usar el motor real de filtrado/validación por plantillas.
                const filterMax = Math.min(maxSuggestions * 3, 15);
                let litteraSuggestions: any[] = [];
                try {
                  const filteredCodes = await filteringService.getFilteredLitteraCodes(
                    suggestionInput as any,
                    filterMax
                  );
                  litteraSuggestions = (Array.isArray(filteredCodes) ? filteredCodes : []).slice(
                    0,
                    maxSuggestions
                  ).map((c: any) => ({
                    litteraCode: String(c?.litteraCode ?? ""),
                    litteraName: String(c?.description ?? ""),
                    unit: String(c?.unit ?? ""),
                    category: c?.category ?? null,
                    confidence:
                      typeof c?.relevanceScore === "number"
                        ? Math.max(0, Math.min(1, c.relevanceScore / 300))
                        : 0.5,
                    reasons: Array.isArray(c?.relevanceReasons) ? c.relevanceReasons : [],
                  }));
                } catch {
                  litteraSuggestions = [];
                }

                // Fallback: si el filtrado no devuelve nada, usamos heurística anterior.
                if (!Array.isArray(litteraSuggestions) || litteraSuggestions.length === 0) {
                  litteraSuggestions = suggestLitteraAssignments(
                    suggestionInput as any,
                    dict as any,
                    maxSuggestions
                  );
                }

                const currentCodes = Array.isArray(el?.litteraCodes) ? el.litteraCodes : [];
                const primaryLitteraCodeForGrouping =
                  (Array.isArray(currentCodes) && currentCodes[0]?.litteraCode) ? currentCodes[0].litteraCode : el?.litteraCode;
                const currentLitteraMainGroup = getMainGroupFromLitteraCode(String(primaryLitteraCodeForGrouping ?? ""));
                const currentTaloMainGroup = getMainGroupFromTaloCode(String(el?.taloCode ?? ""));
                const recommendedLitteraSeries = (Array.isArray(litteraSuggestions) ? litteraSuggestions : []).map((s: any) => ({
                  litteraCode: s.litteraCode,
                  litteraName: s.litteraName,
                  litteraCategory: s.category ?? null,
                  litteraUnit: s.unit ?? "***",
                  confidence: s.confidence,
                  role: inferLitteraRole(s.litteraName ?? s.litteraCode),
                  reasons: Array.isArray(s.reasons) ? s.reasons : [],
                }));

                const systemCandidateCount = Array.isArray(litteraSuggestions) ? litteraSuggestions.length : 0;
                const systemTopOnlyMode = systemCandidateCount <= 1;

                const taloOperationalCode = String(el?.taloCode ?? "");
                const taloOperationalContext = taloOperationalCode
                  ? "provided-by-costa-object"
                  : "missing-on-element";

                // Si el Littera actual está vacío/inválido (unidad *** o descripción vacía),
                // damos a Claude una pista para validar en internet (sin saltarse el catálogo local).
                const currentLitteraCode = String(el?.litteraCode ?? "").trim();
                const currentLitteraEntry = currentLitteraCode ? litteraByCode.get(currentLitteraCode) : undefined;
                const currentLitteraInvalidFromCatalog =
                  !currentLitteraEntry ||
                  !String(currentLitteraEntry?.description ?? "").trim();

                // UX: unit === "***" significa "código conceptual no medible".
                // No lo tratamos como inválido para el análisis/coste; solo como "no accionable".
                const currentLitteraUnitFromCatalog = String(currentLitteraEntry?.unit ?? "").trim();
                const currentLitteraIsConcept = currentLitteraUnitFromCatalog === "***";

                // Costa puede almacenar un littera "raw" del IFC con placeholders (ej: unidad "***"),
                // incluso si el código existe en el catálogo local. Usamos el store como señal principal.
                const currentLitteraInvalidFromStore = (() => {
                  const candidates = currentLitteraCode
                    ? (currentCodes || []).filter(
                        (lc: any) => String(lc?.litteraCode ?? "").trim() === currentLitteraCode
                      )
                    : currentCodes || [];
                  if (!Array.isArray(candidates) || candidates.length === 0) return false;
                  return candidates.some((lc: any) => {
                    const unit = String(lc?.unit ?? "").trim();
                    const name = String(lc?.litteraName ?? "").trim();
                    // UX: si es concepto (unit "***"), lo consideramos "no accionable" pero no inválido
                    return !name || unit === "";
                  });
                })();

                const currentLitteraInvalid = currentLitteraInvalidFromCatalog || currentLitteraInvalidFromStore;

                // UX: códigos corruptos tipo "433025\r\n433025\r\n..." (extraemos todas las ocurrencias de 6 dígitos)
                const currentLitteraParsedCodes = currentLitteraCode
                  ? currentLitteraCode.match(/\d{6}/g) ?? []
                  : [];
                const currentLitteraParsedUniqueValidCodes = Array.from(
                  new Set(currentLitteraParsedCodes)
                ).filter((c) => litteraByCode.has(c));

                const currentLitteraDetails = currentLitteraEntry
                  ? {
                      litteraCode: currentLitteraCode,
                      description: String(currentLitteraEntry?.description ?? ""),
                      unit: String(currentLitteraEntry?.unit ?? ""),
                      category: currentLitteraEntry?.category ?? null,
                      isValid:
                        !currentLitteraInvalidFromCatalog && !!String(currentLitteraEntry?.description ?? "").trim(),
                      isConcept: currentLitteraIsConcept,
                    }
                  : {
                      litteraCode: currentLitteraCode,
                      description: "",
                      unit: "",
                      category: null,
                      isValid: false,
                      isConcept: false,
                    };

                // Detalle por cada código Littera del array (si existe) para que Claude actúe solo sobre los medibles.
                const currentLitteraCodesDetailed = (() => {
                  const codesArr: any[] = Array.isArray(currentCodes) ? currentCodes : [];
                  const uniqueCodes = Array.from(
                    new Set(
                      codesArr
                        .map((lc) => String(lc?.litteraCode ?? "").trim())
                        .filter(Boolean)
                    )
                  );
                  // Si por algún motivo no hay array, usamos el legacy litteraCode
                  if (uniqueCodes.length === 0 && currentLitteraCode) uniqueCodes.push(currentLitteraCode);

                  return uniqueCodes.map((code) => {
                    const entry = litteraByCode.get(code);
                    const unit = String(entry?.unit ?? "").trim();
                    const description = String(entry?.description ?? "").trim();
                    const category = entry?.category ?? null;
                    const isConcept = unit === "***";
                    const isValidInCatalog = !!entry && !!description && !!unit;
                    const isActionable = isValidInCatalog && !isConcept;

                    const codeEntries = codesArr.filter(
                      (lc: any) => String(lc?.litteraCode ?? "").trim() === code
                    );
                    const sources = Array.from(
                      new Set(
                        codeEntries
                          .map((lc: any) => String(lc?.source ?? "").trim().toLowerCase())
                          .filter(Boolean)
                      )
                    );
                    const isFromIFC = sources.includes("ifc");
                    const isFromSuggestion = sources.includes("suggestion");

                    return {
                      litteraCode: code,
                      description,
                      unit,
                      category,
                      isValidInCatalog,
                      isConcept,
                      isActionable,
                      sources,
                      isFromIFC,
                      isFromSuggestion,
                    };
                  });
                })();

                const actionableLitteraCodes = currentLitteraCodesDetailed
                  .filter((x: any) => x.isActionable)
                  .map((x: any) => x.litteraCode);
                const conceptLitteraCodes = currentLitteraCodesDetailed
                  .filter((x: any) => x.isConcept)
                  .map((x: any) => x.litteraCode);
                const actionableLitteraCount = actionableLitteraCodes.length;

                const ifcLitteraCodes = currentLitteraCodesDetailed
                  .filter((x: any) => x.isFromIFC && x.isActionable)
                  .map((x: any) => x.litteraCode);
                const suggestionLitteraCodes = currentLitteraCodesDetailed
                  .filter((x: any) => x.isFromSuggestion && x.isActionable)
                  .map((x: any) => x.litteraCode);
                const suggestionLitteraCount = suggestionLitteraCodes.length;

                // Coherencia de costes (material/labor/subcontract) basada en el propio catálogo (strings).
                // Debe ejecutarse DESPUES de definir currentLitteraCodesDetailed para evitar TDZ.
                const currentActionableCodesDetailed = currentLitteraCodesDetailed.filter((x: any) => x.isActionable);
                const currentCostPlan = {
                  material: currentActionableCodesDetailed
                    .filter((x: any) => inferCostComponentsFromLitteraDescription(x.description).includes("material"))
                    .map((x: any) => x.litteraCode),
                  labor: currentActionableCodesDetailed
                    .filter((x: any) => inferCostComponentsFromLitteraDescription(x.description).includes("labor"))
                    .map((x: any) => x.litteraCode),
                  subcontract: currentActionableCodesDetailed
                    .filter((x: any) => inferCostComponentsFromLitteraDescription(x.description).includes("subcontract"))
                    .map((x: any) => x.litteraCode),
                  unknown: currentActionableCodesDetailed
                    .filter((x: any) => inferCostComponentsFromLitteraDescription(x.description).length === 0)
                    .map((x: any) => x.litteraCode),
                };

                const recommendedCostPlan = {
                  material: recommendedLitteraSeries
                    .filter((s: any) => inferCostComponentsFromLitteraDescription(String(s.litteraName ?? "")).includes("material"))
                    .map((s: any) => s.litteraCode),
                  labor: recommendedLitteraSeries
                    .filter((s: any) => inferCostComponentsFromLitteraDescription(String(s.litteraName ?? "")).includes("labor"))
                    .map((s: any) => s.litteraCode),
                  subcontract: recommendedLitteraSeries
                    .filter((s: any) => inferCostComponentsFromLitteraDescription(String(s.litteraName ?? "")).includes("subcontract"))
                    .map((s: any) => s.litteraCode),
                  unknown: recommendedLitteraSeries
                    .filter((s: any) => inferCostComponentsFromLitteraDescription(String(s.litteraName ?? "")).length === 0)
                    .map((s: any) => s.litteraCode),
                };

                const expectedComponents = Array.from(
                  new Set([
                    ...(recommendedCostPlan.material.length ? ["material"] : []),
                    ...(recommendedCostPlan.labor.length ? ["labor"] : []),
                    ...(recommendedCostPlan.subcontract.length ? ["subcontract"] : []),
                  ])
                );

                const missingComponents = expectedComponents.filter((comp) => {
                  if (comp === "material") return currentCostPlan.material.length === 0;
                  if (comp === "labor") return currentCostPlan.labor.length === 0;
                  if (comp === "subcontract") return currentCostPlan.subcontract.length === 0;
                  return true;
                });

                const costCoherence = {
                  expectedComponents,
                  missingComponents,
                  coversExpectedComponents: missingComponents.length === 0,
                  systemWantsExpansion: missingComponents.length > 0,
                };

                const elementName = String(el?.name ?? "");
                const fireRatingMatch = elementName.match(/EI\s*(\d+)/i) || elementName.match(/EI(\d+)/i);
                const fireRating = fireRatingMatch ? fireRatingMatch[1] : undefined;
                const moWidthMatch = elementName.match(/\bMO\s*(\d{1,2})\b/i);
                const moWidthDm = moWidthMatch ? moWidthMatch[1] : undefined;

                const topSuggestionDesc = String(
                  (litteraSuggestions?.[0]?.litteraName ?? litteraSuggestions?.[0]?.litteraCode ?? "")
                );
                const dimMatchFromSuggestion = topSuggestionDesc.match(/(\d+(?:-\d+)?)\s*x\s*(\d+(?:-\d+)?)/i);
                const dimsHint = dimMatchFromSuggestion ? `${dimMatchFromSuggestion[1]}x${dimMatchFromSuggestion[2]}` : undefined;

                const internetSearchHints = {
                  enabled: true,
                  // UX: solo buscamos si hay un problema real (no si el código es conceptual unit="***")
                  shouldSearchInternet: currentLitteraInvalid && !currentLitteraIsConcept && actionableLitteraCount === 0,
                  forceInternetSearch: currentLitteraInvalid && !currentLitteraIsConcept && actionableLitteraCount === 0,
                  queries: [
                    `TALO 2000 ${taloOperationalCode || ""} metallipalo-ovi EI${fireRating || "30"} ${dimsHint || (moWidthDm ? `${Number(moWidthDm) * 100}x2100` : "")}`.trim(),
                    `välioovi MO metallipalo-ovi EI${fireRating || "30"} ${dimsHint || ""} BOQ Littera koodi`,
                    `metallipalo-ovi EI${fireRating || "30"} ${dimsHint || ""} kustannus/BOQ "littera" code`,
                    `fire rated metal door EI${fireRating || "30"} ${dimsHint || ""} BOQ cost code (match against local littera.json)`,
                  ],
                  extractionGoal:
                    "Cuando el elemento requiere un paquete de costes (práctica Talo 80), la asignación no es un único código: debe cubrir un conjunto de actividades relacionadas (suministro/material, instalación/mano de obra y transporte/subcontrata si aplica). Tras la búsqueda, traduce el resultado a una serie de códigos Littera equivalentes para ese elemento y su paquete completo.",
                  validationReminder:
                    "Después de la búsqueda, Claude SOLO debe proponer códigos que existan en el catálogo local (`littera.json`) y que tengan unidad válida (no '***'). Además: NO inventar códigos; la salida preferida es una `litteraSeries` (varios códigos) que cubran distintas actividades. IMPORTANTE UX: `currentLitteraCodes` puede mezclar `source:'ifc'` (bloqueado/no tocar) y `source:'suggestion'` (los que Claude debe corregir). No proponer cambios sobre códigos `source:'ifc'`.",
                  coherencyEvaluation:
                    "Evalúa coherencia en el contexto finlandes de análisis de costes (Talo 80) usando `litteraCostCoherence`. Objetivo: (1) proponer una `litteraSeries` que cubra las `missingComponents` (material/labor/subcontract) cuando sea posible, (2) asegurar que `coversExpectedComponents` sea true para evitar insistencia sin base, (3) si faltan componentes y el catálogo local no lo permite, elige la opción más cercana y explica qué componente queda sin cobertura según `missingComponents`.",
                  recommendationMode: systemTopOnlyMode ? "resta_system_top_only" : "choose_from_system_candidates",
                };

                const topCandidate =
                  Array.isArray(recommendedLitteraSeries) && recommendedLitteraSeries.length > 0
                    ? recommendedLitteraSeries[0]
                    : null;
                const topConfidence =
                  typeof topCandidate?.confidence === "number" ? topCandidate.confidence : 0;
                const topDescription = String(topCandidate?.litteraName ?? "");
                const isIfcFurnishing = String(el?.type ?? "").toLowerCase() === "ifcfurnishingelement";
                const hasIfcLockedCodes = Array.isArray(ifcLitteraCodes) && ifcLitteraCodes.length > 0;
                const hasSuggestionCodes = Array.isArray(suggestionLitteraCodes) && suggestionLitteraCodes.length > 0;

                let semanticGate = "pass";
                let semanticReason = "OK";
                if (!topCandidate) {
                  semanticGate = "fail";
                  semanticReason = "No recommended Littera candidate.";
                } else if (topConfidence < 0.5) {
                  semanticGate = "fail";
                  semanticReason = `Top confidence below threshold: ${topConfidence.toFixed(2)} < 0.50.`;
                } else if (includesDemolitionTerms(topDescription)) {
                  semanticGate = "fail";
                  semanticReason = "Top Littera description indicates demolition scope (purku/poisto).";
                } else if (isIfcFurnishing && !hasStrongFurnishingSemanticMatch(elementName, topDescription)) {
                  semanticGate = "fail";
                  semanticReason =
                    "IfcFURNISHINGELEMENT requires strong semantic match between element name and Littera description.";
                } else if (hasIfcLockedCodes && !hasSuggestionCodes) {
                  semanticGate = "fail";
                  semanticReason = "Element has only source:'ifc' actionable codes; policy blocks modifications.";
                }

                return {
                  id: Number(el.id),
                  globalId: el.globalId ?? null,
                  type: String(el.type ?? ""),
                  name: String(el.name ?? ""),
                  currentTaloCode: el.taloCode ?? "",
                  currentTaloMainGroup,
                  currentLitteraCode: el.litteraCode ?? "",
                  currentLitteraCodes: currentCodes,
                  currentLitteraMainGroup,
                  currentLitteraDetails,
                  currentLitteraParsedCodes,
                  currentLitteraParsedUniqueValidCodes,
                  currentLitteraCodesDetailed,
                  currentLitteraActionableCodes: actionableLitteraCodes,
                  currentLitteraConceptCodes: conceptLitteraCodes,
                  currentLitteraActionableCount: actionableLitteraCount,
                  currentLitteraConceptCount: conceptLitteraCodes.length,
                  currentLitteraIfcCodes: ifcLitteraCodes,
                  currentLitteraSuggestionCodes: suggestionLitteraCodes,
                  currentLitteraSuggestionCount: suggestionLitteraCount,
                  semanticGate,
                  semanticReason,
                  suggestionIgnoresCurrentLittera: true,
                  litteraSuggestionsSource: "LitteraFilteringService",
                  litteraSuggestionsValidated: true,
                  internetSearchHints,
                  litteraSystemCandidateCount: systemCandidateCount,
                  litteraRecommendationMode: systemTopOnlyMode ? "resta_system_top_only" : "choose_from_system_candidates",
                  classificationContext: {
                    taloOperational: {
                      code: taloOperationalCode,
                      context: taloOperationalContext,
                      note: "Costa operational TALO context (not equivalent to Littera or Talo80).",
                    },
                    littera: {
                      currentCodesCount: currentCodes.length,
                      note: "Littera is handled as one-to-many BOQ/activity series.",
                    },
                    talo80Reference: {
                      usedAsReferenceOnly: true,
                      note: "Talo80 is reference framework; no forced 1:1 mapping to operational TALO/Littera.",
                    },
                  },
                  taloSuggestions: talo,
                  litteraSuggestions: litteraSuggestions,
                  recommendedLitteraSeries,
                  litteraCostCoherence: costCoherence,
                  currentCostPlan: currentCostPlan,
                  recommendedCostPlan: recommendedCostPlan,
                  reviewWorkflowSemantics: {
                    // Alineado con CostPage import/export:
                    // - Sync sheet: autoridad por GUID (fila de elemento)
                    // - Measurement Data: autoridad por grupo (IFC Type + Name + TALO)
                    syncByGuid: {
                      key: "globalId",
                      note:
                        "Cuando el flujo sea de sincronización por fila (GUID), Claude debe tratar cada elemento individualmente y mantener trazabilidad por globalId.",
                    },
                    measurementDataByGroup: {
                      groupKey: {
                        ifcType: String(el?.type ?? ""),
                        nameNormalized: String(el?.name ?? "").trim().toLowerCase(),
                        taloCode: String(el?.taloCode ?? "").trim(),
                      },
                      note:
                        "Cuando el flujo sea tipo Measurement Data, las decisiones se aplican por grupo (IFC Type + Name normalizado + TALO) y no por una fila aislada.",
                    },
                    applyPolicy: {
                      defaultLitteraMode: "append",
                      overwriteTaloRequiresExplicitApproval: true,
                      replaceLitteraRequiresExplicitApproval: true,
                      preserveIfcSourceCodes: true,
                    },
                  },
                };
              })
            );

            // UX contract: compact batch summary for large conversations.
            const reviewedCount = elements.length;
            const finalApplicableCandidates = (elements as any[])
              .filter((e: any) => e?.semanticGate === "pass")
              .map((e: any) => {
                const top = Array.isArray(e?.recommendedLitteraSeries) ? e.recommendedLitteraSeries[0] : null;
                return {
                  id: e?.id,
                  name: e?.name,
                  taloCode: e?.currentTaloCode ?? "",
                  litteraCode: String(top?.litteraCode ?? ""),
                  litteraName: String(top?.litteraName ?? ""),
                  confidence: typeof top?.confidence === "number" ? top.confidence : 0,
                };
              })
              .filter((x: any) => x.litteraCode);
            const applyReadyCount = finalApplicableCandidates.length;
            const noCandidateCount = elements.filter(
              (e: any) => !Array.isArray(e?.recommendedLitteraSeries) || e.recommendedLitteraSeries.length === 0
            ).length;
            const manualReviewCount = elements.filter((e: any) => e?.semanticGate === "fail").length;
            const hardBlockedCount = Math.max(0, reviewedCount - applyReadyCount - noCandidateCount);
            const topSuggestedCodes = (() => {
              const m = new Map<string, number>();
              for (const e of elements as any[]) {
                const top = Array.isArray(e?.recommendedLitteraSeries) ? e.recommendedLitteraSeries[0] : null;
                const code = String(top?.litteraCode ?? "").trim();
                if (!code) continue;
                m.set(code, (m.get(code) ?? 0) + 1);
              }
              return Array.from(m.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([litteraCode, count]) => ({ litteraCode, count }));
            })();
            const batchUx = {
              ifcTypeRequested:
                Array.isArray(ifcTypes) && ifcTypes.length === 1 ? String(ifcTypes[0]) : null,
              reviewedCount,
              truncated: subset.length > elements.length,
              applyReadyCount,
              manualReviewCount,
              noCandidateCount,
              hardBlockedCount,
              semanticGateEnabled: true,
              minTopConfidence: 0.5,
              demolitionTermsBlocked: true,
              topSuggestedCodes,
              finalApplicableCandidates,
            };

            ws.send(
              JSON.stringify({
                type: "costa_suggest_cost_codes:result",
                requestId: msg.requestId,
                result: {
                  count: elements.length,
                  truncated: subset.length > elements.length,
                  sourceUsed: "costPageStoreOnly",
                  sourceStats: getCostStoreStats(),
                  policy: {
                    classificationModel:
                      "CostaOperationalTALO + LitteraSeries + Talo80Reference",
                    rules: [
                      "Operational TALO code is context input, not equivalent to Littera.",
                      "Littera suggestions are one-to-many related series.",
                      "Talo80 is reference context only; avoid rigid 1:1 mapping.",
                    ],
                  },
                  batchUx,
                  elements,
                },
              })
            );
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "costa_suggest_cost_codes:result",
                requestId: msg.requestId,
                result: {
                  count: 0,
                  elements: [],
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_apply_cost_codes") {
          const assignments = Array.isArray(msg.assignments) ? msg.assignments : [];
          if (assignments.length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_apply_cost_codes:result",
                requestId: msg.requestId,
                result: { ok: false, applied: 0, failed: 0, error: "No assignments provided." },
              })
            );
            return;
          }

          const store = useCostStore.getState() as any;
          const costData: any[] = Array.isArray(store?.costData) ? store.costData : [];
          const byId = new Map(costData.map((el) => [Number(el?.id), el]));
          // Conjunto de ids visibles en fuentes extendidas (análisis/snapshot) para dar
          // mensajes de error más claros cuando el id existe en vista pero no en store editable.
          const broadIds = new Set(getCostStoreData().map((el: any) => Number(el?.id ?? el?.expressId)));
          const affectedIds = new Set<number>();
          const detectedTaloCodesBefore = new Set<string>();

          // Mapa local de validación para evitar que Claude proponga códigos Littera inventados.
          const litteraDict = Array.isArray(litteraDictJson) ? (litteraDictJson as any[]) : [];
          const litteraByCode = new Map<string, any>(
            litteraDict.map((e) => [String(e?.littera ?? "").trim(), e])
          );

          const validateLitteraCode = (rawCode: unknown) => {
            const code = String(rawCode ?? "").trim();
            if (!code) return;
            const entry = litteraByCode.get(code);
            if (!entry) {
              throw new Error(`Littera inválida: ${code} (no existe en littera.json).`);
            }
            const desc = String(entry?.description ?? "").trim();
            const unit = String(entry?.unit ?? "").trim();
            if (!desc || unit === "***") {
              throw new Error(`Littera inválida: ${code} (descripción/unidad no válidas en littera.json).`);
            }
          };

          let applied = 0;
          const errors: Array<{ id: number; error: string }> = [];

          for (const a of assignments) {
            const id = Number(a?.id);
            if (isNaN(id)) {
              errors.push({ id: -1, error: "Invalid id in assignment." });
              continue;
            }
            const existing = byId.get(id);
            if (!existing) {
              const hint = broadIds.has(id)
                ? "Element found in analysis/snapshot view but not in editable CostStore. Reload data or import Excel to sync."
                : "Element id not found in CostStore.";
              errors.push({ id, error: hint });
              continue;
            }
            affectedIds.add(id);
            if (existing?.taloCode) detectedTaloCodesBefore.add(String(existing.taloCode));

            try {
              // Validación estricta antes de modificar el store.
              if (a.litteraCode) validateLitteraCode(a.litteraCode);
              if (Array.isArray(a.litteraSeries) && a.litteraSeries.length > 0) {
                for (const item of a.litteraSeries) {
                  if (item?.litteraCode) validateLitteraCode(item.litteraCode);
                }
              }

              // Política anti-"insistir": por defecto NO permitimos que Claude
              // sobrescriba el `taloCode` que viene de IFC.
              if (a.taloCode) {
                if (a.allowTaloChange !== true) {
                  throw new Error("TALO change rejected by policy (set allowTaloChange=true to overwrite existing taloCode).");
                }
                if (typeof store.applySuggestion === "function") {
                  store.applySuggestion(id, String(a.taloCode));
                }
              }

              if (a.litteraCode) {
                const mode = a.mode === "replace" ? "replace" : "append";
                if (mode === "replace") {
                  if (a.allowLitteraReplace !== true) {
                    throw new Error("Littera replace rejected by policy (set allowLitteraReplace=true to use mode='replace').");
                  }
                  const current = (useCostStore.getState() as any).costData.find((el: any) => Number(el?.id) === id);
                  const currentCodes = Array.isArray(current?.litteraCodes) ? current.litteraCodes : [];
                  for (const lc of currentCodes) {
                    if (lc?.litteraCode) {
                      if (String(lc?.source ?? "").toLowerCase() === "ifc") continue;
                      store.removeLitteraCode(id, String(lc.litteraCode));
                    }
                  }
                }

                const litteraName = String(a.litteraName ?? a.litteraCode);
                const litteraCategory =
                  a.litteraCategory === null || typeof a.litteraCategory === "string"
                    ? a.litteraCategory
                    : null;
                const litteraUnit = String(a.litteraUnit ?? "***");
                store.addLitteraCode(
                  id,
                  String(a.litteraCode),
                  litteraName,
                  litteraCategory,
                  litteraUnit
                );
              }

              if (Array.isArray(a.litteraSeries) && a.litteraSeries.length > 0) {
                const mode = a.mode === "replace" ? "replace" : "append";
                if (mode === "replace") {
                  if (a.allowLitteraReplace !== true) {
                    throw new Error("Littera replace rejected by policy (set allowLitteraReplace=true to use mode='replace').");
                  }
                  const current = (useCostStore.getState() as any).costData.find((el: any) => Number(el?.id) === id);
                  const currentCodes = Array.isArray(current?.litteraCodes) ? current.litteraCodes : [];
                  for (const lc of currentCodes) {
                    if (lc?.litteraCode) {
                      if (String(lc?.source ?? "").toLowerCase() === "ifc") continue;
                      store.removeLitteraCode(id, String(lc.litteraCode));
                    }
                  }
                }
                for (const item of a.litteraSeries) {
                  const code = String(item?.litteraCode ?? "").trim();
                  if (!code) continue;
                  const name = String(item?.litteraName ?? code);
                  const category =
                    item?.litteraCategory === null || typeof item?.litteraCategory === "string"
                      ? item?.litteraCategory
                      : null;
                  const unit = String(item?.litteraUnit ?? "***");
                  store.addLitteraCode(id, code, name, category, unit);
                }
              }

              applied += 1;
            } catch (e) {
              errors.push({
                id,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }

          const afterStore = useCostStore.getState() as any;
          const afterCostData: any[] = Array.isArray(afterStore?.costData) ? afterStore.costData : costData;

          // Recomendaciones anti-inconsistencia: sugerimos revisar bloques “relacionados” por pares conocidos.
          const taloPairDoorReview: Record<string, string[]> = {
            // Väliovet (interior doors) <-> Ulko-ovet (exterior doors)
            "1.3.1.5": ["1.2.4.3"],
            "1.2.4.3": ["1.3.1.5"],
          };

          const recommendedTaloCodesToCheck = Array.from(detectedTaloCodesBefore).flatMap((code) => taloPairDoorReview[code] ?? []);
          const recommendedTaloCodesUnique = Array.from(new Set(recommendedTaloCodesToCheck)).filter(Boolean);

          const countsByTalo = new Map<string, number>();
          const countsByDoorTalo = new Map<string, number>();
          for (const el of afterCostData) {
            const t = String(el?.taloCode ?? "").trim();
            if (!t) continue;
            countsByTalo.set(t, (countsByTalo.get(t) ?? 0) + 1);
            const typeStr = String(el?.type ?? "").toLowerCase();
            const isDoor = typeStr.includes("door");
            if (isDoor) countsByDoorTalo.set(t, (countsByDoorTalo.get(t) ?? 0) + 1);
          }

          const doorReviewBlocks = recommendedTaloCodesUnique.map((taloCode) => ({
            taloCode,
            totalElements: countsByTalo.get(taloCode) ?? 0,
            doorElements: countsByDoorTalo.get(taloCode) ?? 0,
          }));

          const remainingTaloReviewQueue = Array.from(countsByTalo.entries())
            .sort((a, b) => b[1] - a[1])
            .filter(([t]) => !detectedTaloCodesBefore.has(String(t)))
            .slice(0, 10)
            .map(([t, count]) => ({ taloCode: t, elementCount: count }));

          const followUp = {
            progress: {
              affectedElements: affectedIds.size,
              totalElements: afterCostData.length,
              coverageRatio:
                afterCostData.length > 0 ? Math.min(1, affectedIds.size / afterCostData.length) : 0,
            },
            detectedTaloCodesBefore: Array.from(detectedTaloCodesBefore),
            recommendedTaloCodesToCheck: recommendedTaloCodesUnique,
            doorReviewBlocks,
            remainingTaloReviewQueue,
            // UX helper: “next” batch suggestions Claude can use without scanning everything.
            suggestedNextBatches: remainingTaloReviewQueue.slice(0, 3).map((x) => x.taloCode),
          };

          const postApplyUx = {
            applied,
            failed: errors.length,
            affectedElements: affectedIds.size,
            remainingTopTaloCodes: remainingTaloReviewQueue.slice(0, 3),
            recommendedTaloCodesToCheck: recommendedTaloCodesUnique,
            nextAction:
              errors.length > 0
                ? "review_errors_then_continue"
                : "continue_next_batch_or_related_talo",
          };

          ws.send(
            JSON.stringify({
              type: "costa_apply_cost_codes:result",
              requestId: msg.requestId,
              result: {
                ok: errors.length === 0,
                applied,
                failed: errors.length,
                errors,
                followUp,
                postApplyUx,
              },
            })
          );
          return;
        }

        if (msg.type === "costa_export_measurement_excel") {
          const fragmentModel = getFragmentModelRef();
          const costCalculator = components ? components.get(CostCalculator) : null;

          if (!fragmentModel && !getCostStoreData().length) {
            ws.send(
              JSON.stringify({
                type: "costa_export_measurement_excel:result",
                requestId: msg.requestId,
                result: { ok: false, filename: msg.filename, error: "No IFC model loaded and no CostPage data in store." },
              })
            );
            return;
          }
          if (!costCalculator && fragmentModel) {
            ws.send(
              JSON.stringify({
                type: "costa_export_measurement_excel:result",
                requestId: msg.requestId,
                result: { ok: false, filename: msg.filename, error: "CostCalculator not available." },
              })
            );
            return;
          }

          const waitForExport = () =>
            new Promise<{
              ok: boolean;
              filename?: string;
              error?: string;
              rowCount?: number;
              guidRowCount?: number;
              checksumSha256?: string;
            }>((resolve) => {
              let settled = false;
              const handler = (evt: Event) => {
                const custom = evt as CustomEvent<{
                  requestId: string;
                  ok: boolean;
                  error?: string;
                  filename?: string;
                  rowCount?: number;
                  guidRowCount?: number;
                  checksumSha256?: string;
                }>;
                if (!custom.detail || custom.detail.requestId !== msg.requestId) return;
                if (settled) return;
                settled = true;
                window.removeEventListener("costa-mcp-export-excel-result", handler);
                resolve({
                  ok: custom.detail.ok,
                  filename: custom.detail.filename,
                  error: custom.detail.error,
                  rowCount: custom.detail.rowCount,
                  guidRowCount: custom.detail.guidRowCount,
                  checksumSha256: custom.detail.checksumSha256,
                });
              };
              window.addEventListener("costa-mcp-export-excel-result", handler);
              // Timeout de 45s: si la UI no dispara el evento, resolver con error y limpiar listener.
              setTimeout(() => {
                if (settled) return;
                settled = true;
                window.removeEventListener("costa-mcp-export-excel-result", handler);
                resolve({ ok: false, error: "Export timeout: UI did not respond within 45s." });
              }, 45_000);
            });

          const ifcTypes = Array.isArray(msg.ifcTypes) ? msg.ifcTypes.filter((t) => typeof t === "string") : [];
          const ids = Array.isArray(msg.ids) ? msg.ids.map((n) => Number(n)).filter((n) => !isNaN(n)) : [];

          try {
            let newCostData: any[] = [];
            const storeHasData = getCostStoreData().length > 0;

            if (ids.length > 0) {
              const requestedIds = new Set(ids.map((n) => Number(n)));
              // Same source as prepare / groups export contract: CostStore when populated.
              newCostData = pickCostStoreElementsByIds(ids);
              if (newCostData.length === 0 && !storeHasData && fragmentModel && costCalculator) {
                const fragmentIdMap = await buildFragmentIdMapForIds(fragmentModel, ids);
                newCostData = await costCalculator.calculateMaterialCosts(fragmentIdMap);
              }
              newCostData = (Array.isArray(newCostData) ? newCostData : []).filter((el: any) => {
                const id = Number(el?.id ?? el?.expressId);
                return !isNaN(id) && requestedIds.has(id);
              });
              if (!Array.isArray(newCostData) || newCostData.length === 0) {
                throw new Error(
                  storeHasData
                    ? "No data found for provided ids in CostStore. Re-run Cost → Send to Quantities & Cost if the model changed."
                    : "No data found for provided ids."
                );
              }
            } else if (ifcTypes.length > 0) {
              const ifcTypeSet = new Set(ifcTypes.map((t) => String(t).toLowerCase()));
              newCostData = pickCostStoreElementsByIfcTypes(ifcTypes);
              if (newCostData.length === 0 && !storeHasData && fragmentModel && costCalculator) {
                const expressIdsWanted = new Set<number>();
                outer: for (const fragment of fragmentModel.items as any[]) {
                  for (const expressId of fragment.ids as any) {
                    let element: any = null;
                    try {
                      element = await fragmentModel.getProperties(expressId);
                    } catch {
                      continue;
                    }
                    if (!element) continue;
                    const inferredType = inferIfcType(element.type);
                    if (ifcTypeSet.has(String(inferredType).toLowerCase())) {
                      expressIdsWanted.add(Number(expressId));
                    }
                  }
                }
                const fragmentIdMap = await buildFragmentIdMapForIds(
                  fragmentModel,
                  Array.from(expressIdsWanted)
                );
                newCostData = await costCalculator.calculateMaterialCosts(fragmentIdMap);
              }
              newCostData = (Array.isArray(newCostData) ? newCostData : []).filter((el: any) =>
                ifcTypeSet.has(String(el?.type ?? "").toLowerCase())
              );
              if (!Array.isArray(newCostData) || newCostData.length === 0) {
                throw new Error(
                  storeHasData
                    ? "No data found for provided ifcTypes in CostStore. Re-run Cost → Send to Quantities & Cost if the model changed."
                    : "No data found for provided ifcTypes."
                );
              }
            } else {
              throw new Error("Export needs either ids or ifcTypes.");
            }

            // Temporarily set store so IFCMeasurementPanel can export
            const exportPromise = waitForExport();

            window.dispatchEvent(
              new CustomEvent("costa-mcp-export-excel", {
                detail: {
                  requestId: msg.requestId,
                  ifcTypes,
                  filename: msg.filename,
                  sourceData: newCostData,
                  requireSourceData: true,
                  bridgePreset: msg.bridgePreset !== false && msg.ifcRawOnly !== true,
                  ifcRawOnly: msg.ifcRawOnly === true,
                  extraColumns: Array.isArray(msg.extraColumns) ? msg.extraColumns : undefined,
                  extraValuesById:
                    msg.extraValuesById && typeof msg.extraValuesById === "object"
                      ? msg.extraValuesById
                      : undefined,
                },
              })
            );

            const exportRes = await exportPromise;

            ws.send(
              JSON.stringify({
                type: "costa_export_measurement_excel:result",
                requestId: msg.requestId,
                result: {
                  ok: exportRes.ok,
                  filename: exportRes.filename,
                  error: exportRes.error,
                  rowCount: exportRes.rowCount,
                  guidRowCount: exportRes.guidRowCount,
                  checksumSha256: exportRes.checksumSha256,
                },
              })
            );
          } catch (error) {
            ws.send(
              JSON.stringify({
                type: "costa_export_measurement_excel:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  filename: msg.filename,
                  error: error instanceof Error ? error.message : String(error),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_select_elements") {
          if (!components) {
            ws.send(
              JSON.stringify({
                type: "costa_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: "Selection requires IFCViewer context." },
              })
            );
            return;
          }
          const fragmentModel = getFragmentModelRef();
          if (!fragmentModel) {
            ws.send(
              JSON.stringify({
                type: "costa_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: "No IFC model loaded yet." },
              })
            );
            return;
          }

          const ids = Array.isArray(msg.ids) ? msg.ids.map((n) => Number(n)).filter((n) => !isNaN(n)) : [];
          if (ids.length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: "No ids provided." },
              })
            );
            return;
          }

          const visualMode = resolveMcpVisualMode(msg as { visualMode?: string; isolate?: boolean });

          const selection = await buildFragmentIdMapForIds(fragmentModel, ids);
          if (!selection || Object.keys(selection).length === 0) {
            ws.send(
              JSON.stringify({
                type: "costa_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: "No matching elements for ids." },
              })
            );
            return;
          }

          try {
            await applyMcpAutoSelectionVisual(
              selection as Record<string, Set<number>>,
              visualMode
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_select_elements:result",
                requestId: msg.requestId,
                result: { ok: false, error: `Selection error: ${err instanceof Error ? err.message : String(err)}` },
              })
            );
            return;
          }

          try {
            const world = (window as any).worldRef;
            world?.renderer?.update?.();
          } catch {
            // ignore
          }

          const state = buildCostaViewerSelectionState();
          ws.send(
            JSON.stringify({
              type: "costa_select_elements:result",
              requestId: msg.requestId,
              result: {
                ok: true,
                requestedCount: ids.length,
                autoSelectionCount: state.autoSelection.count,
                autoSelectionIds: state.autoSelection.ids,
                liveBagCount: state.liveBag.count,
                visualMode,
              },
            })
          );
          return;
        }

        if (msg.type === "costa_scan_elements_for_talo") {
          const ifcTypeFilter: string[] = Array.isArray(msg.ifcTypes)
            ? (msg.ifcTypes as string[]).map((t) => t.toLowerCase())
            : [];
          const maxGroups = typeof msg.maxResults === "number" && msg.maxResults > 0
            ? Math.min(msg.maxResults, 500) : 200;
          const maxNamesPerGroup = 8;

          // Fuente: CostStore primero, fragmentModel como fallback
          const { pool: rawPoolUnfiltered, source } = await collectTaloElementPool();
          let rawPool = rawPoolUnfiltered;

          // Filtrar por tipo si se especificó
          if (ifcTypeFilter.length > 0) {
            rawPool = rawPool.filter((el: any) =>
              ifcTypeFilter.includes(String(el?.type ?? "").toLowerCase())
            );
          }

          // Agrupar: { ifcType → { existingTaloCode → nombres[] } }
          // Clave de agrupación: tipo IFC (ignoramos variantes de nombre para no fragmentar demasiado)
          type GroupEntry = {
            ifcType: string;
            count: number;
            existingTaloCodes: Record<string, number>; // código → cuántos ya lo tienen
            nameVariants: Set<string>;
            nameCounts: Record<string, number>;
          };
          const typeMap = new Map<string, GroupEntry>();

          for (const el of rawPool) {
            const t = String(el?.type ?? "unknown");
            if (!typeMap.has(t)) {
              typeMap.set(t, { ifcType: t, count: 0, existingTaloCodes: {}, nameVariants: new Set(), nameCounts: {} });
            }
            const g = typeMap.get(t)!;
            g.count++;
            const name = String(el?.name ?? "").trim();
            if (name) {
              if (g.nameVariants.size < maxNamesPerGroup) g.nameVariants.add(name);
              g.nameCounts[name] = (g.nameCounts[name] ?? 0) + 1;
            }
            const existing = String(el?.taloCode ?? "").trim();
            if (existing) g.existingTaloCodes[existing] = (g.existingTaloCodes[existing] ?? 0) + 1;
          }

          const groups = Array.from(typeMap.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, maxGroups)
            .map((g) => ({
              ifcType: g.ifcType,
              count: g.count,
              alreadyHaveTaloCode: Object.values(g.existingTaloCodes).reduce((s, n) => s + n, 0),
              existingTaloCodes: Object.keys(g.existingTaloCodes),
              nameVariants: Array.from(g.nameVariants),
              nameCounts: g.nameCounts,
            }));

          const origin = getViewerIfcOriginKind();
          const layerAssembly = proposeFacadeLayerAssembly(rawPool, origin);
          const storeAssembly = useCostStore.getState().layerAssembly;

          ws.send(
            JSON.stringify({
              type: "costa_scan_elements_for_talo:result",
              requestId: msg.requestId,
              result: {
                ok: true,
                source,
                origin,
                totalElements: rawPool.length,
                totalTypes: typeMap.size,
                groups,
                layerAssembly: {
                  ...layerAssembly,
                  confirmed: storeAssembly?.confirmed === true,
                  instruction: layerAssembly.required
                    ? "STOP. Present grouping to the user BEFORE any Talo table. Use costa_confirm_layer_assembly after they accept or reject. Do not write IFC yet. After accept, costa_write_ifc_classifications (dryRun then write) stamps Talo on hosts AND Pset_CostaAssembly on all sandwich walls."
                    : layerAssembly.suggested
                      ? "Layer names found; ask the user whether to group before Talo."
                      : "No exploded sandwich gate.",
                },
                note: layerAssembly.required
                  ? "Layer-assembly GATE is active. Do not write IFC until costa_confirm_layer_assembly. After accept, write Talo only to hosts; the write tool adds Pset_CostaAssembly for hosts+layers."
                  : "Use costa_search_talo_catalog to find Talo codes for each group, then call costa_write_ifc_classifications with the confirmed assignments.",
              },
            })
          );
          return;
        }

        if (msg.type === "costa_confirm_layer_assembly") {
          const action = String(msg.action ?? "accept").toLowerCase();
          try {
            const origin = getViewerIfcOriginKind();
            const { pool, source } = await collectTaloElementPool();
            const proposal = proposeFacadeLayerAssembly(
              pool.length ? pool : [{ name: "", type: "IfcWall" }],
              origin
            );
            const store = useCostStore.getState();

            if (action === "reject") {
              store.rejectLayerAssembly();
              ws.send(
                JSON.stringify({
                  type: "costa_confirm_layer_assembly:result",
                  requestId: msg.requestId,
                  result: {
                    ok: true,
                    confirmed: false,
                    action: "reject",
                    source,
                    note: "Grouping rejected. Measure and Talo remain per piece.",
                  },
                })
              );
              return;
            }

            const hostNames = Array.isArray(msg.hostNames) && msg.hostNames.length
              ? (msg.hostNames as string[])
              : (proposal.hostNames.length ? proposal.hostNames : [...DEFAULT_HOST_NAMES]);
            const layerNames = Array.isArray(msg.layerNames) && msg.layerNames.length
              ? (msg.layerNames as string[])
              : (proposal.layerNames.length ? proposal.layerNames : [...DEFAULT_LAYER_NAMES]);
            const otherNames = Array.isArray(msg.otherNames)
              ? (msg.otherNames as string[])
              : (proposal.otherNames.length ? proposal.otherNames : [...DEFAULT_OTHER_WALL_NAMES]);

            store.confirmLayerAssembly({
              confirmed: true,
              assemblyKey: FACADE_ASSEMBLY_KEY,
              taloHint: FACADE_TALO_HINT,
              hostNames,
              layerNames,
              otherNames,
            });

            const after = getCostStoreData();
            const classifyPool = after.length > 0 ? after : pool;
            const hosts = after.length > 0
              ? after.filter((el: any) => el?.extraProperties?.["CostaBIM.LayerRole"] === "host")
              : classifyPool.filter(
                  (el: any) => resolveLayerRole(el?.name, el?.type, hostNames, layerNames, otherNames) === "host"
                );
            const layers = after.length > 0
              ? after.filter((el: any) => el?.extraProperties?.["CostaBIM.LayerRole"] === "layer")
              : classifyPool.filter(
                  (el: any) => resolveLayerRole(el?.name, el?.type, hostNames, layerNames, otherNames) === "layer"
                );
            const hostM2 = hosts.reduce(
              (s: number, el: any) => s + (Number(el?.extraProperties?.["CostaBIM.PublishedQuantity"] ?? el?.quantity ?? 0) || 0),
              0
            );
            const layerOwnM2 = layers.reduce(
              (s: number, el: any) => s + (Number(el?.extraProperties?.["CostaBIM.LayerOwnQuantity"] ?? 0) || 0),
              0
            );
            const storeReady = after.length > 0;

            ws.send(
              JSON.stringify({
                type: "costa_confirm_layer_assembly:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  confirmed: true,
                  action: "accept",
                  source,
                  storeReady,
                  taloHint: FACADE_TALO_HINT,
                  hostNames,
                  layerNames,
                  hostCount: hosts.length,
                  layerCount: layers.length,
                  hostPublishedM2: Number(hostM2.toFixed(3)),
                  layerOwnM2Kept: Number(layerOwnM2.toFixed(3)),
                  hostIds: hosts.map((el: any) => Number(el?.id ?? el?.expressId)).filter((n: number) => Number.isFinite(n)),
                  layerIds: layers.map((el: any) => Number(el?.id ?? el?.expressId)).filter((n: number) => Number.isFinite(n)),
                  next: storeReady
                    ? `Assign Talo ${FACADE_TALO_HINT} only to hostIds. Do not write facade Talo to layerIds. Layers stay in the model (LayerOwnQuantity) but määrä is host paño only.`
                    : `Policy saved. CostPage store is still empty; hostIds are IFC expressIds from the viewer. Assign Talo ${FACADE_TALO_HINT} only to those hostIds now (manual write, never autoAssign). Do not write Talo to layerIds. CostPage is only required later for Excel/Määräluettelo contrast.`,
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_confirm_layer_assembly:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            );
          }
          return;
        }

        if (msg.type === "costa_write_ifc_classifications") {
          const dryRun: boolean = msg.dryRun !== false;
          const autoAssign: boolean = msg.autoAssign === true || (!Array.isArray(msg.elements) || !(msg.elements as any[]).length);
          const minConf: number = typeof msg.minConfidence === "number" ? Math.max(0, Math.min(1, msg.minConfidence)) : 0.7;
          const skipExisting: boolean = msg.skipExisting !== false;
          const ifcTypeFilter: string[] = Array.isArray(msg.ifcTypes) ? (msg.ifcTypes as string[]).map((t) => t.toLowerCase()) : [];
          const outputFilename: string =
            typeof msg.outputFilename === "string" && msg.outputFilename.trim()
              ? msg.outputFilename.trim()
              : (() => {
                  const base = String((window as any).ifcFilename ?? "model.ifc").replace(/\.ifc$/i, "");
                  return `${base}-costa-classified.ifc`;
                })();

          // --- Helper: normalizar código Talo (dots o concatenado → dots) ---
          // talo2000.json usa "1233", TALO_2000_CATALOG usa "1.2.3.3"
          // suggestTaloAssignments devuelve formato con puntos; lo preservamos para IFC.
          function normalizeTaloDots(code: string): string {
            const c = String(code ?? "").trim();
            // Si ya tiene puntos, devolver tal cual
            if (c.includes(".")) return c;
            // Si es numérico puro (e.g. "1233"), convertir a dots: cada dígito = nivel
            if (/^\d{4}$/.test(c)) return `${c[0]}.${c[1]}.${c[2]}.${c[3]}`;
            return c;
          }

          // --- Modo auto-assign: escanear CostStore y sugerir Talo por elemento ---
          type ElInput = {
            expressId?: number;
            globalId?: string;
            taloCode?: string;
            taloName?: string;
            litteraCode?: string;
            litteraName?: string;
            litteraCategory?: string;
          };

          let elements: ElInput[] = Array.isArray(msg.elements) ? (msg.elements as any[]) : [];
          let autoSummary: Array<{
            ifcType: string;
            taloCode: string;
            taloName: string;
            confidence: number;
            elementCount: number;
          }> = [];
          let skippedAlreadyCoded = 0;
          let skippedLowConfidence = 0;

          if (autoAssign) {
            // Fuente de datos: priorizar CostStore, caer en fragmentModel (IFCViewer) si store vacío.
            const costData = getCostStoreData();
            const fragmentModelForScan = getFragmentModelRef();
            let pool: any[] = [];
            let sourceLabel = "costStore";

            if (costData.length > 0) {
              pool = costData as any[];
            } else if (fragmentModelForScan) {
              // Escanear fragmentModel directamente (IFC cargado en visor sin CostPage).
              // Sin baseQuantities → confianza más baja, pero IFC-type heuristics siguen funcionando.
              sourceLabel = "fragmentModel";
              try {
                outer_scan: for (const fragment of fragmentModelForScan.items as any[]) {
                  for (const expressId of fragment.ids as any) {
                    let element: any = null;
                    try { element = await fragmentModelForScan.getProperties(expressId); } catch { continue; }
                    if (!element) continue;
                    const inferredType = inferIfcType(element.type);
                    // Filtrar por tipo si se especificó
                    if (ifcTypeFilter.length > 0 && !ifcTypeFilter.includes(String(inferredType).toLowerCase())) continue;
                    pool.push({
                      id: Number(expressId),
                      expressId: Number(expressId),
                      globalId: element.GlobalId?.value ?? null,
                      name: element.Name?.value ?? "",
                      type: inferredType,
                      taloCode: "", // sin código previo cuando viene del fragmentModel
                      baseQuantities: {},
                    });
                    if (pool.length >= 20000) break outer_scan; // límite de seguridad
                  }
                }
              } catch (scanErr) {
                console.warn("[Costa MCP] fragmentModel scan error:", scanErr);
              }
            }

            // Filtrar por IFC type si se especificó y la fuente fue CostStore
            if (sourceLabel === "costStore" && ifcTypeFilter.length > 0) {
              pool = pool.filter((el: any) => ifcTypeFilter.includes(String(el?.type ?? "").toLowerCase()));
            }

            // Omitir elementos que ya tienen código Talo
            if (skipExisting) {
              const before = pool.length;
              pool = pool.filter((el: any) => !String(el?.taloCode ?? "").trim());
              skippedAlreadyCoded = before - pool.length;
            }

            // Agrupar por IFC type + nombre normalizado para no repetir sugerencias
            const groupKey = (el: any) =>
              `${String(el?.type ?? "").toLowerCase()}|||${String(el?.name ?? "")
                .toLowerCase()
                .replace(/[^a-z0-9 ]/g, " ")
                .replace(/\s+/g, " ")
                .trim()}`;

            const groupMap = new Map<string, { suggestion: ReturnType<typeof suggestTaloAssignments>[0] | null; items: any[] }>();
            for (const el of pool) {
              const key = groupKey(el);
              if (!groupMap.has(key)) {
                const sug = suggestTaloAssignments(el as any, 1);
                const top = sug.length > 0 && sug[0].confidence >= minConf ? sug[0] : null;
                groupMap.set(key, { suggestion: top, items: [] });
              }
              groupMap.get(key)!.items.push(el);
            }

            // Construir lista de elementos para escritura
            const typeCountMap = new Map<string, { taloCode: string; taloName: string; confidence: number; count: number }>();
            for (const [, group] of groupMap) {
              if (!group.suggestion) {
                skippedLowConfidence += group.items.length;
                continue;
              }
              const taloCode = normalizeTaloDots(group.suggestion.taloCode);
              const taloName = group.suggestion.rtName ?? "";
              for (const el of group.items) {
                elements.push({
                  expressId: Number(el?.id ?? el?.expressId ?? NaN) || undefined,
                  globalId: el?.globalId ?? undefined,
                  taloCode,
                  taloName,
                });
                const ifcType = String(el?.type ?? "unknown");
                const existing = typeCountMap.get(ifcType);
                if (!existing) {
                  typeCountMap.set(ifcType, { taloCode, taloName, confidence: group.suggestion.confidence, count: 1 });
                } else {
                  existing.count++;
                }
              }
            }

            autoSummary = Array.from(typeCountMap.entries())
              .map(([ifcType, v]) => ({ ifcType, ...v, elementCount: v.count, source: sourceLabel }))
              .sort((a, b) => b.elementCount - a.elementCount);
          }

          if (!elements.length) {
            ws.send(
              JSON.stringify({
                type: "costa_write_ifc_classifications:result",
                requestId: msg.requestId,
                result: {
                  ok: false,
                  error: autoAssign
                    ? `No elements found to classify. ${skippedAlreadyCoded ? `${skippedAlreadyCoded} already have a Talo code. ` : ""}${skippedLowConfidence ? `${skippedLowConfidence} had low confidence (< ${minConf}).` : ""}`
                    : "No elements provided.",
                },
              })
            );
            return;
          }

          // DryRun: devolver el resumen (y opcionalmente los elements para escritura server-side)
          if (dryRun) {
            // msg.returnElements:true → incluir elements para que el servidor los use en escritura
            const returnElems = msg.returnElements === true;
            ws.send(
              JSON.stringify({
                type: "costa_write_ifc_classifications:result",
                requestId: msg.requestId,
                result: {
                  ok: true,
                  dryRun: true,
                  mode: autoAssign ? "autoAssign" : "manual",
                  elementsQueued: elements.length,
                  skippedAlreadyCoded,
                  skippedLowConfidence,
                  outputFilename: null,
                  autoSummary,
                  // When requested by the server, include the full elements list so it can write server-side
                  elements: returnElems ? elements : undefined,
                  note: returnElems
                    ? "DryRun scan complete — elements included for server-side write."
                    : "DryRun — no changes written. Review autoSummary and call with dryRun:false to write the IFC.",
                },
              })
            );
            return;
          }

          // dryRun:false — la escritura real se delega al servidor MCP (Node.js + web-ifc).
          // El browser solo ejecuta el dryRun/scan. Si llegamos aquí con dryRun:false es
          // porque el servidor MCP no redirigió correctamente (no debería ocurrir).
          ws.send(
            JSON.stringify({
              type: "costa_write_ifc_classifications:result",
              requestId: msg.requestId,
              result: {
                ok: false,
                error: "dryRun:false should be handled server-side. Call the MCP tool directly with elements[] from the dryRun result.",
              },
            })
          );
          return;
        }

        // ── Herramienta Ontelolaatta: informe de orientación y conteo ──────────
        if (msg.type === "costa_get_ontelolaatta_report") {
          try {
            const mcpStore = (window as any).__costStore?.getState?.() ?? useCostStore.getState();
            const byGlobalId: Record<string, any> =
              mcpStore?.ontelolaattaMcp?.byGlobalId ?? {};
            const entries = Object.values(byGlobalId) as any[];

            // Filtro: por defecto solo confirmados (confirmedOnly: false para ver todos)
            const confirmedOnly = (msg as any).confirmedOnly !== false;
            const filtered = confirmedOnly
              ? entries.filter((e) => e.confirmed)
              : entries;

            // Join opcional con costData para obtener name y floor
            const costData: any[] = Array.isArray(mcpStore?.costData) ? mcpStore.costData : [];
            const costById = new Map<string, any>(
              costData.map((el: any) => [String(el.globalId ?? ""), el])
            );

            const fragmentModel = (window as any).fragmentModelRef as
              | import("@thatopen/fragments").FragmentsGroup
              | undefined;

            const report = filtered.map((e) => {
              let fieldLengthM = e.fieldLength;
              let measuredLineLengthM = e.measuredLineLengthM ?? null;
              // fieldWidthM = ancho total perpendicular (N piezas × 1.2 m)
              let fieldWidthM = e.fieldWidth ?? PIECE_WIDTH_M;
              let pieceCount = e.pieceCount ?? 1;

              if (fragmentModel && e.expressId != null) {
                const edges = computeFootprintEdges(fragmentModel, e.expressId);
                if (edges) {
                  // false = vano en eje corto (default); true = vano en eje largo
                  const lineAlongLong = e.lineAlongLong ?? false;
                  const { p1, p2 } = computeSpanLinePoints(edges, lineAlongLong);
                  measuredLineLengthM = +p1.distanceTo(p2).toFixed(3);
                  fieldLengthM = resolveFieldLength(edges, lineAlongLong, p1, p2);
                  const perpWidth = resolvePerpWidth(edges, lineAlongLong);
                  fieldWidthM = +perpWidth.toFixed(3);
                  pieceCount = computePieceCount(perpWidth);
                }
              }

              return {
                globalId:    e.globalId,
                name:        costById.get(e.globalId)?.name ?? e.globalId,
                floor:       e.floor ?? costById.get(e.globalId)?.floor ?? null,
                onteloType:  e.onteloType,
                thicknessMm: e.thicknessMm,
                fieldLengthM:  +fieldLengthM.toFixed(3),
                fieldWidthM,
                pieceLengthM:  +fieldLengthM.toFixed(3),
                pieceWidthM:   PIECE_WIDTH_M,
                pieceCount,
                measuredLineLengthM,
                areaPieceM2:   +(fieldLengthM * PIECE_WIDTH_M).toFixed(3),
                areaTotalM2:   +(fieldLengthM * pieceCount * PIECE_WIDTH_M).toFixed(3),
                source:        e.source,
                lineAlongLong: e.lineAlongLong ?? false,
                confirmed:     e.confirmed,
              };
            });

            ws.send(
              JSON.stringify({
                type: "costa_get_ontelolaatta_report:result",
                requestId: msg.requestId,
                result: {
                  count:           report.length,
                  totalPieceCount: report.reduce((s: number, r: any) => s + r.pieceCount, 0),
                  totalAreaM2:     +report
                    .reduce((s: number, r: any) => s + r.areaTotalM2, 0)
                    .toFixed(3),
                  entries: report,
                },
              })
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "costa_get_ontelolaatta_report:result",
                requestId: msg.requestId,
                result: {
                  count: 0,
                  totalPieceCount: 0,
                  totalAreaM2: 0,
                  entries: [],
                  error: err instanceof Error ? err.message : String(err),
                },
              })
            );
          }
          return;
        }

        console.warn("[Costa MCP] Unhandled message type:", msg.type);
      }
    } catch (error) {
      console.error("❌ [Costa MCP] Error handling message:", error);
    }
  };

  ws.onerror = (error) => {
    console.error("❌ [Costa MCP] WebSocket error:", error);
  };

  ws.onclose = () => {
    console.log("🔌 [Costa MCP] Disconnected");
    if (!MCP_WS_URL) return;
    const attempts = ((window as any).__mcpReconnectAttempts ?? 0) as number;
    const MAX_ATTEMPTS = 10;
    if (attempts >= MAX_ATTEMPTS) {
      console.warn(`[Costa MCP] Reconnection limit reached (${MAX_ATTEMPTS}). Reload the page to reconnect.`);
      return;
    }
    (window as any).__mcpReconnectAttempts = attempts + 1;
    // Backoff exponencial: 5s, 10s, 20s … hasta un máximo de 30s.
    const delay = Math.min(5_000 * Math.pow(2, attempts), 30_000);
    console.log(`[Costa MCP] Reconnecting in ${delay / 1000}s (attempt ${attempts + 1}/${MAX_ATTEMPTS})…`);
    setTimeout(
      () => setupMCPWebSocket(resolveLiveComponents(components) ?? undefined),
      delay
    );
  };

  (window as unknown as { mcpWebSocket?: WebSocket }).mcpWebSocket = ws;
  return ws;
}
