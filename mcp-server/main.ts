import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import net from "net";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as XLSXNS from "xlsx";
import ExcelJS from "exceljs";
import { IfcAPI } from "web-ifc";
import {
  DEFAULT_HOST_NAMES,
  DEFAULT_LAYER_NAMES,
  DEFAULT_OTHER_WALL_NAMES,
  FACADE_ASSEMBLY_KEY,
  resolveLayerRole,
} from "../src/utils/layerAssemblyPolicy.ts";
import {
  releaseCostaMcpInstanceLock,
  resolveBridgeRole,
  type BridgeRole,
} from "./mcpInstanceLock.ts";
import {
  attachBridgeRelayServer,
  isRelaySocket,
  sendJsonViaBridgeRelay,
} from "./mcpBridgeRelay.ts";
import {
  COST_STORE_EMPTY_MCP_CODE,
  COST_STORE_EMPTY_USER_MESSAGE_EN,
  COST_STORE_EMPTY_USER_MESSAGE_ES,
  getBridgeSelectedColumnHeaders,
  getBridgeAuditColumnHeaders,
  isBridgeAuditHeader,
  isBridgeCostUnitHeader,
  isBridgeDecisionHeader,
  isBridgeIfcRawHeader,
  summarizeMeasurementAuditTrust,
  BRIDGE_IFC_RAW_HEADERS,
  BRIDGE_DECISION_HEADERS,
  BRIDGE_COST_UNIT_COLUMNS,
  type MeasurementAuditTrustSummary,
} from "../src/utils/measurementBridgeExport.ts";
import type { MeasurementFeatureFlagsSnapshot } from "../src/utils/measurementPreflightPolicy.ts";
import {
  summarizeWallQuantityRecovery,
  type WallQuantityRecoverySummary,
} from "../src/utils/wallGrossVolumeBrick.ts";
import type { AbPolicyCounts } from "../src/utils/abPolicySummary.ts";
import {
  buildCriticalFamilyCoverage,
  buildPreflightStratifiedSampleIds,
  buildPreflightTypeFetchPlan,
  normalizePreflightByTypeMap,
  sortIfcTypesForPreflight,
  type CriticalFamilyCoverage,
} from "../src/utils/measurementPreflightPolicy.ts";

// Compatibilidad ESM/CJS para SheetJS bajo tsx + Node.
// En algunos entornos `xlsx` expone API en `default`, en otros en el namespace.
const XLSX = ((XLSXNS as any).default ?? XLSXNS) as typeof XLSXNS;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// MCP uses stdout for JSON-RPC. Any log/debug must go to stderr only.
function logStderr(msg: string) {
  process.stderr.write(msg + "\n");
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port);
  });
}

async function waitForPort(port: number, maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isPortAvailable(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const PORT = Number(process.env.MCP_WS_PORT || 8081);
const bridgeRole: BridgeRole = resolveBridgeRole({ port: PORT, log: logStderr });

async function startWebSocketServer(port: number): Promise<WebSocketServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    const onError = (error: unknown) => {
      wss.off("listening", onListening);
      try {
        wss.close();
      } catch {
        // ignore
      }
      reject(error);
    };
    const onListening = () => {
      wss.off("error", onError);
      resolve(wss);
    };
    wss.once("error", onError);
    wss.once("listening", onListening);
  });
}

async function createWebSocketServerWithRetry(port: number, retries = 8): Promise<WebSocketServer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        const free = await waitForPort(port, 8000);
        if (!free) {
          logStderr(`Port ${port} still busy before attempt ${attempt}/${retries} (not killing other processes)`);
        }
      }
      const wss = await startWebSocketServer(port);
      logStderr(`[Costa MCP] WebSocket listening on port ${port}`);
      return wss;
    } catch (error) {
      lastError = error;
      logStderr(`WebSocket bind attempt ${attempt}/${retries} failed: ${String(error)}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Browser bridge (Costa app). Started after stdio MCP connects — failure must not kill Claude tools. */
let ws: WebSocketServer | null = null;

const server = new McpServer({ name: "Costa-MCP-Server", version: "1.0.0" });

function sendJsonToBrowserClient(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!ws) {
      return reject(new Error("Costa MCP WebSocket server is not running."));
    }
    const client = Array.from(ws.clients).find(
      (c: { readyState: number }) => c.readyState === 1 && !isRelaySocket(c as import("ws").WebSocket)
    );
    if (!client) {
      return reject(new Error("No Costa app WebSocket client connected. Open a project in IFCViewer."));
    }

    const requestId = Math.random().toString(36).slice(2);
    const payload = { ...message, requestId };

    const onMessage = (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const raw = data.toString();
        logStderr(`[WS] Message from app: ${raw.slice(0, 200)}`);
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.requestId === requestId) {
          (client as { off: (e: string, h: (d: Buffer | ArrayBuffer | Buffer[]) => void) => void }).off(
            "message",
            onMessage
          );
          resolve(msg);
        }
      } catch {
        // Ignore non-JSON or non-matching messages
      }
    };

    (client as { on: (e: string, h: (d: Buffer) => void) => void }).on("message", onMessage);

    (client as { send: (d: string, cb?: (err?: Error) => void) => void }).send(
      JSON.stringify(payload),
      (err?: Error) => {
        if (err) {
          (client as { off: (e: string, h: (d: Buffer | ArrayBuffer | Buffer[]) => void) => void }).off(
            "message",
            onMessage
          );
          reject(err);
        }
      }
    );

    setTimeout(() => {
      (client as { off: (e: string, h: (d: Buffer | ArrayBuffer | Buffer[]) => void) => void }).off(
        "message",
        onMessage
      );
      reject(new Error("Timeout waiting for response from Costa app"));
    }, 60000);
  });
}

function sendJsonToFirstClient(message: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (bridgeRole === "secondary") {
    return sendJsonViaBridgeRelay(PORT, message, logStderr);
  }
  return sendJsonToBrowserClient(message);
}

function normalizeElementName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIfcType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Igual que `costTableGrouping.normalizeRevitName` (agrupación Costa / import Excel). */
function normalizeRevitName(name: string): string {
  if (!name) return name;
  return name.replace(/:\d{3,}$/, "");
}

function stripMeasurementNameVariants(name: string): string {
  return String(name ?? "").replace(/\s*\(\d+\s+variants?\)\s*$/i, "").trim();
}

/** Alineado con `costa_suggest_cost_codes` / websocket (~0.50). No escribir sugerencias muy débiles. */
const MIN_LITTERA_SUGGESTION_CONFIDENCE = 0.5;
const CLAUDE_PLACEHOLDER_CODE = "(PLACEHOLDERFORCLAUDE)";

function isLitteraPlaceholderCell(value: string): boolean {
  const t = value.trim().toLowerCase();
  if (!t) return true;
  return t.includes("no littera") || t === "(no littera codes)" || t === CLAUDE_PLACEHOLDER_CODE.toLowerCase();
}

/**
 * Filas que CostPage trata como Littera por grupo: sin GUID, con IFC Type y Name.
 * Ver `handleSyncImport` → `if (!guid && ifcType && name)`.
 */
function isMeasurementDataLitteraRow(
  row: string[],
  idxGuid: number,
  idxIfcType: number,
  idxName: number,
  idxTalo: number,
  idxLitteraCode: number,
  idxLitteraName: number,
  idxLitteraCategory: number,
  idxUnit: number,
  idxQuantity: number,
  idxRelevance: number
): boolean {
  const guid = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
  if (guid) return false;
  const ifc = idxIfcType >= 0 ? String(row[idxIfcType] ?? "").trim() : "";
  const name = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
  if (!ifc || !name) return false;

  // Excluir filas resumen de tipo IFC: "25 groups, 119 elements, 95 Littera codes"
  if (/\bgroups?,\s*\d+\s*elements?\b/i.test(name)) return false;

  // Fila Littera real solo si trae datos de littera/unidad/relevancia.
  // No usar TALO como señal, porque filas resumen de grupo pueden tener TALO.
  const lc = idxLitteraCode >= 0 ? String(row[idxLitteraCode] ?? "").trim() : "";
  const ln = idxLitteraName >= 0 ? String(row[idxLitteraName] ?? "").trim() : "";
  const lcat = idxLitteraCategory >= 0 ? String(row[idxLitteraCategory] ?? "").trim() : "";
  const unit = idxUnit >= 0 ? String(row[idxUnit] ?? "").trim() : "";
  const qty = idxQuantity >= 0 ? String(row[idxQuantity] ?? "").trim() : "";
  const rel = idxRelevance >= 0 ? String(row[idxRelevance] ?? "").trim() : "";
  return Boolean(lc || ln || lcat || unit || qty || rel);
}

/** Misma clave que `buildGroupedData` / import: `${talo}-${normalizeRevitName(name)}`. */
function buildElementsByAppGroupKey(viewerElements: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const el of viewerElements) {
    const talo = String(el?.taloCode ?? "").trim();
    const nameNorm = normalizeRevitName(String(el?.name ?? "").trim());
    const key = `${talo}-${nameNorm}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(el);
  }
  return m;
}

/** Fallback para enlazar filas Littera cuando el TALO del Excel no coincide con el store. */
function buildElementsByIfcTypeAndNameKey(viewerElements: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const el of viewerElements) {
    const ifcType = normalizeIfcType(el?.type);
    const nameNorm = normalizeElementName(normalizeRevitName(String(el?.name ?? "").trim()));
    const key = `${ifcType}__${nameNorm}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(el);
  }
  return m;
}

function excelRow1FromAoaIndex(r: number): number {
  return r + 1;
}

function excelJsSetCell(ws: ExcelJS.Worksheet, row1: number, col1: number, value: string | number | null) {
  const cell = ws.getRow(row1).getCell(col1);
  if (value === null || value === "") {
    cell.value = null;
  } else {
    cell.value = value;
  }
}

function clearLitteraColumnsExcelJs(
  ws: ExcelJS.Worksheet,
  row1: number,
  cols: { litteraCode: number; litteraName: number; litteraCategory: number; unit: number; quantity: number; relevance: number }
) {
  const clear = (idx: number) => {
    if (idx >= 0) excelJsSetCell(ws, row1, idx + 1, null);
  };
  clear(cols.litteraCode);
  clear(cols.litteraName);
  clear(cols.litteraCategory);
  clear(cols.unit);
  clear(cols.quantity);
  clear(cols.relevance);
}

type CostTableSheetKind = "talo" | "littera";

function sheetRowsToAoa(sheet: XLSXNS.WorkSheet): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" }) as string[][];
}

function rowHeadersLower(row: unknown[]): string[] {
  return (row ?? []).map((c) => String(c ?? "").trim().toLowerCase());
}

/** Costa IFC measurement export puts headers on row 3; CostPage/Sync may use row 1. */
function findMeasurementHeaderRowIndex(aoa: string[][]): number {
  const maxScan = Math.min(50, aoa.length);
  for (let r = 0; r < maxScan; r++) {
    const low = rowHeadersLower(aoa[r] ?? []);
    if (!low.some(Boolean)) continue;
    if (!low.includes("guid")) continue;
    if (low.includes("ifc type") || low.includes("name") || low.includes("talo code")) {
      return r;
    }
  }
  return -1;
}

/** IFCMeasurementPanel / measurement-ifc: GUID + type or name (or Sync with TALO). */
function rowLooksLikeCostMeasurement(low: string[]): boolean {
  if (!low.includes("guid")) return false;
  return (
    low.includes("ifc type") ||
    low.includes("name") ||
    low.includes("talo code")
  );
}

function sheetMatchesCostTableKind(headersLower: string[], kind: CostTableSheetKind): boolean {
  const hasLink = headersLower.includes("guid") || headersLower.includes("name");
  if (!hasLink) return false;
  if (kind === "talo") return headersLower.includes("talo code");
  return headersLower.includes("littera code");
}

const LITTERA_HEADERS_TO_ENSURE = [
  "Littera Code",
  "Littera Name",
  "Littera Category",
  "Unit",
  "Relevance Score",
] as const;

function ensureLitteraHeaderColumns(aoa: string[][], headerRowIndex: number): void {
  const headerRow = [...(aoa[headerRowIndex] ?? []).map((c) => String(c ?? ""))];
  const existing = new Set(
    headerRow.map((h) => h.trim().toLowerCase()).filter(Boolean)
  );
  const toAdd: string[] = [];
  for (const h of LITTERA_HEADERS_TO_ENSURE) {
    if (!existing.has(h.toLowerCase())) toAdd.push(h);
  }
  if (toAdd.length === 0) return;
  aoa[headerRowIndex] = [...headerRow, ...toAdd];
  const w = aoa[headerRowIndex].length;
  for (let r = 0; r < aoa.length; r++) {
    if (r === headerRowIndex) continue;
    const row = [...(aoa[r] ?? []).map((c) => String(c ?? ""))];
    while (row.length < w) row.push("");
    aoa[r] = row;
  }
}

function ensureTaloHeaderColumns(aoa: string[][], headerRowIndex: number): void {
  const headerRow = [...(aoa[headerRowIndex] ?? []).map((c) => String(c ?? ""))];
  const existing = new Set(
    headerRow.map((h) => h.trim().toLowerCase()).filter(Boolean)
  );
  const toAdd: string[] = [];
  if (!existing.has("talo code")) toAdd.push("TALO Code");
  if (!existing.has("talo name")) toAdd.push("TALO Name");
  if (toAdd.length === 0) return;
  aoa[headerRowIndex] = [...headerRow, ...toAdd];
  const w = aoa[headerRowIndex].length;
  for (let r = 0; r < aoa.length; r++) {
    if (r === headerRowIndex) continue;
    const row = [...(aoa[r] ?? []).map((c) => String(c ?? ""))];
    while (row.length < w) row.push("");
    aoa[r] = row;
  }
}

type PickedCostSheet = {
  sheetName: string;
  sheet: XLSXNS.WorkSheet;
  aoa: string[][];
  headerRowIndex: number;
  headers: string[];
};

function pickWorksheetForCostTable(
  workbook: XLSXNS.WorkBook,
  preferredSheetName?: string,
  kind: CostTableSheetKind = "talo"
): PickedCostSheet {
  const trySheet = (sheetName: string, sheet: XLSXNS.WorkSheet): PickedCostSheet | null => {
    const aoa = sheetRowsToAoa(sheet);
    let hi = findMeasurementHeaderRowIndex(aoa);
    if (hi < 0 && aoa.length > 0) {
      const low0 = rowHeadersLower(aoa[0] ?? []);
      if (low0.includes("guid")) hi = 0;
    }
    if (hi < 0) return null;

    const headers = (aoa[hi] ?? []).map((c) => String(c ?? "").trim());
    aoa[hi] = headers;
    let headersLower = headers.map((h) => h.toLowerCase());

    if (kind === "littera") {
      if (sheetMatchesCostTableKind(headersLower, "littera")) {
        return { sheetName, sheet, aoa, headerRowIndex: hi, headers: aoa[hi] };
      }
      if (rowLooksLikeCostMeasurement(headersLower)) {
        ensureLitteraHeaderColumns(aoa, hi);
        return { sheetName, sheet, aoa, headerRowIndex: hi, headers: aoa[hi] };
      }
      return null;
    }

    if (sheetMatchesCostTableKind(headersLower, "talo")) {
      return { sheetName, sheet, aoa, headerRowIndex: hi, headers: aoa[hi] };
    }
    if (rowLooksLikeCostMeasurement(headersLower)) {
      ensureTaloHeaderColumns(aoa, hi);
      return { sheetName, sheet, aoa, headerRowIndex: hi, headers: aoa[hi] };
    }
    return null;
  };

  if (preferredSheetName && workbook.SheetNames.includes(preferredSheetName)) {
    const sheet = workbook.Sheets[preferredSheetName];
    if (sheet) {
      const picked = trySheet(preferredSheetName, sheet);
      if (picked) {
        applyHeaderRowToSheet(sheet, picked.headerRowIndex, picked.headers);
        return picked;
      }
      throw new Error(
        `Sheet "${preferredSheetName}" has no usable measurement table (need a row with GUID plus IFC Type, Name, or TALO Code).`
      );
    }
  }

  const orderedNames = ["Measurement Data", "IFC Measurements", "Sync", ...workbook.SheetNames];
  const seen = new Set<string>();
  for (const name of orderedNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!workbook.SheetNames.includes(name)) continue;
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const picked = trySheet(name, sheet);
    if (picked) {
      applyHeaderRowToSheet(sheet, picked.headerRowIndex, picked.headers);
      return picked;
    }
  }

  const hint =
    kind === "littera"
      ? "Need Measurement Data (or similar) with GUID and IFC Type/Name — or open a Cost Analysis export that includes Littera columns. IFC-only measurement Excel is supported: headers must be in the first ~50 rows."
      : "Need a sheet with GUID and IFC Type or Name (IFC measurement export) or existing TALO Code column.";
  throw new Error(
    `No worksheet found for ${kind} fill. ${hint} Sheets: ${workbook.SheetNames.join(", ") || "(none)"}`
  );
}

function updateSheetCell(sheet: XLSXNS.WorkSheet, rowIndexZeroBased: number, colIndexZeroBased: number, value: string) {
  const addr = XLSX.utils.encode_cell({ r: rowIndexZeroBased, c: colIndexZeroBased });
  const existing = sheet[addr] as XLSXNS.CellObject | undefined;
  if (existing) {
    existing.t = "s";
    existing.v = value;
    sheet[addr] = existing;
  } else {
    sheet[addr] = { t: "s", v: value };
  }
}

function applyHeaderRowToSheet(
  sheet: XLSXNS.WorkSheet,
  headerRowIndex: number,
  headers: string[]
) {
  for (let c = 0; c < headers.length; c++) {
    const v = headers[c];
    if (v !== undefined && String(v).length > 0) {
      updateSheetCell(sheet, headerRowIndex, c, String(v));
    }
  }
}

function clearSheetCell(sheet: XLSXNS.WorkSheet, rowIndexZeroBased: number, colIndexZeroBased: number) {
  const addr = XLSX.utils.encode_cell({ r: rowIndexZeroBased, c: colIndexZeroBased });
  delete sheet[addr];
}

const DEFAULT_WORKFLOW_STATE_DIR =
  process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CostaMCP", "workflow-state")
    : path.join(os.homedir(), ".costa-mcp", "workflow-state");
const WORKFLOW_STATE_DIR = (process.env.WORKFLOW_STATE_DIR || "").trim() || DEFAULT_WORKFLOW_STATE_DIR;
const WORKFLOW_STATE_TTL_DAYS = Math.max(1, Number.parseInt(process.env.WORKFLOW_STATE_TTL_DAYS || "30", 10) || 30);
const WORKFLOW_STATE_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Avoid cleanup on every call.
let lastWorkflowStateCleanupAtMs = 0;

type WorkflowBatchStatus = "pending" | "approved" | "applied" | "blocked";

type WorkflowBatch = {
  id: string;
  label: string;
  status: WorkflowBatchStatus;
  groupRows: number[];
  notes?: string;
};

type WorkflowMissingBlock = {
  groupRow: number;
  name: string;
  taloCode: string;
  sampleGuids: string[];
  suggestedEmptyRowsToAdd: number;
};

type WorkflowMissingGroup = {
  groupRow: number;
  name: string;
  taloCode: string;
  sampleGuids: string[];
  recommendedPlaceholderCopies: number;
};

type WorkflowOverAssignedGroupDetail = {
  groupRow: number;
  name: string;
  taloCode: string;
  ifcType: string;
  /** Full list of Littera codes in the group block (needed for prune dryRun without calling costa_diagnose_littera_excel). */
  litteraCodes: string[];
  sampleGuids: string[];
};

type WorkflowDiagnosis = {
  generatedAt: string;
  file: string;
  summary: {
    totalGroups: number;
    ok: number;
    missing: number;
    overAssigned: number;
    taloMismatch: number;
  };
  maaraluettelo: {
    inSync: boolean | null;
    discrepancies: number;
    note: string;
  };
  blockedMissingNoRows: WorkflowMissingBlock[];
  missingGroups: WorkflowMissingGroup[];
  missingGroupsNeedingPlaceholder: WorkflowMissingGroup[];
  defaultBatches: WorkflowBatch[];
  /** Per OVER_ASSIGNED group: full litteraCodes + context. Populated whenever overAssigned > 0. */
  overAssignedDetails?: WorkflowOverAssignedGroupDetail[];
};

type WorkflowState = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  excelPath?: string;
  allowMissingWithoutRows: boolean;
  diagnosis?: WorkflowDiagnosis;
  checkpoints: Array<{
    createdAt: string;
    label: string;
    path: string;
  }>;
  decisions: Array<{
    at: string;
    note: string;
  }>;
  currentPhase: "diagnose" | "plan" | "execute" | "reconcile";
};

function ensureWorkflowStateDir(): void {
  if (!fs.existsSync(WORKFLOW_STATE_DIR)) {
    fs.mkdirSync(WORKFLOW_STATE_DIR, { recursive: true });
  }
  maybeCleanupWorkflowStateDir();
}

function maybeCleanupWorkflowStateDir(): void {
  const nowMs = Date.now();
  if (nowMs - lastWorkflowStateCleanupAtMs < WORKFLOW_STATE_CLEANUP_INTERVAL_MS) return;
  lastWorkflowStateCleanupAtMs = nowMs;

  try {
    const ttlMs = WORKFLOW_STATE_TTL_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;
    const entries = fs.readdirSync(WORKFLOW_STATE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^wf-.*\.json$/i.test(entry.name)) continue;
      const fp = path.join(WORKFLOW_STATE_DIR, entry.name);
      let st: fs.Stats;
      try {
        st = fs.statSync(fp);
      } catch {
        continue;
      }
      if (nowMs - st.mtimeMs > ttlMs) {
        try {
          fs.unlinkSync(fp);
          removed++;
        } catch {
          // Best-effort cleanup; ignore race conditions / file locks.
        }
      }
    }
    if (removed > 0) {
      logStderr(
        `[workflow-state] cleaned ${removed} expired file(s) older than ${WORKFLOW_STATE_TTL_DAYS} day(s) in ${WORKFLOW_STATE_DIR}`
      );
    }
  } catch (error) {
    logStderr(
      `[workflow-state] cleanup warning: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function sanitizeSessionId(raw: string): string {
  const cleaned = String(raw ?? "").trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return cleaned || `wf-${Date.now()}`;
}

function getWorkflowStatePath(sessionId: string): string {
  return path.join(WORKFLOW_STATE_DIR, `${sanitizeSessionId(sessionId)}.json`);
}

function readWorkflowState(sessionId: string): WorkflowState | null {
  ensureWorkflowStateDir();
  const p = getWorkflowStatePath(sessionId);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw) as WorkflowState;
}

function writeWorkflowState(state: WorkflowState): void {
  ensureWorkflowStateDir();
  const p = getWorkflowStatePath(state.sessionId);
  fs.writeFileSync(p, JSON.stringify(state, null, 2), "utf-8");
}

function cloneExcelProgressive(excelPath: string, sessionId: string, label?: string): string {
  const fullInputPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
  if (!fs.existsSync(fullInputPath)) throw new Error(`Excel file not found: ${fullInputPath}`);
  if (!fullInputPath.toLowerCase().endsWith(".xlsx")) throw new Error("Only .xlsx files are supported.");
  const parsed = path.parse(fullInputPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label ? String(label).trim().replace(/[^a-zA-Z0-9._-]/g, "-") : "checkpoint";
  const out = path.join(parsed.dir, `${parsed.name}-${sanitizeSessionId(sessionId)}-${safeLabel}-${stamp}.xlsx`);
  fs.copyFileSync(fullInputPath, out);
  return out;
}

function runWorkflowDiagnosis(excelPath: string, overAssignedThreshold = 8): WorkflowDiagnosis {
  const fullPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
  if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);
  if (!fullPath.toLowerCase().endsWith(".xlsx")) throw new Error("Only .xlsx files are supported.");

  const workbook = XLSX.readFile(fullPath, { raw: true });
  const picked = pickWorksheetForCostTable(workbook, "Measurement Data", "littera");
  const { aoa, headerRowIndex, headers } = picked;
  const headersLower = headers.map((h) => h.toLowerCase());
  const idxIfcType = headersLower.indexOf("ifc type");
  const idxName = headersLower.indexOf("name");
  const idxGuid = headersLower.indexOf("guid");
  const idxTalo = headersLower.indexOf("talo code");
  const idxLitteraCode = headersLower.indexOf("littera code");
  const idxLitteraName = headersLower.indexOf("littera name");
  const idxLitteraCategory = headersLower.indexOf("littera category");
  const idxUnit = headersLower.indexOf("unit");
  const idxQuantity = headersLower.indexOf("quantity");
  const idxRelevance = headersLower.indexOf("relevance score");
  if (idxGuid < 0 || idxName < 0 || idxIfcType < 0) {
    throw new Error("Required columns (GUID, Name, IFC Type) not found in sheet.");
  }

  const guidRows: Array<{ r: number; guid: string }> = [];
  for (let r = headerRowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? [];
    const guid = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
    if (guid) guidRows.push({ r, guid });
  }

  const isGroupHeader = (row: string[]): boolean => {
    const g = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
    if (g) return false;
    const ifc = idxIfcType >= 0 ? String(row[idxIfcType] ?? "").trim() : "";
    if (ifc) return false;
    const nm = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
    if (!nm) return false;
    if (/\bgroups?,\s*\d+\s*elements?\b/i.test(nm)) return false;
    return !isMeasurementDataLitteraRow(row, idxGuid, idxIfcType, idxName, idxTalo, idxLitteraCode, idxLitteraName, idxLitteraCategory, idxUnit, idxQuantity, idxRelevance);
  };

  const groupByRow = new Map<number, {
    ifcType: string;
    name: string;
    taloCode: string;
    groupRow: number;
    litteraCodes: string[];
    litteraRowsCount: number;
    hasPlaceholder: boolean;
    sampleGuids: string[];
  }>();

  for (const { r: guidR, guid } of guidRows) {
    let groupRowAoa = -1;
    for (let r = guidR - 1; r >= headerRowIndex; r--) {
      if (isGroupHeader(aoa[r] ?? [])) {
        groupRowAoa = r;
        break;
      }
    }
    if (groupRowAoa < 0) continue;
    const current = groupByRow.get(groupRowAoa);
    if (current) {
      if (current.sampleGuids.length < 5) current.sampleGuids.push(guid);
      continue;
    }

    const header = aoa[groupRowAoa] ?? [];
    const ifcType = idxIfcType >= 0 ? String(header[idxIfcType] ?? "").trim() : "";
    const name = idxName >= 0 ? String(header[idxName] ?? "").trim() : "";
    const talo = idxTalo >= 0 ? String(header[idxTalo] ?? "").trim() : "";
    const litteraCodes: string[] = [];
    let litteraRowsCount = 0;
    let hasPlaceholder = false;
    for (let r = groupRowAoa + 1; r < guidR; r++) {
      const row = aoa[r] ?? [];
      const g = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
      if (g) break;
      if (!isMeasurementDataLitteraRow(row, idxGuid, idxIfcType, idxName, idxTalo, idxLitteraCode, idxLitteraName, idxLitteraCategory, idxUnit, idxQuantity, idxRelevance)) continue;
      litteraRowsCount++;
      const lc = idxLitteraCode >= 0 ? String(row[idxLitteraCode] ?? "").trim() : "";
      if (isLitteraPlaceholderCell(lc)) {
        hasPlaceholder = true;
      } else if (lc) {
        litteraCodes.push(lc);
      }
    }

    groupByRow.set(groupRowAoa, {
      ifcType,
      name,
      taloCode: talo,
      groupRow: groupRowAoa + 1,
      litteraCodes,
      litteraRowsCount,
      hasPlaceholder,
      sampleGuids: [guid],
    });
  }

  const groups = Array.from(groupByRow.values()).sort((a, b) => a.groupRow - b.groupRow);
  const byStatus = { ok: 0, missing: 0, overAssigned: 0, taloMismatch: 0 };
  const blockedMissingNoRows: WorkflowMissingBlock[] = [];
  const missingGroups: WorkflowMissingGroup[] = [];
  const missingGroupsNeedingPlaceholder: WorkflowMissingGroup[] = [];

  for (const g of groups) {
    const count = g.litteraCodes.length;
    if (count === 0 || g.hasPlaceholder) {
      byStatus.missing++;
      const missingGroup: WorkflowMissingGroup = {
        groupRow: g.groupRow,
        name: g.name,
        taloCode: g.taloCode,
        sampleGuids: g.sampleGuids,
        // Workflow rule: every MISSING group gets one placeholder copy step.
        recommendedPlaceholderCopies: 1,
      };
      missingGroups.push(missingGroup);
      if (count === 0 && !g.hasPlaceholder) {
        missingGroupsNeedingPlaceholder.push(missingGroup);
      }
      if (g.litteraRowsCount === 0) {
        blockedMissingNoRows.push({
          groupRow: g.groupRow,
          name: g.name,
          taloCode: g.taloCode,
          sampleGuids: g.sampleGuids,
          suggestedEmptyRowsToAdd: 1,
        });
      }
    } else if (count > overAssignedThreshold) {
      byStatus.overAssigned++;
    } else {
      const hasCats = false;
      if (hasCats) byStatus.taloMismatch++;
      else byStatus.ok++;
    }
  }

  let maaraSyncNote = "Sheet 'Määräluettelo' not found in workbook.";
  let maaraInSync: boolean | null = null;
  let maaraDiscrepancies = 0;
  const mdCodes = new Set<string>();
  groups.forEach((g) => g.litteraCodes.forEach((c) => mdCodes.add(c)));

  if (workbook.SheetNames.includes("Määräluettelo")) {
    const maaraSheet = workbook.Sheets["Määräluettelo"];
    const maaraAoa: string[][] = XLSX.utils.sheet_to_json(maaraSheet, { header: 1, defval: "" }) as string[][];
    let headerIdx = -1;
    let idxLit = -1;
    for (let r = 0; r < Math.min(30, maaraAoa.length); r++) {
      const low = rowHeadersLower(maaraAoa[r] ?? []);
      const lit = low.indexOf("littera");
      const sel = low.indexOf("selite");
      const maa = low.indexOf("määrä");
      const yks = low.indexOf("yks");
      if (lit >= 0 && sel >= 0 && maa >= 0 && yks >= 0) {
        headerIdx = r;
        idxLit = lit;
        break;
      }
    }
    const maaraCodes = new Set<string>();
    if (headerIdx >= 0 && idxLit >= 0) {
      for (let r = headerIdx + 1; r < maaraAoa.length; r++) {
        const code = String((maaraAoa[r] ?? [])[idxLit] ?? "").trim();
        if (code && code.length >= 5 && /^\d+$/.test(code)) maaraCodes.add(code);
      }
    }
    const isScopeCode = (c: string) => c === "001000" || c === "002000" || c === "003000";
    const mdCodesFiltered = [...mdCodes].filter((c) => !isScopeCode(c));
    const maaraCodesFiltered = [...maaraCodes].filter((c) => !isScopeCode(c));
    const onlyInMd = mdCodesFiltered.filter((c) => !maaraCodesFiltered.includes(c));
    const onlyInMaara = maaraCodesFiltered.filter((c) => !mdCodesFiltered.includes(c));
    maaraDiscrepancies = onlyInMd.length + onlyInMaara.length;
    maaraInSync = maaraDiscrepancies === 0;
    if (maaraInSync) {
      maaraSyncNote = `✓ In sync — ${maaraCodes.size} codes match between Measurement Data and Määräluettelo.`;
    } else {
      maaraSyncNote =
        `⚠ ${maaraDiscrepancies} discrepancy(ies): ` +
        (onlyInMd.length ? `${onlyInMd.length} codes in Measurement Data but not in Määräluettelo (${onlyInMd.slice(0, 5).join(", ")}${onlyInMd.length > 5 ? "…" : ""}). ` : "") +
        (onlyInMaara.length ? `${onlyInMaara.length} codes in Määräluettelo but not in Measurement Data (${onlyInMaara.slice(0, 5).join(", ")}${onlyInMaara.length > 5 ? "…" : ""}).` : "");
    }
  }

  const defaultBatches: WorkflowBatch[] = [
    { id: "over_assigned", label: "Prune OVER_ASSIGNED groups", status: "pending" as const, groupRows: groups.filter((g) => g.litteraCodes.length > overAssignedThreshold).map((g) => g.groupRow) },
    { id: "missing", label: "Resolve MISSING groups", status: "pending" as const, groupRows: groups.filter((g) => g.litteraCodes.length === 0 || g.hasPlaceholder).map((g) => g.groupRow) },
  ].filter((b) => b.groupRows.length > 0);

  const overAssignedDetails: WorkflowOverAssignedGroupDetail[] = groups
    .filter((g) => g.litteraCodes.length > overAssignedThreshold)
    .map((g) => ({
      groupRow: g.groupRow,
      name: g.name,
      taloCode: g.taloCode,
      ifcType: g.ifcType,
      litteraCodes: [...g.litteraCodes],
      sampleGuids: [...g.sampleGuids],
    }));

  return {
    generatedAt: new Date().toISOString(),
    file: path.basename(fullPath),
    summary: {
      totalGroups: groups.length,
      ok: byStatus.ok,
      missing: byStatus.missing,
      overAssigned: byStatus.overAssigned,
      taloMismatch: byStatus.taloMismatch,
    },
    maaraluettelo: { inSync: maaraInSync, discrepancies: maaraDiscrepancies, note: maaraSyncNote },
    blockedMissingNoRows,
    missingGroups,
    missingGroupsNeedingPlaceholder,
    defaultBatches,
    ...(overAssignedDetails.length > 0 ? { overAssignedDetails } : {}),
  };
}

function buildWorkflowPlaybook(opts: {
  allowMissingWithoutRows: boolean;
  blockedMissingNoRows: number;
  /** When > 0, diagnosis includes overAssignedDetails with full litteraCodes per groupRow. */
  overAssignedCount?: number;
}): string[] {
  const overAssignedHint =
    opts.overAssignedCount != null && opts.overAssignedCount > 0
      ? [
          "OVER_ASSIGNED: use diagnosis.overAssignedDetails (full litteraCodes + sampleGuids per groupRow) to choose codes to keep — avoid costa_diagnose_littera_excel solely to list codes before batch dryRun.",
        ]
      : [];
  const base = [
    ...overAssignedHint,
    "Work only OVER_ASSIGNED in small batches (max 5 groups per batch).",
    "For each batch: run dryRun first, then wait explicit user approval, then apply in writeMode='inplace'.",
    "After each apply: create checkpoint with incremental label (e.g., over-01, over-02) and read status.",
    "Do not modify worksheet structure or insert/delete rows during OVER_ASSIGNED phase.",
    "Do not reconcile Määräluettelo yet; accumulate discrepancies for final reconciliation phase.",
  ];
  if (opts.allowMissingWithoutRows) {
    return [
      "Keep MISSING groups as explicit backlog; they do not block global progress.",
      ...base,
      "At final phase, reconcile: (a) MISSING row preparation decision, (b) Measurement Data vs Määräluettelo sync.",
    ];
  }
  if (opts.blockedMissingNoRows > 0) {
    return [
      `Prepare blocked MISSING groups first by copying an existing placeholder row with Littera Code "${CLAUDE_PLACEHOLDER_CODE}" between group header and first GUID row.`,
      "After copying placeholder rows, re-upload/reload the Excel and run diagnose again in read-only mode before any write operation.",
      ...base,
    ];
  }
  return base;
}

function buildWorkflowExecutionContract() {
  return {
    workflowOnly: true,
    mustFollowNextRecommendedAction: true,
    // Keep the assistant locked to workflow progression unless user explicitly asks otherwise.
    disallowExploratoryCallsBeforeDryRun: true,
    forbiddenBeforeDryRun: [
      "costa_diagnose_littera_excel",
      "costa_search_littera_catalog",
      "costa_search_talo_catalog",
      "costa_analyze_littera_by_ifc_type",
    ],
    requiredSequence: [
      "Pick one pending batch and max 5 groupRows.",
      "Run dryRun first.",
      "Ask explicit user approval.",
      "Apply with writeMode='inplace'.",
      "Create checkpoint and read status.",
    ],
  };
}

function buildWorkflowCompletionMessage() {
  return {
    short: {
      es: "Importa este Excel en Cost Analysis, pulsa Calculate y vuelve a exportar: Määräluettelo se regenera/sincroniza desde Measurement Data.",
      en: "Import this Excel into Cost Analysis, click Calculate, then export again: Määräluettelo is regenerated/synced from Measurement Data.",
      fi: "Tuo tämä Excel Cost Analysisiin, paina Calculate ja vie uudelleen: Määräluettelo luodaan/synkronoidaan uudelleen Measurement Datasta.",
    },
  };
}

/** In-memory cache for the full Littera dictionary (repo-local file). */
let litteraCatalogCache: any[] | null = null;

function getLitteraCatalogPath(): string {
  return path.join(REPO_ROOT, "src/data/littera.json");
}

/** Último archivo IFC cargado vía costa_load_ifc (para escritura server-side). */
let lastLoadedIfcPath: string | null = null;

const DEFAULT_MEASUREMENT_EXPORT_COLUMNS = [
  "GUID",
  "IFC Type",
  "Name",
  "Level",
  "Type Name",
  "Quantity",
  "Unit",
] as const;

type DimensionalColumnCoverage = {
  key: string;
  sampleSize: number;
  presentInSample: number;
  rate: number;
  inBaseQuantities: number;
  inExtraProperties: number;
};

type DimensionalColumnCoverageByIfcType = {
  ifcType: string;
  sampleSize: number;
  columns: DimensionalColumnCoverage[];
};

type DimensionalDualSourceRow = {
  baseQuantityKey: string;
  dimensionsKey: string;
  bothPresent: number;
  agreedClose: number;
  disagreed: number;
  nearUnitMismatchByFactor: Partial<Record<"25.4" | "304.8" | "1000" | "other", number>>;
  note: string;
};

type DimensionalQuality = {
  sample: {
    size: number;
    strategy: "explicit_ids" | "first_in_model_scope" | "stratified_by_ifctype";
    sampleExpressIds: number[];
  };
  columnCoverage: DimensionalColumnCoverage[];
  columnCoverageByIfcType: DimensionalColumnCoverageByIfcType[];
  dualSource: DimensionalDualSourceRow[];
  plausibility: {
    slabLikeVolumeOverArea: {
      elementsChecked: number;
      suspicious: number;
      note: string;
    } | null;
  };
  measurementAuditTrust?: MeasurementAuditTrustSummary;
  wallQuantityRecovery: WallQuantityRecoverySummary;
  criticalFamilyCoverage?: CriticalFamilyCoverage;
  guidanceForUser: string[];
};

type ExportPreparationRecord = {
  preparationId: string;
  createdAt: string;
  scope: { ifcTypes: string[]; ids?: number[] };
  defaultColumns: string[];
  availableColumns: string[];
  contextCheck: {
    pingOk: boolean;
    ifcTypeCount: number;
    sampleTypeCounts: Array<{ ifcType: string; count?: number }>;
  };
  measurementSources: {
    sampledElements: number;
    baseQuantitiesCoverage: number;
    extraPropertiesCoverage: number;
    detectedBaseQuantityKeys: string[];
    detectedExtraPropertyKeys: string[];
    recommendation: string;
  };
  dimensionalQuality: DimensionalQuality;
};

type ExportProvenanceRecord = {
  exportId: string;
  createdAt: string;
  ifcPath: string | null;
  ifcFingerprint: {
    filename: string | null;
    sizeBytes: number | null;
    modifiedAt: string | null;
  };
  exportRequest: {
    filename?: string;
    ifcTypes: string[];
    ids?: number[];
    selectedColumns: string[];
    extraColumns: Array<{ key: string; header: string }>;
    groupsScope?: Array<{ id: string; name: string; expressIds: number[] }>;
  };
  extraction: {
    sources: ExportPreparationRecord["measurementSources"];
    contextCheck: ExportPreparationRecord["contextCheck"];
  };
  appResult: any;
};

const exportPreparations = new Map<string, ExportPreparationRecord>();

function getProvenanceStorePath(): string {
  return path.join(REPO_ROOT, "mcp-server", ".costa-export-provenance.json");
}

function readProvenanceStore(): ExportProvenanceRecord[] {
  const filePath = getProvenanceStorePath();
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProvenanceStore(records: ExportProvenanceRecord[]) {
  const filePath = getProvenanceStorePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2), "utf8");
}

function persistProvenanceRecord(record: ExportProvenanceRecord) {
  const records = readProvenanceStore();
  records.unshift(record);
  writeProvenanceStore(records.slice(0, 300));
}

function makeExportId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readIfcFingerprint(ifcPath: string | null): ExportProvenanceRecord["ifcFingerprint"] {
  if (!ifcPath || !fs.existsSync(ifcPath)) {
    return { filename: null, sizeBytes: null, modifiedAt: null };
  }
  const s = fs.statSync(ifcPath);
  return {
    filename: path.basename(ifcPath),
    sizeBytes: s.size,
    modifiedAt: s.mtime.toISOString(),
  };
}

function extractResult(msg: any): any {
  return (msg as any)?.result ?? msg;
}

function normalizeColumnName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isDefaultMeasurementColumn(name: string): boolean {
  const n = normalizeColumnName(name);
  return DEFAULT_MEASUREMENT_EXPORT_COLUMNS.map((c) => c.toLowerCase()).includes(n);
}

function getCaseInsensitiveValue(record: Record<string, any>, wanted: string): any {
  const wantedNorm = normalizeColumnName(wanted);
  const hit = Object.keys(record).find((k) => normalizeColumnName(k) === wantedNorm);
  return hit ? record[hit] : undefined;
}

function getNestedCaseInsensitiveValue(obj: any, dottedPath: string): any {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = String(dottedPath).split(".").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;
  let cur: any = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    const keys = Object.keys(cur);
    const hit = keys.find((k) => normalizeColumnName(k) === normalizeColumnName(p));
    if (!hit) return undefined;
    cur = cur[hit];
  }
  return cur;
}

function flattenObjectPaths(obj: any, prefix = "", out = new Map<string, any>()): Map<string, any> {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const pathKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenObjectPaths(v, pathKey, out);
    } else {
      out.set(pathKey, v);
    }
  }
  return out;
}

function getElementId(el: any): number | null {
  const n = Number(el?.id ?? el?.expressId);
  return isNaN(n) ? null : n;
}

type ScalarCellValue = string | number | boolean | null;

function unwrapScalarCellValue(value: unknown): ScalarCellValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "object" && value && !Array.isArray(value)) {
    if ("value" in (value as Record<string, unknown>)) {
      return unwrapScalarCellValue((value as Record<string, unknown>).value);
    }
  }
  return undefined;
}

function normalizeExtraValuesByIdInput(
  raw: Record<string, Record<string, unknown>> | undefined
): Record<string, Record<string, ScalarCellValue>> {
  const out: Record<string, Record<string, ScalarCellValue>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, cols] of Object.entries(raw)) {
    if (!cols || typeof cols !== "object") continue;
    const row: Record<string, ScalarCellValue> = {};
    for (const [key, v] of Object.entries(cols)) {
      const scalar = unwrapScalarCellValue(v);
      if (scalar !== undefined) row[key] = scalar;
    }
    if (Object.keys(row).length > 0) out[id] = row;
  }
  return out;
}

async function resolveStoreElementIds(ifcTypes?: string[], maxResults = 200000): Promise<number[]> {
  const msg = await sendJsonToFirstClient({
    type: "costa_list_store_elements",
    ifcTypes: ifcTypes?.length ? ifcTypes : undefined,
    maxResults,
  });
  const res = extractResult(msg);
  const elements = Array.isArray(res?.elements) ? res.elements : [];
  if (elements.length > 0) {
    return Array.from(
      new Set(
        elements
          .map((e: any) => getElementId(e))
          .filter((n: number | null): n is number => n !== null)
      )
    );
  }
  return [];
}

async function resolveExportIds(ifcTypes?: string[], ids?: number[]): Promise<number[]> {
  const explicit = Array.isArray(ids) ? ids.map((n) => Number(n)).filter((n) => !isNaN(n)) : [];
  if (explicit.length > 0) return Array.from(new Set(explicit));

  const fromStore = await resolveStoreElementIds(ifcTypes);
  if (fromStore.length > 0) return fromStore;

  const elementsMsg = await sendJsonToFirstClient({ type: "costa_get_elements", maxResults: 200000 });
  const elementsRes = extractResult(elementsMsg);
  const elements = Array.isArray(elementsRes?.elements) ? elementsRes.elements : [];
  const ifcSet = new Set((ifcTypes ?? []).map((t) => normalizeColumnName(t)));
  const filtered = ifcSet.size
    ? elements.filter((e: any) => ifcSet.has(normalizeColumnName(e?.type)))
    : elements;
  return Array.from(
    new Set(
      filtered
        .map((e: any) => getElementId(e))
        .filter((n: number | null): n is number => n !== null)
    )
  );
}

const COSTA_GROUP_EXPORT_COLUMN_KEY = "CostaGroup";
const COSTA_GROUP_EXPORT_COLUMN_HEADER = "CostaBIM Group";

const COST_STORE_EMPTY_FOR_GROUPS_EXPORT =
  `${COST_STORE_EMPTY_MCP_CODE}: ${COST_STORE_EMPTY_USER_MESSAGE_EN} ` +
  `(ES: ${COST_STORE_EMPTY_USER_MESSAGE_ES}) ` +
  "Tell the user in the conversation language. Do NOT say to open/load the IFC — it is already loaded. " +
  "If the user declines Send data and still wants an export, retry with allowIfcRaw:true (IFC-only format, not the Costa bridge).";

function isBridgeNativeExportColumn(name: string): boolean {
  return (
    isDefaultMeasurementColumn(name) ||
    isBridgeIfcRawHeader(name) ||
    isBridgeDecisionHeader(name) ||
    isBridgeCostUnitHeader(name) ||
    isBridgeAuditHeader(name)
  );
}

function getBridgeAvailableColumnHeaders(): string[] {
  return [
    ...DEFAULT_MEASUREMENT_EXPORT_COLUMNS,
    ...BRIDGE_IFC_RAW_HEADERS,
    ...BRIDGE_DECISION_HEADERS,
    ...BRIDGE_COST_UNIT_COLUMNS.map((c) => c.header),
    ...getBridgeAuditColumnHeaders(),
  ];
}

function isGroupExportColumn(name: string): boolean {
  const n = normalizeColumnName(name);
  return (
    n === normalizeColumnName(COSTA_GROUP_EXPORT_COLUMN_KEY) ||
    n === normalizeColumnName(COSTA_GROUP_EXPORT_COLUMN_HEADER) ||
    n === "group" ||
    n === "grupo" ||
    n === "costabimgroup"
  );
}

function dedupeGroupExportColumn(columns: string[]): string[] {
  let grupoSeen = false;
  return columns.filter((c) => {
    if (!isGroupExportColumn(c)) return true;
    if (grupoSeen) return false;
    grupoSeen = true;
    return true;
  });
}

type CostaGroupExportRecord = {
  id: string;
  name: string;
  expressIds: number[];
};

type CostaGroupsExportScope = {
  ids: number[];
  groups: CostaGroupExportRecord[];
  extraValuesById: Record<string, Record<string, string>>;
};

async function resolveCostaGroupsExportScope(input: {
  groupId?: string;
  groupName?: string;
  exportAllGroups?: boolean;
}): Promise<CostaGroupsExportScope> {
  const listMsg = await sendJsonToFirstClient({ type: "costa_groups_list" });
  const doc = extractResult(listMsg);
  const allGroups: CostaGroupExportRecord[] = Array.isArray(doc?.groups)
    ? doc.groups.map((g: any) => ({
        id: String(g?.id ?? ""),
        name: String(g?.name ?? ""),
        expressIds: Array.isArray(g?.expressIds)
          ? g.expressIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
          : [],
      }))
    : [];

  if (!allGroups.length) {
    throw new Error(
      "No Costa named groups in localStorage (costa.namedGroups.v1). Save a group in the UI first."
    );
  }

  let selected: CostaGroupExportRecord[] = [];
  if (input.exportAllGroups === true) {
    selected = allGroups;
  } else if (input.groupId?.trim()) {
    const g = allGroups.find((x) => x.id === input.groupId!.trim());
    if (!g) throw new Error(`No Costa group with id "${input.groupId}".`);
    selected = [g];
  } else if (input.groupName?.trim()) {
    const name = input.groupName!.trim();
    const matches = allGroups.filter((x) => x.name === name);
    if (!matches.length) throw new Error(`No Costa group named "${name}".`);
    if (matches.length > 1) {
      throw new Error(`Multiple groups named "${name}" (${matches.length}). Use groupId.`);
    }
    selected = matches;
  } else {
    throw new Error("Provide groupId, groupName, or exportAllGroups:true.");
  }

  const extraValuesById: Record<string, Record<string, string>> = {};
  const ids: number[] = [];
  for (const g of selected) {
    for (const eid of g.expressIds) {
      ids.push(eid);
      const key = String(eid);
      const prev = extraValuesById[key]?.[COSTA_GROUP_EXPORT_COLUMN_KEY];
      extraValuesById[key] = {
        [COSTA_GROUP_EXPORT_COLUMN_KEY]: prev ? `${prev}; ${g.name}` : g.name,
      };
    }
  }

  const uniqueIds = Array.from(new Set(ids));
  if (!uniqueIds.length) {
    throw new Error("Selected Costa group(s) have no expressIds.");
  }

  return {
    ids: uniqueIds,
    groups: selected.map((g) => ({
      id: g.id,
      name: g.name,
      expressIds: [...g.expressIds],
    })),
    extraValuesById,
  };
}

function sanitizeExcelFilenameBase(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  return safe.slice(0, 120) || "costa-group";
}

function defaultGroupsExportFilename(scope: CostaGroupsExportScope): string {
  if (scope.groups.length === 1) {
    return `${sanitizeExcelFilenameBase(scope.groups[0].name)}.xlsx`;
  }
  return "costa-groups.xlsx";
}

async function assertCostStoreReadyForGroupsExport(opts?: {
  allowIfcRaw?: boolean;
}): Promise<{
  totalElements: number;
  storeReady: boolean;
  ifcRawOnly: boolean;
}> {
  const pingMsg = await sendJsonToFirstClient({ type: "costa_ping_store_connection" });
  const pingRes = extractResult(pingMsg);
  if (!pingRes || pingRes.ok === false) {
    throw new Error(
      "Costa WebSocket bridge is not healthy. Open the IFC project in IFCViewer (Connected in console) and retry."
    );
  }
  const totalElements = Number(pingRes.totalElements ?? 0);
  const storeReady = pingRes.storeReady === true && totalElements > 0;
  if (!storeReady) {
    if (opts?.allowIfcRaw === true) {
      return { totalElements: 0, storeReady: false, ifcRawOnly: true };
    }
    throw new Error(COST_STORE_EMPTY_FOR_GROUPS_EXPORT);
  }
  return { totalElements, storeReady: true, ifcRawOnly: false };
}

type MeasurementExcelExportInput = {
  ifcTypes?: string[];
  ids?: number[];
  filename?: string;
  preparationId?: string;
  selectedColumns?: string[];
  extraColumns?: Array<{ key: string; header?: string }>;
  extraValuesById?: Record<string, Record<string, unknown>>;
  groupsScope?: CostaGroupsExportScope;
  /** Default true: IFC raw → Published → Cost units. */
  bridgePreset?: boolean;
  /** IFC-only escape when user declined CostStore. */
  ifcRawOnly?: boolean;
};

async function executeMeasurementExcelExport(input: MeasurementExcelExportInput) {
  const {
    ifcTypes,
    ids,
    filename,
    preparationId,
    selectedColumns,
    extraColumns,
    extraValuesById,
    groupsScope,
  } = input;

  const ifcRawOnly = input.ifcRawOnly === true;
  const bridgePreset = !ifcRawOnly && input.bridgePreset !== false;

  const scopeIds = groupsScope?.ids ?? ids;
  const groupExtraCol = groupsScope
    ? [{ key: COSTA_GROUP_EXPORT_COLUMN_KEY, header: COSTA_GROUP_EXPORT_COLUMN_HEADER }]
    : [];
  const prepExtraColumns = [...groupExtraCol, ...(extraColumns ?? [])];

  const prep =
    (preparationId ? exportPreparations.get(preparationId) : undefined) ??
    (ifcRawOnly
      ? (() => {
          const synthetic: ExportPreparationRecord = {
            preparationId: makeExportId("prep"),
            createdAt: new Date().toISOString(),
            scope: { ifcTypes: ifcTypes ?? [], ids: scopeIds?.length ? scopeIds : undefined },
            defaultColumns: [...BRIDGE_IFC_RAW_HEADERS],
            availableColumns: [
              ...DEFAULT_MEASUREMENT_EXPORT_COLUMNS,
              ...BRIDGE_IFC_RAW_HEADERS,
              COSTA_GROUP_EXPORT_COLUMN_HEADER,
            ],
            contextCheck: { pingOk: true, ifcTypeCount: 0, sampleTypeCounts: [] },
            measurementSources: {
              sampledElements: 0,
              baseQuantitiesCoverage: 0,
              extraPropertiesCoverage: 0,
              detectedBaseQuantityKeys: [...BRIDGE_IFC_RAW_HEADERS],
              detectedExtraPropertyKeys: [],
              recommendation: "IFC-raw export — CostStore not used.",
            },
            dimensionalQuality: {
              sample: { size: 0, strategy: "explicit_ids", sampleExpressIds: [] },
              columnCoverage: [],
              columnCoverageByIfcType: [],
              dualSource: [],
              plausibility: { slabLikeVolumeOverArea: null },
              guidanceForUser: ["IFC-raw mode — no CostStore preflight."],
            },
          };
          exportPreparations.set(synthetic.preparationId, synthetic);
          return synthetic;
        })()
      : await buildMeasurementExportPreparation(ifcTypes, scopeIds, prepExtraColumns));
  if (!prep) {
    return {
      content: [{ type: "text", text: "❌ Invalid preparationId. Call the prepare tool again." }],
      isError: true as const,
    };
  }

  let chosenColumns = dedupeGroupExportColumn(
    (selectedColumns ?? []).map((c) => String(c ?? "").trim()).filter(Boolean)
  );
  if (groupsScope && !chosenColumns.some(isGroupExportColumn)) {
    chosenColumns = [COSTA_GROUP_EXPORT_COLUMN_HEADER, ...chosenColumns];
  }

  // Puente por defecto: no pedir menú de columnas a Claude.
  if (!chosenColumns.length || (chosenColumns.length === 1 && isGroupExportColumn(chosenColumns[0]))) {
    if (ifcRawOnly) {
      chosenColumns = dedupeGroupExportColumn([
        ...(groupsScope ? [COSTA_GROUP_EXPORT_COLUMN_HEADER] : []),
        ...BRIDGE_IFC_RAW_HEADERS,
      ]);
    } else if (bridgePreset) {
      chosenColumns = getBridgeSelectedColumnHeaders(Boolean(groupsScope));
    }
  }

  if (!chosenColumns.length) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          requiresColumnSelection: true,
          message: "Before export, present columns to the user and call again with selectedColumns.",
          preparationId: prep.preparationId,
          defaultColumns: prep.defaultColumns,
          availableColumns: prep.availableColumns,
          contextCheck: prep.contextCheck,
          measurementSources: prep.measurementSources,
          groupsScope: groupsScope
            ? {
                groupCount: groupsScope.groups.length,
                groups: groupsScope.groups.map((g) => ({ id: g.id, name: g.name, memberCount: g.expressIds.length })),
                resolvedIds: groupsScope.ids.length,
              }
            : undefined,
        }, null, 2),
      }],
      isError: true as const,
    };
  }

  const availableLower = new Set(
    [...prep.availableColumns, ...getBridgeAvailableColumnHeaders(), COSTA_GROUP_EXPORT_COLUMN_HEADER, "Group", "CostaBIM Group"].map(
      (h) => h.toLowerCase()
    )
  );
  const unknown = chosenColumns.filter((c) => !availableLower.has(c.toLowerCase()));
  if (unknown.length) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: "Unknown selectedColumns. Choose only from availableColumns.",
          unknown,
          availableColumns: prep.availableColumns,
        }, null, 2),
      }],
      isError: true as const,
    };
  }

  if (chosenColumns.some((c) => normalizeColumnName(c) === "area")) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: "Ambiguous column 'Area'. Choose an explicit source like NetArea, GrossArea, or Dimensions.Area.",
          alternatives: ["NetArea", "GrossArea", "Dimensions.Area"],
        }, null, 2),
      }],
      isError: true as const,
    };
  }

  // Panel bridge fills IFC raw / Published / Cost units — only non-native cols go as MCP extras.
  const selectedExtraColumns = chosenColumns.filter(
    (c) => isGroupExportColumn(c) || !isBridgeNativeExportColumn(c)
  );
  const targetIds = await resolveExportIds(ifcTypes, scopeIds);
  if (!targetIds.length) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: "No elements matched the requested export scope.",
        }, null, 2),
      }],
      isError: true as const,
    };
  }

  const computedExtraValuesById = await buildComputedExtraValuesById(targetIds, selectedExtraColumns);
  const mergedExtraValuesById: Record<string, Record<string, string | number | boolean | null>> = {
    ...normalizeExtraValuesByIdInput(groupsScope?.extraValuesById as Record<string, Record<string, unknown>> | undefined),
    ...normalizeExtraValuesByIdInput(extraValuesById as Record<string, Record<string, unknown>> | undefined),
  };
  for (const [id, values] of Object.entries(computedExtraValuesById)) {
    mergedExtraValuesById[id] = { ...(mergedExtraValuesById[id] ?? {}), ...values };
  }

  const requestedExtraColumns = selectedExtraColumns.map((c) => ({
    key: normalizeColumnName(c) === normalizeColumnName(COSTA_GROUP_EXPORT_COLUMN_HEADER)
      ? COSTA_GROUP_EXPORT_COLUMN_KEY
      : c,
    header: c,
  }));
  const inputExtraColumns = prepExtraColumns
    .map((c) => ({
      key: String(c?.key ?? "").trim(),
      header: String(c?.header ?? c?.key ?? "").trim(),
    }))
    .filter((c) => c.key);
  const mergedExtraColumns = Array.from(
    new Map(
      [...inputExtraColumns, ...requestedExtraColumns].map((c) => [normalizeColumnName(c.key), c])
    ).values()
  );
  const populatedStats = selectedExtraColumns.map((col) => {
    const colKey =
      normalizeColumnName(col) === normalizeColumnName(COSTA_GROUP_EXPORT_COLUMN_HEADER)
        ? COSTA_GROUP_EXPORT_COLUMN_KEY
        : col;
    const populated = Object.values(mergedExtraValuesById).filter((row) => {
      const v = row?.[colKey];
      return v !== undefined && v !== null && String(v).trim() !== "";
    }).length;
    return { column: col, populatedRows: populated, coverage: Number((populated / targetIds.length).toFixed(4)) };
  });

  const outFilename = filename ?? (groupsScope ? defaultGroupsExportFilename(groupsScope) : undefined);

  const msg = await sendJsonToFirstClient({
    type: "costa_export_measurement_excel",
    ifcTypes: ifcTypes ?? [],
    ids: scopeIds?.length ? scopeIds : targetIds,
    filename: outFilename,
    extraColumns: mergedExtraColumns,
    extraValuesById: Object.keys(mergedExtraValuesById).length ? mergedExtraValuesById : undefined,
    bridgePreset,
    ifcRawOnly,
  });
  const appResult = extractResult(msg);
  const provenanceRecord: ExportProvenanceRecord = {
    exportId: makeExportId("exp"),
    createdAt: new Date().toISOString(),
    ifcPath: lastLoadedIfcPath,
    ifcFingerprint: readIfcFingerprint(lastLoadedIfcPath),
    exportRequest: {
      filename: outFilename,
      ifcTypes: ifcTypes ?? [],
      ids: scopeIds?.length ? scopeIds : targetIds,
      selectedColumns: chosenColumns,
      extraColumns: mergedExtraColumns.map((c) => ({
        key: String(c?.key ?? ""),
        header: String(c?.header ?? c?.key ?? ""),
      })),
      groupsScope: groupsScope
        ? groupsScope.groups.map((g) => ({ id: g.id, name: g.name, expressIds: g.expressIds }))
        : undefined,
    },
    extraction: {
      sources: prep.measurementSources,
      contextCheck: prep.contextCheck,
    },
    appResult,
  };
  persistProvenanceRecord(provenanceRecord);
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: true,
        format: ifcRawOnly ? "ifc_raw" : bridgePreset ? "costa_bridge" : "custom",
        preparationId: prep.preparationId,
        selectedColumns: chosenColumns,
        selectedBaseColumns: chosenColumns.filter((c) => isDefaultMeasurementColumn(c)),
        selectedExtraColumns,
        measurementSources: prep.measurementSources,
        contextCheck: prep.contextCheck,
        resolvedScope: {
          requestedIds: scopeIds?.length ?? 0,
          resolvedIds: targetIds.length,
          ifcTypes: ifcTypes ?? [],
          groups: groupsScope?.groups.map((g) => ({
            id: g.id,
            name: g.name,
            memberCount: g.expressIds.length,
          })),
        },
        extraColumnPopulation: populatedStats,
        notes: [
          ifcRawOnly
            ? "IFC-raw format (user declined CostStore). Not the Costa bridge — no Published/Cost unit landing."
            : "Costa bridge format: IFC raw → PublishedQuantity/Unit → Cost units (JM/M2/…). Same as IFC Measurement Excel panel.",
          "File downloads in the Costa browser tab (Downloads).",
          groupsScope
            ? "Scope is Costa named groups from localStorage only (not IfcGroup from IFC)."
            : "Building/type scope via ids or ifcTypes.",
        ],
        appResult,
        provenance: {
          exportId: provenanceRecord.exportId,
          storePath: getProvenanceStorePath(),
        },
      }, null, 2),
    }],
    isError: false as const,
  };
}

const DEFAULT_INTENDED_QUANTITY_KEYS = [
  "Perimeter",
  "Length",
  "Width",
  "Height",
  "NetArea",
  "GrossArea",
  "Area",
  "NetVolume",
  "GrossVolume",
  "Volume",
] as const;

const BQ_TO_DIMENSIONS_PAIR: Array<{ bq: string; dim: string }> = [
  { bq: "Perimeter", dim: "Dimensions.Perimeter" },
  { bq: "Length", dim: "Dimensions.Length" },
  { bq: "Width", dim: "Dimensions.Width" },
  { bq: "Height", dim: "Dimensions.Height" },
  { bq: "Area", dim: "Dimensions.Area" },
  { bq: "NetArea", dim: "Dimensions.Area" },
  { bq: "GrossArea", dim: "Dimensions.Area" },
  { bq: "Volume", dim: "Dimensions.Volume" },
  { bq: "NetVolume", dim: "Dimensions.Volume" },
  { bq: "GrossVolume", dim: "Dimensions.Volume" },
];

const LINEAR_UNIT_FACTORS = [25.4, 304.8, 1000] as const;

function relErr(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) < Number.EPSILON) return Infinity;
  return Math.abs(a - b) / Math.abs(b);
}

function nearestKnownFactorKey(ratioAbs: number): "25.4" | "304.8" | "1000" | "other" | null {
  if (!Number.isFinite(ratioAbs) || ratioAbs <= 0) return null;
  for (const f of LINEAR_UNIT_FACTORS) {
    if (relErr(ratioAbs, f) <= 0.02 || relErr(ratioAbs, 1 / f) <= 0.02) {
      return String(f) as "25.4" | "304.8" | "1000";
    }
  }
  for (const f of [100, 10]) {
    if (relErr(ratioAbs, f) <= 0.02 || relErr(ratioAbs, 1 / f) <= 0.02) {
      return "other";
    }
  }
  return null;
}

function propertyNumeric(value: unknown): number | null {
  const s = unwrapScalarCellValue(value as never);
  if (s === undefined || s === null) return null;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "boolean") return null;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function bqGetNumber(bq: Record<string, any>, key: string): number | null {
  const v = getCaseInsensitiveValue(bq, key);
  return propertyNumeric(v);
}

function epGetPath(ep: Record<string, any>, path: string): number | null {
  const v = getNestedCaseInsensitiveValue(ep, path) ?? getCaseInsensitiveValue(ep, path);
  return propertyNumeric(v);
}

function hasNumericForQuantityKeyInEp(ep: Record<string, any> | undefined, key: string): boolean {
  if (!ep || typeof ep !== "object") return false;
  if (epGetPath(ep, key) !== null) return true;
  if (key.includes(".") && epGetPath(ep, key) !== null) return true;
  const base = String(key).split(/[./]/).pop() ?? key;
  if (epGetPath(ep, `Dimensions.${base}`) !== null) return true;
  const flat = flattenObjectPaths(ep);
  const target = normalizeColumnName(key);
  for (const [path, v] of flat) {
    if (normalizeColumnName(path) === target && propertyNumeric(v) !== null) return true;
    if (path.toLowerCase().endsWith(`.${target}`) && propertyNumeric(v) !== null) return true;
  }
  return false;
}

async function fetchPreflightByTypeMap(
  preflightContext: {
    storeTypes: Array<{ ifcType: string; count: number }>;
    abPolicies: AbPolicyCounts;
  }
): Promise<Map<string, number[]>> {
  const byType = new Map<string, number[]>();
  const plan = buildPreflightTypeFetchPlan(
    preflightContext.storeTypes,
    preflightContext.abPolicies
  );
  for (const req of plan) {
    const enrichMsg = await sendJsonToFirstClient({
      type: "costa_list_store_elements",
      ifcTypes: req.ifcTypes,
      maxResults: req.maxResults,
    });
    const enrichRes = extractResult(enrichMsg);
    const enrichEls = Array.isArray(enrichRes?.elements) ? enrichRes.elements : [];
    for (const e of enrichEls) {
      const id = Number(e?.id ?? e?.expressId);
      if (isNaN(id)) continue;
      const type = String(e?.type ?? "Unknown");
      const arr = byType.get(type) ?? [];
      if (!arr.includes(id)) arr.push(id);
      byType.set(type, arr);
    }
  }
  return normalizePreflightByTypeMap(byType);
}

async function resolveMeasurementSampleIds(
  ifcTypes: string[] | undefined,
  ids: number[] | undefined,
  maxSample: number,
  preflightEnabled = false,
  preflightContext?: {
    storeTypes: Array<{ ifcType: string; count: number }>;
    abPolicies: AbPolicyCounts;
  }
): Promise<{ ids: number[]; strategy: "explicit_ids" | "first_in_model_scope" | "stratified_by_ifctype" }> {
  let sampleIds = (ids ?? []).map((n) => Number(n)).filter((n) => !isNaN(n));
  let strategy: "explicit_ids" | "first_in_model_scope" | "stratified_by_ifctype" = "explicit_ids";
  if (!sampleIds.length) {
    strategy = "stratified_by_ifctype";
    let elements: any[] = [];
    let byType = new Map<string, number[]>();

    if (preflightEnabled && preflightContext && !ifcTypes?.length) {
      byType = await fetchPreflightByTypeMap(preflightContext);
    } else if (preflightEnabled && preflightContext && ifcTypes?.length) {
      const storeMsg = await sendJsonToFirstClient({
        type: "costa_list_store_elements",
        ifcTypes,
        maxResults: 5000,
      });
      const storeRes = extractResult(storeMsg);
      elements = Array.isArray(storeRes?.elements) ? storeRes.elements : [];
      for (const e of elements) {
        const id = Number(e?.id ?? e?.expressId);
        if (isNaN(id)) continue;
        const type = String(e?.type ?? "Unknown");
        const arr = byType.get(type) ?? [];
        arr.push(id);
        byType.set(type, arr);
      }
    } else {
      const storeMsg = await sendJsonToFirstClient({
        type: "costa_list_store_elements",
        ifcTypes: ifcTypes?.length ? ifcTypes : undefined,
        maxResults: 5000,
      });
      const storeRes = extractResult(storeMsg);
      if (Array.isArray(storeRes?.elements) && storeRes.elements.length > 0) {
        elements = storeRes.elements;
      } else {
        const elementsMsg = await sendJsonToFirstClient({
          type: "costa_get_elements",
          ifcType: ifcTypes?.length === 1 ? ifcTypes[0] : undefined,
          maxResults: 5000,
        });
        const elementsRes = extractResult(elementsMsg);
        elements = Array.isArray(elementsRes?.elements) ? elementsRes.elements : [];
      }
      const filtered = ifcTypes?.length
        ? elements.filter((e: any) =>
            ifcTypes.map((t) => t.toLowerCase()).includes(String(e?.type ?? "").toLowerCase())
          )
        : elements;
      for (const e of filtered) {
        const id = Number(e?.id ?? e?.expressId);
        if (isNaN(id)) continue;
        const type = String(e?.type ?? "Unknown");
        const arr = byType.get(type) ?? [];
        arr.push(id);
        byType.set(type, arr);
      }
    }

    const filtered = elements;

    if (byType.size === 0) {
      strategy = "first_in_model_scope";
      sampleIds = filtered
        .map((e: any) => Number(e?.id ?? e?.expressId))
        .filter((n: number) => !isNaN(n));
    } else if (preflightEnabled && preflightContext) {
      sampleIds = buildPreflightStratifiedSampleIds({
        byType: normalizePreflightByTypeMap(byType),
        maxSample,
        storeTypes: preflightContext.storeTypes,
        abPolicies: preflightContext.abPolicies,
      });
    } else {
      const orderedTypes = sortIfcTypesForPreflight(
        Array.from(byType.keys()),
        new Map(Array.from(byType.entries()).map(([t, ids]) => [t, ids.length])),
        preflightEnabled
      );
      const quotaBase = Math.floor(maxSample / orderedTypes.length);
      let remainder = maxSample % orderedTypes.length;
      const selected: number[] = [];
      for (const t of orderedTypes) {
        const pool = byType.get(t) ?? [];
        const quota = Math.min(pool.length, quotaBase + (remainder > 0 ? 1 : 0));
        if (remainder > 0) remainder--;
        selected.push(...pool.slice(0, quota));
      }
      if (selected.length < maxSample) {
        const selectedSet = new Set(selected);
        for (const t of orderedTypes) {
          for (const id of byType.get(t) ?? []) {
            if (selectedSet.has(id)) continue;
            selected.push(id);
            selectedSet.add(id);
            if (selected.length >= maxSample) break;
          }
          if (selected.length >= maxSample) break;
        }
      }
      sampleIds = selected;
    }
  }
  const unique = Array.from(new Set(sampleIds)).slice(0, Math.max(1, Math.min(maxSample, 80)));
  return { ids: unique, strategy };
}

function buildDimensionalQualityFromElements(
  elements: any[],
  sampleSize: number,
  strategy: "explicit_ids" | "first_in_model_scope" | "stratified_by_ifctype",
  sampleExpressIds: number[],
  keysForCoverage: string[],
  preflightEnabled: boolean,
  featureFlags?: MeasurementFeatureFlagsSnapshot
): DimensionalQuality {
  const uniqueKeys = Array.from(
    new Set(
      (keysForCoverage.length ? keysForCoverage : [...DEFAULT_INTENDED_QUANTITY_KEYS]).map((k) =>
        String(k).trim()
      )
    )
  ).filter(Boolean);

  const columnCoverage: DimensionalColumnCoverage[] = uniqueKeys.map((key) => {
    let inBq = 0;
    let inEp = 0;
    let present = 0;
    for (const el of elements) {
      const bq = (el as any)?.baseQuantities ?? {};
      const ep = (el as any)?.extraProperties ?? {};
      const hasBq = bqGetNumber(bq, key) !== null;
      const hasEp = hasNumericForQuantityKeyInEp(ep, key);
      if (hasBq) inBq++;
      if (hasEp) inEp++;
      if (hasBq || hasEp) present++;
    }
    return {
      key,
      sampleSize,
      presentInSample: present,
      rate: sampleSize > 0 ? Number((present / sampleSize).toFixed(4)) : 0,
      inBaseQuantities: inBq,
      inExtraProperties: inEp,
    };
  });

  const byType = new Map<string, any[]>();
  for (const el of elements) {
    const t = String((el as any)?.type ?? "Unknown");
    const arr = byType.get(t) ?? [];
    arr.push(el);
    byType.set(t, arr);
  }
  const columnCoverageByIfcType: DimensionalColumnCoverageByIfcType[] = Array.from(byType.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .map(([ifcType, rows]) => {
      const cols: DimensionalColumnCoverage[] = uniqueKeys.map((key) => {
        let inBq = 0;
        let inEp = 0;
        let present = 0;
        for (const el of rows) {
          const bq = (el as any)?.baseQuantities ?? {};
          const ep = (el as any)?.extraProperties ?? {};
          const hasBq = bqGetNumber(bq, key) !== null;
          const hasEp = hasNumericForQuantityKeyInEp(ep, key);
          if (hasBq) inBq++;
          if (hasEp) inEp++;
          if (hasBq || hasEp) present++;
        }
        return {
          key,
          sampleSize: rows.length,
          presentInSample: present,
          rate: rows.length > 0 ? Number((present / rows.length).toFixed(4)) : 0,
          inBaseQuantities: inBq,
          inExtraProperties: inEp,
        };
      });
      return { ifcType, sampleSize: rows.length, columns: cols };
    });

  const dualRows: DimensionalDualSourceRow[] = [];
  const seenPair = new Set<string>();
  for (const { bq, dim } of BQ_TO_DIMENSIONS_PAIR) {
    const k = `${normalizeColumnName(bq)}|${normalizeColumnName(dim)}`;
    if (seenPair.has(k)) continue;
    seenPair.add(k);

    let both = 0;
    let agreed = 0;
    let disagreed = 0;
    const near: Partial<Record<"25.4" | "304.8" | "1000" | "other", number>> = {};

    for (const el of elements) {
      const bqO = (el as any)?.baseQuantities ?? {};
      const epO = (el as any)?.extraProperties ?? {};
      const a = bqGetNumber(bqO, bq);
      const b = epGetPath(epO, dim);
      if (a === null || b === null || a <= 0 || b <= 0) continue;
      both++;
      const ratio = b / a;
      const lo = 0.8;
      const hi = 1.25;
      if (ratio >= lo && ratio <= hi) {
        agreed++;
        continue;
      }
      disagreed++;
      const fk = nearestKnownFactorKey(Math.abs(ratio));
      if (fk) {
        near[fk] = (near[fk] ?? 0) + 1;
      }
    }

    dualRows.push({
      baseQuantityKey: bq,
      dimensionsKey: dim,
      bothPresent: both,
      agreedClose: agreed,
      disagreed,
      nearUnitMismatchByFactor: near,
      note:
        both === 0
          ? "No sample elements had both values; cannot compare BQ vs Dimensions in this sample."
          : disagreed === 0
            ? "BQ and Dimensions agree within tolerance on elements where both were present."
            : "Some elements show large BQ vs Dimensions discrepancy; if ratios cluster near 25.4/304.8/1000, suspect unit/scale rather than the export pipeline.",
    });
  }

  let plaus: DimensionalQuality["plausibility"]["slabLikeVolumeOverArea"] = null;
  {
    let checked = 0;
    let suspicious = 0;
    for (const el of elements) {
      const t = String((el as any)?.type ?? "").toUpperCase();
      if (!t.includes("SLAB") && !t.includes("FOOTING")) continue;
      const bqO = (el as any)?.baseQuantities ?? {};
      const v =
        bqGetNumber(bqO, "NetVolume") ??
        bqGetNumber(bqO, "GrossVolume") ??
        bqGetNumber(bqO, "Volume");
      const a = bqGetNumber(bqO, "NetArea") ?? bqGetNumber(bqO, "GrossArea") ?? bqGetNumber(bqO, "Area");
      if (v === null || a === null || a <= 0) continue;
      checked++;
      const tProxy = v / a;
      if (tProxy < 0.0001 || tProxy > 6) suspicious++;
    }
    if (checked > 0) {
      plaus = {
        elementsChecked: checked,
        suspicious,
        note:
          "Order-of-magnitude check: for slab/footing-like types, V/A is used as a thickness proxy. Values << 1mm or >> ~6m are often unit or source issues (not a proof).",
      };
    }
  }

  const guidance: string[] = [];
  if (columnCoverage.some((c) => c.rate < 0.5)) {
    guidance.push(
      "Some intended quantity keys are missing in most of the sample: ask the user to pick alternatives (other BaseQuantity names or a Dimensions.* property) or accept gaps."
    );
  }
  if (dualRows.some((d) => d.disagreed > 0)) {
    guidance.push(
      "Where BaseQuantities and Dimensions.* disagree, prefer discussing both numbers with the user; linear mismatches often match unit factors (e.g. 304.8, 1000) after a bad conversion in one channel."
    );
  }
  if (plaus && plaus.suspicious > 0) {
    guidance.push(
      "Plausibility: some slab/footing elements have odd V/A; compare with GrossVolume/NetVolume vs geometry for those families before relying on a single field."
    );
  }

  const measurementAuditTrust = preflightEnabled
    ? summarizeMeasurementAuditTrust(elements)
    : undefined;

  const wallQuantityRecovery = summarizeWallQuantityRecovery(elements, featureFlags);
  if (wallQuantityRecovery.brickRecovered > 0) {
    guidance.push(
      `Wall brick recovery: ${wallQuantityRecovery.brickRecovered}/${wallQuantityRecovery.wallCount} walls (duplicate_horizontal=${wallQuantityRecovery.duplicateHorizontal}, horizontal_poison=${wallQuantityRecovery.horizontalPoison}). Compare Published m² with Claude/simpleBIM.`
    );
  } else if (wallQuantityRecovery.brickEligible > 0) {
    guidance.push(
      `${wallQuantityRecovery.brickEligible} walls eligible for GrossVolume brick recovery — run Send to CostStore if flags were just enabled.`
    );
  }

  if (measurementAuditTrust && measurementAuditTrust.withQuantityWarnings > 0) {
    guidance.push(
      `Audit trust: ${measurementAuditTrust.withQuantityWarnings}/${measurementAuditTrust.sampleSize} sample elements have QuantityWarnings (diagnostic only). Review Published rows with tekla_bq_length_mismatch or published_without_provenance before totals.`
    );
  }
  if (measurementAuditTrust) {
    guidance.push(
      "Preflight audit trust is advisory only (see measurementAuditTrust). Bridge Excel export stays measured quantities only — no audit columns in the default bridge file."
    );
  }

  return {
    sample: { size: sampleSize, strategy, sampleExpressIds },
    columnCoverage,
    columnCoverageByIfcType,
    dualSource: dualRows,
    plausibility: { slabLikeVolumeOverArea: plaus },
    measurementAuditTrust,
    wallQuantityRecovery,
    guidanceForUser: guidance,
  };
}

function mergeCriticalFamilyIntoDimensionalQuality(
  dimensionalQuality: DimensionalQuality,
  criticalFamilyCoverage: CriticalFamilyCoverage
): DimensionalQuality {
  const guidance = [...dimensionalQuality.guidanceForUser];
  for (const g of criticalFamilyCoverage.guidance) {
    if (!guidance.includes(g)) guidance.push(g);
  }
  return {
    ...dimensionalQuality,
    criticalFamilyCoverage,
    guidanceForUser: guidance,
  };
}

async function buildComputedExtraValuesById(
  targetIds: number[],
  selectedExtraColumns: string[]
): Promise<Record<string, Record<string, string | number | boolean | null>>> {
  // HARD GATE (2026-04-27):
  // MCP/Claude export is advisory-only. Do NOT rewrite extracted quantities
  // from quantityResolution/resolved logic in this path.
  // This function must return source values from store extraction as-is.
  const result: Record<string, Record<string, string | number | boolean | null>> = {};
  if (!targetIds.length || !selectedExtraColumns.length) return result;

  const chunkSize = 500;
  const wanted = selectedExtraColumns.map((c) => String(c).trim()).filter(Boolean);
  for (let i = 0; i < targetIds.length; i += chunkSize) {
    const chunk = targetIds.slice(i, i + chunkSize);
    const propsMsg = await sendJsonToFirstClient({ type: "costa_get_element_properties", ids: chunk });
    const propsRes = extractResult(propsMsg);
    const elements = Array.isArray(propsRes?.elements) ? propsRes.elements : [];
    for (const el of elements) {
      const id = getElementId(el);
      if (id === null) continue;
      const bq = (el as any)?.baseQuantities ?? {};
      const ep = (el as any)?.extraProperties ?? {};
      const flatExtra = flattenObjectPaths(ep);
      const row: Record<string, string | number | boolean | null> = {};

      for (const col of wanted) {
        let value = getCaseInsensitiveValue(bq, col);
        if (value === undefined) {
          value = getCaseInsensitiveValue(ep, col);
        }
        if (value === undefined) {
          value = getNestedCaseInsensitiveValue(ep, col);
        }
        if (value === undefined) {
          const hit = Array.from(flatExtra.entries()).find(
            ([k]) => normalizeColumnName(k) === normalizeColumnName(col)
          );
          value = hit?.[1];
        }
        const scalarValue = unwrapScalarCellValue(value);
        if (scalarValue !== undefined) {
          row[col] = scalarValue;
        }
      }

      if (Object.keys(row).length > 0) {
        result[String(id)] = row;
      }
    }
  }
  return result;
}

async function runMeasurementPreparationSample(
  ifcTypes?: string[],
  ids?: number[],
  options?: {
    maxSample?: number;
    intendedQuantityKeys?: string[];
    extraColumnKeys?: string[];
    preflightEnabled?: boolean;
    featureFlags?: MeasurementFeatureFlagsSnapshot;
    storeTypes?: Array<{ ifcType: string; count: number }>;
    abPolicies?: AbPolicyCounts;
  }
): Promise<{
  measurementSources: ExportPreparationRecord["measurementSources"];
  dimensionalQuality: DimensionalQuality;
  sampleElements: unknown[];
}> {
  const maxSample = Math.max(1, Math.min(Number(options?.maxSample ?? 50) || 50, 80));
  const preflightEnabled = Boolean(options?.preflightEnabled);
  const { ids: sampleIds, strategy } = await resolveMeasurementSampleIds(
    ifcTypes,
    ids,
    maxSample,
    preflightEnabled,
    preflightEnabled && options?.storeTypes && options?.abPolicies
      ? { storeTypes: options.storeTypes, abPolicies: options.abPolicies }
      : undefined
  );

  const emptyDq: DimensionalQuality = {
    sample: { size: 0, strategy, sampleExpressIds: [] },
    columnCoverage: [],
    columnCoverageByIfcType: [],
    dualSource: [],
    plausibility: { slabLikeVolumeOverArea: null },
    guidanceForUser: ["No sample elements available. Load IFC and ensure CostStore is populated, or pass explicit ids."],
  };

  if (!sampleIds.length) {
    return {
      measurementSources: {
        sampledElements: 0,
        baseQuantitiesCoverage: 0,
        extraPropertiesCoverage: 0,
        detectedBaseQuantityKeys: [],
        detectedExtraPropertyKeys: [],
        recommendation: "No sample elements available to inspect measurement sources.",
      },
      dimensionalQuality: emptyDq,
      sampleElements: [],
    };
  }

  const propsMsg = await sendJsonToFirstClient({
    type: "costa_get_element_properties",
    ids: sampleIds,
  });
  const propsRes = extractResult(propsMsg);
  const elements = Array.isArray(propsRes?.elements) ? propsRes.elements : [];

  let withBase = 0;
  let withExtra = 0;
  const baseKeys = new Set<string>();
  const extraKeys = new Set<string>();

  for (const el of elements) {
    const bq = (el as any)?.baseQuantities;
    const ep = (el as any)?.extraProperties;
    if (bq && typeof bq === "object" && Object.keys(bq).length > 0) {
      withBase += 1;
      Object.keys(bq).forEach((k) => baseKeys.add(k));
    }
    if (ep && typeof ep === "object" && Object.keys(ep).length > 0) {
      withExtra += 1;
      Object.keys(ep).forEach((k) => extraKeys.add(k));
    }
  }

  const sampleCount = elements.length || sampleIds.length;
  const baseCoverage = sampleCount > 0 ? withBase / sampleCount : 0;
  const extraCoverage = sampleCount > 0 ? withExtra / sampleCount : 0;
  const recommendation =
    baseCoverage >= extraCoverage
      ? "BaseQuantities appears to be the strongest primary source in the current sample."
      : "Extra properties appear to have broader coverage than BaseQuantities in the current sample.";

  const measurementSources: ExportPreparationRecord["measurementSources"] = {
    sampledElements: sampleCount,
    baseQuantitiesCoverage: Number(baseCoverage.toFixed(4)),
    extraPropertiesCoverage: Number(extraCoverage.toFixed(4)),
    detectedBaseQuantityKeys: Array.from(baseKeys).sort(),
    detectedExtraPropertyKeys: Array.from(extraKeys).sort(),
    recommendation,
  };

  const keyPool: string[] = [
    ...((options?.intendedQuantityKeys ?? []).map((k) => String(k).trim()).filter(Boolean)),
    ...((options?.extraColumnKeys ?? []).map((k) => String(k).trim()).filter(Boolean)),
  ];
  const keysForCoverage = keyPool.length > 0 ? keyPool : [...DEFAULT_INTENDED_QUANTITY_KEYS];

  const dimensionalQuality = buildDimensionalQualityFromElements(
    elements,
    sampleCount,
    strategy,
    sampleIds,
    keysForCoverage,
    preflightEnabled,
    options?.featureFlags
  );

  return { measurementSources, dimensionalQuality, sampleElements: elements };
}

async function buildMeasurementExportPreparation(
  ifcTypes?: string[],
  ids?: number[],
  extraColumns?: Array<{ key: string; header?: string }>,
  opts?: { sampleSize?: number; intendedQuantityKeys?: string[] }
): Promise<ExportPreparationRecord> {
  const pingMsg = await sendJsonToFirstClient({ type: "costa_ping_store_connection" });
  const pingRes = extractResult(pingMsg);
  if (!pingRes || pingRes.ok === false) {
    throw new Error("Store connection is not healthy. Open the IFC project in IFCViewer and retry.");
  }

  const typesMsg = await sendJsonToFirstClient({
    type: "costa_get_ifc_types_in_store",
    includeCounts: true,
    maxTypes: 300,
  });
  const typesRes = extractResult(typesMsg);
  const allTypes = Array.isArray(typesRes?.types) ? typesRes.types : [];
  const sampleTypeCounts = allTypes
    .slice(0, 15)
    .map((t: any) => ({ ifcType: String(t?.ifcType ?? t?.type ?? ""), count: Number(t?.count ?? 0) || undefined }))
    .filter((x: any) => x.ifcType);
  if (!allTypes.length) {
    throw new Error(COST_STORE_EMPTY_FOR_GROUPS_EXPORT);
  }

  const extraColKeys = (extraColumns ?? []).map((c) => String(c?.key ?? "").trim()).filter(Boolean);
  const storeElementCount = Number(pingRes?.totalElements ?? pingRes?.elementCount ?? 0) || 0;
  const abPolicies = (pingRes?.abPolicies ?? pingRes?.stats?.abPolicies ?? {}) as Record<string, number>;
  const featureFlags = (pingRes?.featureFlags ?? pingRes?.stats?.featureFlags ?? {}) as MeasurementFeatureFlagsSnapshot;
  const preflightEnabled = Boolean(featureFlags?.measurementPreflightV1);
  const storeTypes = allTypes.map((t: any) => ({
    ifcType: String(t?.ifcType ?? t?.type ?? ""),
    count: Number(t?.count ?? 0) || 0,
  }));

  const abPoliciesNorm: AbPolicyCounts = {
    dimSignals: Number(abPolicies.dimSignals ?? 0),
    wallFace: Number(abPolicies.wallFace ?? 0),
    hollowPreferNet: Number(abPolicies.hollowPreferNet ?? 0),
    ontelo: Number(abPolicies.ontelo ?? 0),
    bboxPoison: Number(abPolicies.bboxPoison ?? 0),
    publishedQuantity: Number(abPolicies.publishedQuantity ?? 0),
    layerHost: Number(abPolicies.layerHost ?? 0),
    layerHidden: Number(abPolicies.layerHidden ?? 0),
  };

  const { measurementSources, dimensionalQuality: dqBase, sampleElements } =
    await runMeasurementPreparationSample(ifcTypes, ids, {
      maxSample: opts?.sampleSize,
      intendedQuantityKeys: opts?.intendedQuantityKeys,
      extraColumnKeys: extraColKeys,
      preflightEnabled,
      featureFlags,
      storeTypes,
      abPolicies: abPoliciesNorm,
    });
  let dimensionalQuality = dqBase;

  const criticalFamilyCoverage = buildCriticalFamilyCoverage({
    storeElementCount,
    storeTypes,
    abPolicies: abPoliciesNorm,
    sampleElements,
    preflightEnabled,
  });
  dimensionalQuality = mergeCriticalFamilyIntoDimensionalQuality(dimensionalQuality, criticalFamilyCoverage);
  const extraHeaders = (extraColumns ?? []).map((c) => String(c?.header ?? c?.key ?? "").trim()).filter(Boolean);
  const availableColumns = Array.from(
    new Set([
      ...getBridgeAvailableColumnHeaders(),
      ...measurementSources.detectedBaseQuantityKeys,
      ...measurementSources.detectedExtraPropertyKeys,
      ...extraHeaders,
    ])
  );

  const preparation: ExportPreparationRecord = {
    preparationId: makeExportId("prep"),
    createdAt: new Date().toISOString(),
    scope: { ifcTypes: ifcTypes ?? [], ids: ids?.length ? ids : undefined },
    defaultColumns: getBridgeSelectedColumnHeaders(false),
    availableColumns,
    contextCheck: {
      pingOk: true,
      ifcTypeCount: allTypes.length,
      sampleTypeCounts,
    },
    measurementSources,
    dimensionalQuality,
  };
  exportPreparations.set(preparation.preparationId, preparation);
  return preparation;
}

// --- Constantes IFC (web-ifc 0.0.66) ---
const IFC_CLASSIFICATION               = 747523909;
const IFC_CLASSIFICATION_REFERENCE     = 647927063;
const IFC_REL_ASSOCIATES_CLASSIFICATION = 919958153;
const IFC_PROPERTY_SET                 = 1451395588;
const IFC_PROPERTY_SINGLE_VALUE        = 3650150729;
const IFC_REL_DEFINES_BY_PROPERTIES    = 4186316022;
const IFC_WALL                         = 2391406946;
const IFC_WALLSTANDARDCASE             = 3512223829;

const COSTA_ASSEMBLY_PSET = "Pset_CostaAssembly";

function ifcLabel(v: string) {
  return { type: 1, value: String(v ?? ""), name: "IFCLABEL" };
}
function ifcIdentifier(v: string) {
  return { type: 1, value: String(v ?? ""), name: "IFCIDENTIFIER" };
}
function ifcGuid(v: string) {
  return { type: 1, value: String(v ?? ""), name: "IFCGLOBALLYUNIQUEID" };
}
function ifcMakeGuid(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let g = "";
  for (let i = 0; i < 22; i++) g += chars[Math.floor(Math.random() * chars.length)];
  return g;
}

type AssemblyWriteRecipe = {
  confirmed: boolean;
  assemblyKey?: string;
  hostNames?: string[];
  layerNames?: string[];
  otherNames?: string[];
};

function ifcNameString(line: { Name?: { value?: unknown } | string } | null | undefined): string {
  const n = line?.Name;
  if (typeof n === "string") return n;
  if (n && typeof n === "object" && "value" in n) return String((n as { value?: unknown }).value ?? "");
  return "";
}

function psetNameOf(api: IfcAPI, modelID: number, psetId: number): string {
  try {
    const pset = api.GetLine(modelID, psetId, false);
    return ifcNameString(pset);
  } catch {
    return "";
  }
}

function entityId(entity: { expressID?: number } | number | null | undefined): number {
  if (typeof entity === "number" && Number.isFinite(entity) && entity > 0) return entity;
  const id = Number((entity as { expressID?: number } | null)?.expressID);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`CreateIfcEntity returned no expressID (${typeof entity})`);
  }
  return id;
}

function wallsAlreadyWithCostaAssembly(api: IfcAPI, modelID: number): Set<number> {
  const stamped = new Set<number>();
  try {
    const rels = api.GetLineIDsWithType(modelID, IFC_REL_DEFINES_BY_PROPERTIES);
    const n = rels.size();
    for (let i = 0; i < n; i++) {
      try {
        const rel = api.GetLine(modelID, rels.get(i), false);
        const psetId = Number(rel?.RelatingPropertyDefinition?.value);
        if (!psetId || psetNameOf(api, modelID, psetId) !== COSTA_ASSEMBLY_PSET) continue;
        const related = ([] as Array<{ value?: number } | number>).concat(rel?.RelatedObjects ?? []);
        for (const obj of related) {
          const id = typeof obj === "number" ? obj : Number(obj?.value);
          if (Number.isFinite(id)) stamped.add(id);
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* type may be absent */
  }
  return stamped;
}

function writeCostaAssemblyPset(
  api: IfcAPI,
  modelID: number,
  expressId: number,
  role: string,
  assemblyKey: string,
  contributeToMaara: 0 | 1
): void {
  const makeProp = (name: string, val: string) => {
    const p = api.CreateIfcEntity(
      modelID,
      IFC_PROPERTY_SINGLE_VALUE,
      ifcIdentifier(name),
      null,
      ifcLabel(val),
      null
    );
    api.WriteLine(modelID, p);
    return p;
  };
  const pRole = makeProp("LayerRole", String(role));
  const pKey = makeProp("AssemblyKey", String(assemblyKey));
  const pMaara = makeProp("ContributeToMaara", String(contributeToMaara));
  const props = [
    { type: 5, value: entityId(pRole) },
    { type: 5, value: entityId(pKey) },
    { type: 5, value: entityId(pMaara) },
  ];
  const pset = api.CreateIfcEntity(
    modelID,
    IFC_PROPERTY_SET,
    ifcGuid(ifcMakeGuid()),
    null,
    ifcLabel(COSTA_ASSEMBLY_PSET),
    null,
    props
  );
  api.WriteLine(modelID, pset);
  const relPset = api.CreateIfcEntity(
    modelID,
    IFC_REL_DEFINES_BY_PROPERTIES,
    ifcGuid(ifcMakeGuid()),
    null,
    null,
    null,
    [{ type: 5, value: Number(expressId) }],
    { type: 5, value: entityId(pset) }
  );
  api.WriteLine(modelID, relPset);
}

function stampAssemblyOnWalls(
  api: IfcAPI,
  modelID: number,
  recipe: AssemblyWriteRecipe
): { stamped: number; skipped: number } {
  const asNames = (arr?: string[]) =>
    (arr ?? []).map((n) => String(n ?? "").trim()).filter(Boolean);
  const hostNames = asNames(recipe.hostNames).length ? asNames(recipe.hostNames) : [...DEFAULT_HOST_NAMES];
  const layerNames = asNames(recipe.layerNames).length ? asNames(recipe.layerNames) : [...DEFAULT_LAYER_NAMES];
  const otherNames = asNames(recipe.otherNames).length ? asNames(recipe.otherNames) : [...DEFAULT_OTHER_WALL_NAMES];
  const assemblyKey = String(recipe.assemblyKey || FACADE_ASSEMBLY_KEY);
  const already = wallsAlreadyWithCostaAssembly(api, modelID);
  let stamped = 0;
  let skipped = 0;
  for (const typeId of [IFC_WALL, IFC_WALLSTANDARDCASE]) {
    let ids: { size: () => number; get: (i: number) => number };
    try {
      ids = api.GetLineIDsWithType(modelID, typeId);
    } catch {
      continue;
    }
    const n = ids.size();
    for (let i = 0; i < n; i++) {
      const expressId = Number(ids.get(i));
      if (!Number.isFinite(expressId)) continue;
      if (already.has(expressId)) {
        skipped++;
        continue;
      }
      let name = "";
      try {
        const ln = api.GetLine(modelID, expressId, false);
        name = ifcNameString(ln);
      } catch {
        continue;
      }
      const role = resolveLayerRole(name, "IfcWall", hostNames, layerNames, otherNames);
      try {
        writeCostaAssemblyPset(
          api,
          modelID,
          expressId,
          role,
          assemblyKey,
          role === "layer" ? 0 : 1
        );
        already.add(expressId);
        stamped++;
      } catch (err) {
        logStderr(
          `[IFC Write] Pset_CostaAssembly skip wall ${expressId} (${name}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
  }
  return { stamped, skipped };
}

/**
 * Escribe clasificaciones TALO y/o Littera en un IFC y retorna el buffer del IFC modificado.
 * Corre en Node.js (MCP server) — no depende del browser ni del webIfc del viewer.
 */
async function writeIfcClassificationsServerSide(
  inputPath: string,
  elements: Array<{
    expressId?: number;
    globalId?: string;
    taloCode?: string;
    taloName?: string;
    litteraCode?: string;
    litteraName?: string;
    litteraCategory?: string;
    layerRole?: string;
  }>,
  assembly?: AssemblyWriteRecipe | null
): Promise<{
  written: number;
  failed: number;
  errors: Array<{ id?: number; globalId?: string; error: string }>;
  outputBuffer: Uint8Array;
  assemblyStamped: number;
  assemblySkipped: number;
  assemblyError?: string;
}> {
  const wasmDir = path.join(REPO_ROOT, "node_modules/web-ifc/");
  const api = new IfcAPI();
  api.SetWasmPath(wasmDir, true); // true = path is absolute, prevents path duplication
  await api.Init();

  const fileData = fs.readFileSync(inputPath);
  const uint8 = new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength);
  const modelID = api.OpenModel(uint8, { COORDINATE_TO_ORIGIN: false });

  // Resolver GlobalId → expressId
  const globalIdMap = new Map<string, number>();
  try {
    const lines = api.GetAllLines(modelID);
    const count = lines.size();
    for (let i = 0; i < count; i++) {
      const eid = lines.get(i);
      try {
        const ln = api.GetLine(modelID, eid, false);
        if (ln?.GlobalId?.value) globalIdMap.set(String(ln.GlobalId.value), Number(eid));
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  // Buscar IfcClassification TALO existente
  let taloClassId: number | null = null;
  try {
    const classLines = api.GetLineIDsWithType(modelID, IFC_CLASSIFICATION);
    const classCount = classLines.size();
    for (let i = 0; i < classCount; i++) {
      const eid = classLines.get(i);
      try {
        const ln = api.GetLine(modelID, eid, false);
        if (String(ln?.Name?.value ?? "").toUpperCase().includes("TALO")) {
          taloClassId = Number(eid);
          break;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  const written: Array<{ id?: number; globalId?: string; talo?: string; littera?: string }> = [];
  const errors: Array<{ id?: number; globalId?: string; error: string }> = [];

  for (const el of elements) {
    let expressId: number | undefined =
      el.expressId != null && !isNaN(Number(el.expressId)) ? Number(el.expressId) : undefined;
    if (!expressId && el.globalId) expressId = globalIdMap.get(el.globalId);
    if (!expressId) {
      errors.push({ id: el.expressId, globalId: el.globalId, error: "Element not found in IFC." });
      continue;
    }

    try {
      const skipTalo = String(el.layerRole ?? "").toLowerCase() === "layer";
      if (el.taloCode && !skipTalo) {
        if (!taloClassId) {
          const classEntity = api.CreateIfcEntity(
            modelID, IFC_CLASSIFICATION,
            null, null, null,
            ifcLabel("TALO 2000 Hankenimikkeistö"),
            null, null, null
          );
          api.WriteLine(modelID, classEntity);
          taloClassId = classEntity.expressID;
        }
        const refEntity = api.CreateIfcEntity(
          modelID, IFC_CLASSIFICATION_REFERENCE,
          null,
          ifcIdentifier(String(el.taloCode)),
          el.taloName ? ifcLabel(String(el.taloName)) : null,
          { type: 5, value: taloClassId },
          null, null
        );
        api.WriteLine(modelID, refEntity);

        const relClass = api.CreateIfcEntity(
          modelID, IFC_REL_ASSOCIATES_CLASSIFICATION,
          ifcGuid(ifcMakeGuid()), null, null, null,
          [{ type: 5, value: expressId }],
          { type: 5, value: refEntity.expressID }
        );
        api.WriteLine(modelID, relClass);
      }

      if (el.litteraCode) {
        const props: any[] = [];
        const makeProp = (name: string, val: string) =>
          api.CreateIfcEntity(modelID, IFC_PROPERTY_SINGLE_VALUE,
            ifcIdentifier(name), null, ifcLabel(val), null);
        const p1 = makeProp("COSTA LITTERA", el.litteraCode);
        api.WriteLine(modelID, p1);
        props.push({ type: 5, value: p1.expressID });
        if (el.litteraName) {
          const p2 = makeProp("COSTA LITTERA NAME", el.litteraName);
          api.WriteLine(modelID, p2);
          props.push({ type: 5, value: p2.expressID });
        }
        if (el.litteraCategory) {
          const p3 = makeProp("COSTA LITTERA CATEGORY", el.litteraCategory);
          api.WriteLine(modelID, p3);
          props.push({ type: 5, value: p3.expressID });
        }
        const pset = api.CreateIfcEntity(modelID, IFC_PROPERTY_SET,
          ifcGuid(ifcMakeGuid()), null, ifcLabel("Pset_CostaClassification"), null, props);
        api.WriteLine(modelID, pset);
        const relPset = api.CreateIfcEntity(modelID, IFC_REL_DEFINES_BY_PROPERTIES,
          ifcGuid(ifcMakeGuid()), null, null, null,
          [{ type: 5, value: expressId }],
          { type: 5, value: pset.expressID });
        api.WriteLine(modelID, relPset);
      }

      written.push({ id: expressId, globalId: el.globalId, talo: el.taloCode, littera: el.litteraCode });
    } catch (err) {
      errors.push({
        id: expressId,
        globalId: el.globalId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let assemblyStamped = 0;
  let assemblySkipped = 0;
  let assemblyError: string | undefined;
  if (assembly?.confirmed) {
    try {
      const stamped = stampAssemblyOnWalls(api, modelID, assembly);
      assemblyStamped = stamped.stamped;
      assemblySkipped = stamped.skipped;
    } catch (err) {
      assemblyError = err instanceof Error ? err.message : String(err);
      logStderr(`[IFC Write] Pset_CostaAssembly aborted: ${assemblyError}`);
      errors.push({ error: `assembly stamp aborted: ${assemblyError}` });
    }
  }

  const outputBuffer = api.SaveModel(modelID);
  api.CloseModel(modelID);

  return {
    written: written.length,
    failed: errors.length,
    errors,
    outputBuffer,
    assemblyStamped,
    assemblySkipped,
    assemblyError,
  };
}

/** In-memory cache for the Talo 2000 classification catalog. */
let taloCatalogCache: any[] | null = null;

function getTaloCatalogPath(): string {
  return path.join(REPO_ROOT, "src/data/talo2000.json");
}

function loadTaloCatalog(): any[] {
  if (taloCatalogCache) return taloCatalogCache;
  const p = getTaloCatalogPath();
  if (!fs.existsSync(p)) throw new Error(`talo2000.json not found at ${p}`);
  const raw = fs.readFileSync(p, "utf-8");
  const data = JSON.parse(raw) as unknown;
  taloCatalogCache = Array.isArray(data) ? data : [];
  return taloCatalogCache;
}

function searchTaloCatalog(opts: {
  query?: string;
  codePrefix?: string;
  codes?: string[];
  maxResults: number;
}): { matches: any[]; totalCatalogEntries: number; truncated: boolean; catalogPath: string } {
  const all = loadTaloCatalog();
  const maxResults = Math.min(Math.max(1, opts.maxResults), 500);

  if (opts.codes && opts.codes.length > 0) {
    const set = new Set(opts.codes.map((c) => String(c ?? "").trim()).filter(Boolean));
    const matches = all.filter((e) => set.has(String(e?.code ?? "").trim())).slice(0, maxResults);
    return { matches, totalCatalogEntries: all.length, truncated: false, catalogPath: getTaloCatalogPath() };
  }

  let rows = all;
  if (opts.codePrefix) {
    const pref = String(opts.codePrefix).trim();
    rows = rows.filter((e) => String(e?.code ?? "").startsWith(pref));
  }
  if (opts.query && opts.query.trim()) {
    const tokens = opts.query.toLowerCase().split(/\s+/).filter(Boolean);
    rows = rows.filter((e) => {
      const hay = [String(e?.code ?? ""), String(e?.name ?? "")].join(" ").toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  const truncated = rows.length > maxResults;
  return {
    matches: rows.slice(0, maxResults),
    totalCatalogEntries: all.length,
    truncated,
    catalogPath: getTaloCatalogPath(),
  };
}

function loadLitteraCatalog(): any[] {
  if (litteraCatalogCache) return litteraCatalogCache;
  const p = getLitteraCatalogPath();
  if (!fs.existsSync(p)) {
    throw new Error(`littera.json not found at ${p}`);
  }
  const raw = fs.readFileSync(p, "utf-8");
  const data = JSON.parse(raw) as unknown;
  litteraCatalogCache = Array.isArray(data) ? data : [];
  return litteraCatalogCache;
}

function searchLitteraCatalog(opts: {
  query?: string;
  codePrefix?: string;
  codes?: string[];
  categoryContains?: string;
  maxResults: number;
}): { matches: any[]; totalCatalogEntries: number; truncated: boolean; catalogPath: string } {
  const all = loadLitteraCatalog();
  const maxResults = Math.min(Math.max(1, opts.maxResults), 500);

  if (opts.codes && opts.codes.length > 0) {
    const set = new Set(opts.codes.map((c) => String(c ?? "").trim()).filter(Boolean));
    const matches = all.filter((e) => set.has(String(e?.littera ?? "").trim())).slice(0, maxResults);
    return {
      matches,
      totalCatalogEntries: all.length,
      truncated: matches.length >= maxResults,
      catalogPath: getLitteraCatalogPath(),
    };
  }

  let rows = all;
  if (opts.codePrefix) {
    const pref = String(opts.codePrefix).trim();
    rows = rows.filter((e) => String(e?.littera ?? "").startsWith(pref));
  }
  if (opts.categoryContains) {
    const cc = opts.categoryContains.toLowerCase();
    rows = rows.filter((e) => String(e?.category ?? "").toLowerCase().includes(cc));
  }
  if (opts.query && opts.query.trim()) {
    const tokens = opts.query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    rows = rows.filter((e) => {
      const hay = [
        String(e?.littera ?? ""),
        String(e?.description ?? ""),
        Array.isArray(e?.keywords) ? e.keywords.join(" ") : "",
        String(e?.category ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }

  const truncated = rows.length > maxResults;
  return {
    matches: rows.slice(0, maxResults),
    totalCatalogEntries: all.length,
    truncated,
    catalogPath: getLitteraCatalogPath(),
  };
}

server.registerTool(
  "costa_load_ifc",
  {
    title: "Costa: Load IFC File",
    description:
      "Registers an IFC file path for server-side operations (costa_write_ifc_classifications). Pass noViewer:true to only register the path without reloading the model in the browser — use this when the IFC is already visible in IFCViewer and you don't want to disrupt the user's session. Pass noViewer:false (default) to also send the raw bytes to the COSTA app and reload the model in the viewer.",
    inputSchema: z.object({
      path: z.string().describe("Full path of the IFC file (e.g. /Volumes/Disk/model.ifc)"),
      noViewer: z
        .boolean()
        .optional()
        .describe("If true, only register the path server-side — do NOT reload the model in the browser viewer. Use when the IFC is already loaded in IFCViewer. Default: false."),
    }),
  },
  async ({ path: filePath, noViewer }) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath);
      if (!fs.existsSync(fullPath)) {
        return {
          content: [{ type: "text" as const, text: `❌ File not found: ${fullPath}` }],
          isError: true,
        };
      }

      lastLoadedIfcPath = fullPath;

      if (noViewer) {
        return {
          content: [{ type: "text", text: `✅ IFC path registered (server-side only, viewer untouched): ${fullPath}` }],
        };
      }

      const file = fs.readFileSync(fullPath);

      if (!ws) {
        return {
          content: [{ type: "text" as const, text: "❌ Costa MCP WebSocket server is not running." }],
          isError: true,
        };
      }

      let clientCount = 0;
      const filename = path.basename(fullPath);
      ws.clients.forEach((client: { readyState: number; send: (d: any) => void }) => {
        if (client.readyState === 1) {
          client.send(JSON.stringify({ type: "costa_load_ifc:filename", filename, sourcePath: fullPath }));
          client.send(file as Buffer);
          clientCount++;
        }
      });

      return {
        content: [{ type: "text", text: `✅ IFC file sent to ${clientCount} client(s): ${fullPath}` }],
      };
    } catch (error) {
      return {
        content: [
          { type: "text", text: `❌ Error loading IFC file: ${error instanceof Error ? error.message : "Unknown error"}` },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_get_elements",
  {
    title: "Costa: Get Elements",
    description:
      "Returns elements from the IFC currently loaded in the 3D viewer (fragmentModel: id/expressId, globalId, name, type). Does NOT read CostPage. If the model is visible and this returns 0, retry after a few seconds or use costa_filter_and_select_elements. Filters: IFC type, name substring, globalId.",
    inputSchema: z.object({
      ifcType: z.string().optional().describe("Exact IFC type, e.g. IfcDoor"),
      nameContains: z.string().optional().describe("Case-insensitive substring match for element name"),
      globalId: z.string().optional().describe("Exact IFC GlobalId"),
      maxResults: z.number().optional().describe("Safety limit for the amount of returned elements"),
    }),
  },
  async ({ ifcType, nameContains, globalId, maxResults }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_get_elements",
        ifcType,
        nameContains,
        globalId,
        maxResults,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error getting elements from Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_get_ifc_types_in_store",
  {
    title: "Costa: Get IFC Types in CostPage Store",
    description:
      "Returns the distinct IFC element types (the `type` field from CostPage elements) present in the active CostPage store, without requiring IFCViewer. **When the user asks for Littera / cost-code improvement (with or without an Excel path), call this immediately after costa_ping_store_connection succeeds** and show the user the full list with counts (table or bullets). That proves the session is tied to the whole loaded model, not a single type. Then ask which IFC type to analyze first (e.g. IfcDoor) or offer to proceed type-by-type in descending count order.",
    inputSchema: z.object({
      includeCounts: z
        .boolean()
        .optional()
        .describe("If true, returns a frequency count per type. Default: true."),
      maxTypes: z
        .number()
        .optional()
        .describe("Limit the number of returned types (by frequency). Default: 200."),
    }),
  },
  async ({ includeCounts, maxTypes }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_get_ifc_types_in_store",
        includeCounts,
        maxTypes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error getting IFC types from Costa CostPage store: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_ping_store_connection",
  {
    title: "Costa: Ping Store Connection",
    description:
      "Checks if Costa app WebSocket/store bridge is alive and returns basic store stats. Use before long-running review sessions. On success, if the task is broad Littera improvement, the next step should normally be costa_get_ifc_types_in_store so the user sees every IFC type in the current store before deep-diving one type.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_ping_store_connection",
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error pinging Costa store connection: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_list_review_checkpoints",
  {
    title: "Costa: List Review Checkpoints",
    description:
      "Lists saved review checkpoints from CostPage localStorage so Claude can resume without guessing sessionId.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_list_review_checkpoints",
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error listing review checkpoints from Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_save_review_checkpoint",
  {
    title: "Costa: Save Review Checkpoint",
    description:
      "Stores review progress in CostPage client localStorage, so a future Claude conversation can resume without relying on chat memory.",
    inputSchema: z.object({
      sessionId: z.string().describe("Stable session key, e.g. project-abc-ifcdoor-2026-03-25"),
      checkpoint: z
        .record(z.any())
        .describe("Arbitrary JSON payload: rules, ifcType, previousStats, truncated, nextBatchHints, etc."),
    }),
  },
  async ({ sessionId, checkpoint }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_save_review_checkpoint",
        sessionId,
        checkpoint,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error saving review checkpoint in Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_get_review_checkpoint",
  {
    title: "Costa: Get Review Checkpoint",
    description:
      "Loads a previously saved review checkpoint from CostPage client localStorage and returns a ready-to-paste resumeInstruction.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session key previously used in costa_save_review_checkpoint"),
    }),
  },
  async ({ sessionId }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_get_review_checkpoint",
        sessionId,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error loading review checkpoint from Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_manage_littera_workflow",
  {
    title: "Costa: Manage Littera Workflow",
    description:
      "Orchestrates progressive Littera review sessions with persisted workflow state, blocked-MISSING detection, and progressive Excel checkpoints. " +
      "Use this to regulate long sessions, resume later, and keep users aware when MISSING groups cannot be filled in-place due to missing Littera rows.",
    inputSchema: z.object({
      action: z.enum(["diagnose", "plan", "prepare_missing", "status", "resume", "checkpoint", "record_decision"]),
      sessionId: z.string().optional().describe("Stable workflow session id. If missing on diagnose, a new id is generated."),
      excelPath: z.string().optional().describe("Excel path required for diagnose/checkpoint actions."),
      overAssignedThreshold: z.number().int().min(1).optional().describe("Threshold for OVER_ASSIGNED detection (default 8)."),
      allowMissingWithoutRows: z.boolean().optional().describe("If true, workflow continues even when MISSING groups have zero Littera rows."),
      label: z.string().optional().describe("Optional checkpoint label."),
      decisionNote: z.string().optional().describe("Decision/note to append to workflow history."),
    }),
  },
  async ({ action, sessionId, excelPath, overAssignedThreshold, allowMissingWithoutRows, label, decisionNote }) => {
    try {
      const now = new Date().toISOString();
      let sid = sanitizeSessionId(sessionId ?? "");
      if (!sessionId && action !== "diagnose") {
        return {
          content: [{ type: "text", text: "❌ sessionId is required for this action (except diagnose)." }],
          isError: true,
        };
      }

      const existing = readWorkflowState(sid);
      const baseState: WorkflowState = existing ?? {
        sessionId: sid,
        createdAt: now,
        updatedAt: now,
        excelPath,
        allowMissingWithoutRows: allowMissingWithoutRows ?? false,
        checkpoints: [],
        decisions: [],
        currentPhase: "diagnose",
      };

      if (allowMissingWithoutRows !== undefined) baseState.allowMissingWithoutRows = allowMissingWithoutRows;
      if (excelPath) baseState.excelPath = excelPath;

      const buildUserGuidance = (
        missingNeedingPlaceholderCount: number,
        nextAction: "prepare_missing" | "plan" | "execute"
      ) => {
        if (missingNeedingPlaceholderCount > 0 && !baseState.allowMissingWithoutRows) {
          return {
            manualRowCopyRequired: true,
            userReloadRequired: true,
            phase: "prepare_missing",
            userInstruction:
              `Copy placeholder rows with Littera Code "${CLAUDE_PLACEHOLDER_CODE}" as instructed for each pending MISSING group, then reload Excel and run action='diagnose' again before any write.`,
          };
        }
        return {
          manualRowCopyRequired: false,
          userReloadRequired: false,
          phase: nextAction,
          userInstruction: "No manual row copy is required now. Continue with workflow plan/batches.",
        };
      };

      if (action === "diagnose") {
        if (!excelPath && !baseState.excelPath) {
          return { content: [{ type: "text", text: "❌ excelPath is required for diagnose." }], isError: true };
        }
        if (!sessionId) sid = sanitizeSessionId(`wf-${Date.now()}`);
        const diagnosis = runWorkflowDiagnosis(excelPath ?? baseState.excelPath!, overAssignedThreshold ?? 8);
        const blocked = diagnosis.blockedMissingNoRows.length;
        const missingCount = diagnosis.summary.missing;
        const missingNeedingPlaceholder = diagnosis.missingGroupsNeedingPlaceholder ?? [];
        const missingNeedingPlaceholderCount = missingNeedingPlaceholder.length;
        const placeholderCopiesByGroup = missingNeedingPlaceholder.map((m) => ({
          groupRow: m.groupRow,
          name: m.name,
          taloCode: m.taloCode,
          copiesRequired: m.recommendedPlaceholderCopies,
          sampleGuid: m.sampleGuids[0] ?? "",
        }));
        const totalPlaceholderCopiesRequired = placeholderCopiesByGroup.reduce(
          (sum, g) => sum + Math.max(0, Number(g.copiesRequired ?? 0)),
          0
        );
        const next = missingNeedingPlaceholderCount > 0 && !baseState.allowMissingWithoutRows ? "prepare_missing" : "plan";
        const state: WorkflowState = {
          ...baseState,
          sessionId: sid,
          updatedAt: now,
          diagnosis,
          currentPhase: next === "prepare_missing" ? "diagnose" : "plan",
        };
        writeWorkflowState(state);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              sessionId: sid,
              action,
              diagnosis,
              workflow: {
                allowMissingWithoutRows: state.allowMissingWithoutRows,
                blockedMissingNoRows: blocked,
                missingGroupsCount: missingCount,
                missingGroupsNeedingPlaceholderCount: missingNeedingPlaceholderCount,
                nextRecommendedAction: next,
                userGuidance: buildUserGuidance(missingNeedingPlaceholderCount, next),
                executionContract: buildWorkflowExecutionContract(),
                completionMessage: buildWorkflowCompletionMessage(),
                mandatoryReadOnlyStep:
                  missingNeedingPlaceholderCount > 0 && !state.allowMissingWithoutRows
                    ? {
                        required: true,
                        message:
                          `Before any write, ask user to copy placeholder rows with Littera Code "${CLAUDE_PLACEHOLDER_CODE}" in each pending MISSING group and re-run read-only diagnose.`,
                        placeholderCode: CLAUDE_PLACEHOLDER_CODE,
                        totalPlaceholderCopiesRequired,
                        byGroup: placeholderCopiesByGroup,
                      }
                    : {
                        required: false,
                      },
                playbook: buildWorkflowPlaybook({
                  allowMissingWithoutRows: state.allowMissingWithoutRows,
                  blockedMissingNoRows: blocked,
                  overAssignedCount: diagnosis.summary.overAssigned,
                }),
              },
            }, null, 2),
          }],
        };
      }

      if (!existing) {
        return { content: [{ type: "text", text: `❌ sessionId not found: ${sid}. Run action='diagnose' first.` }], isError: true };
      }

      if (action === "status" || action === "resume") {
        const blocked = existing.diagnosis?.blockedMissingNoRows?.length ?? 0;
        const missingCount = existing.diagnosis?.summary?.missing ?? 0;
        const missingNeedingPlaceholderCount = existing.diagnosis?.missingGroupsNeedingPlaceholder?.length ?? 0;
        const nextRecommendedAction =
          missingNeedingPlaceholderCount > 0 && !existing.allowMissingWithoutRows
            ? "prepare_missing"
            : "plan";
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              sessionId: sid,
              action,
              state: existing,
              nextRecommendedAction,
              executionContract: buildWorkflowExecutionContract(),
              completionMessage: buildWorkflowCompletionMessage(),
              userGuidance:
                missingNeedingPlaceholderCount > 0 && !existing.allowMissingWithoutRows
                  ? {
                      manualRowCopyRequired: true,
                      userReloadRequired: true,
                      phase: "prepare_missing",
                      userInstruction:
                        `Run action='prepare_missing' now. Then copy placeholder rows with Littera Code "${CLAUDE_PLACEHOLDER_CODE}" exactly as instructed for each pending MISSING group, reload Excel, and run action='diagnose' again before any write.`,
                    }
                  : {
                      manualRowCopyRequired: false,
                      userReloadRequired: false,
                      phase: nextRecommendedAction,
                      userInstruction: "No manual row copy is required now. Continue with action='plan'.",
                    },
              playbook: buildWorkflowPlaybook({
                allowMissingWithoutRows: existing.allowMissingWithoutRows,
                blockedMissingNoRows: blocked,
                overAssignedCount: existing.diagnosis?.summary?.overAssigned,
              }),
            }, null, 2),
          }],
        };
      }

      if (action === "prepare_missing") {
        const diagnosis = existing.diagnosis;
        if (!diagnosis) {
          return { content: [{ type: "text", text: "❌ No diagnosis in session. Run action='diagnose' first." }], isError: true };
        }
        const missingGroups = diagnosis.missingGroupsNeedingPlaceholder ?? [];
        const instructions = missingGroups
          .slice()
          .sort((a, b) => a.groupRow - b.groupRow)
          .map((m, index) => {
            const expectedShiftBeforeThisGroup = index;
            const expectedCurrentGroupRow = m.groupRow + expectedShiftBeforeThisGroup;
            return {
              groupRow: m.groupRow,
              // Row references drift after each manual insert. Keep a stable anchor and an estimated shifted row.
              groupRowAnchor: m.groupRow,
              expectedShiftBeforeThisGroup,
              expectedCurrentGroupRow,
              rowDisplayHint: index === 0 ? String(m.groupRow) : "-",
              name: m.name,
              taloCode: m.taloCode,
              sampleGuid: m.sampleGuids[0] ?? "",
              copiesRequired: m.recommendedPlaceholderCopies,
              placeholderCode: CLAUDE_PLACEHOLDER_CODE,
              instruction:
                `Copy a row with Littera Code "${CLAUDE_PLACEHOLDER_CODE}" ${m.recommendedPlaceholderCopies} time(s) in this group before the first GUID row. ` +
                `Use name+taloCode as the primary anchor; row numbers may shift after each insert.`,
            };
          });
        const totalPlaceholderCopiesRequired = instructions.reduce(
          (sum, i) => sum + Math.max(0, Number(i.copiesRequired ?? 0)),
          0
        );
        const updated: WorkflowState = {
          ...existing,
          updatedAt: now,
          currentPhase: "plan",
          decisions: [
            ...existing.decisions,
            {
              at: now,
              note:
                missingGroups.length === 0
                  ? "No pending MISSING groups require placeholder row preparation."
                  : `Prepared ${missingGroups.length} pending MISSING groups with manual row-add instructions.`,
            },
          ],
        };
        writeWorkflowState(updated);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              sessionId: sid,
              blockedMissingNoRows: diagnosis.blockedMissingNoRows.length,
              missingGroupsCount: missingGroups.length,
              allowMissingWithoutRows: updated.allowMissingWithoutRows,
              placeholderCode: CLAUDE_PLACEHOLDER_CODE,
              totalPlaceholderCopiesRequired,
              manualRowCopyRequired: missingGroups.length > 0,
              userReloadRequired: missingGroups.length > 0,
              userInstruction:
                missingGroups.length > 0
                  ? `Copy the placeholder rows exactly as listed in instructions, reload Excel, then run action='diagnose' again before any write.`
                  : "No pending MISSING groups require manual row copy. Continue with action='plan'.",
              nextRequiredStep:
                "User copies placeholder rows, reloads the Excel in app/workflow, then runs action='diagnose' again before any write.",
              rowNumberGuidance:
                "groupRowAnchor is from the latest diagnose snapshot. After each inserted row, later groups usually shift down. Prioritize matching by name + taloCode and sampleGuid.",
              instructions,
            }, null, 2),
          }],
        };
      }

      if (action === "plan") {
        const diagnosis = existing.diagnosis;
        if (!diagnosis) {
          return { content: [{ type: "text", text: "❌ No diagnosis in session. Run action='diagnose' first." }], isError: true };
        }
        const pending = diagnosis.defaultBatches;
        const updated: WorkflowState = { ...existing, updatedAt: now, currentPhase: "plan" };
        const blockedMissingNoRows = diagnosis.blockedMissingNoRows.length;
        const missingGroupsCount = diagnosis.summary.missing;
        const missingGroupsNeedingPlaceholderCount = diagnosis.missingGroupsNeedingPlaceholder?.length ?? 0;
        const nextRecommendedAction =
          missingGroupsNeedingPlaceholderCount > 0 && !updated.allowMissingWithoutRows
            ? "prepare_missing"
            : "execute";
        writeWorkflowState(updated);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              sessionId: sid,
              pendingBatches: pending,
              blockedMissingNoRows,
              missingGroupsCount,
              missingGroupsNeedingPlaceholderCount,
              nextRecommendedAction,
              executionContract: buildWorkflowExecutionContract(),
              completionMessage: buildWorkflowCompletionMessage(),
              userGuidance:
                missingGroupsNeedingPlaceholderCount > 0 && !updated.allowMissingWithoutRows
                  ? {
                      manualRowCopyRequired: true,
                      userReloadRequired: true,
                      phase: "prepare_missing",
                      userInstruction:
                        `Run action='prepare_missing' to get exact row-copy instructions using placeholder "${CLAUDE_PLACEHOLDER_CODE}". After copying, reload Excel and run action='diagnose' before writes.`,
                    }
                  : {
                      manualRowCopyRequired: false,
                      userReloadRequired: false,
                      phase: "execute",
                      userInstruction: "No manual row copy is required now. Continue executing planned batches.",
                    },
              playbook: buildWorkflowPlaybook({
                allowMissingWithoutRows: updated.allowMissingWithoutRows,
                blockedMissingNoRows,
                overAssignedCount: diagnosis.summary.overAssigned,
              }),
            }, null, 2),
          }],
        };
      }

      if (action === "checkpoint") {
        const inputPath = excelPath ?? existing.excelPath;
        if (!inputPath) {
          return { content: [{ type: "text", text: "❌ excelPath is required for checkpoint (or saved in session)." }], isError: true };
        }
        const checkpointPath = cloneExcelProgressive(inputPath, sid, label ?? "progress");
        const updated: WorkflowState = {
          ...existing,
          excelPath: inputPath,
          updatedAt: now,
          checkpoints: [
            ...existing.checkpoints,
            { createdAt: now, label: label ?? "progress", path: checkpointPath },
          ],
        };
        writeWorkflowState(updated);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              sessionId: sid,
              checkpointFile: checkpointPath,
              totalCheckpoints: updated.checkpoints.length,
            }, null, 2),
          }],
        };
      }

      if (action === "record_decision") {
        if (!decisionNote || !decisionNote.trim()) {
          return { content: [{ type: "text", text: "❌ decisionNote is required for action='record_decision'." }], isError: true };
        }
        const updated: WorkflowState = {
          ...existing,
          updatedAt: now,
          decisions: [...existing.decisions, { at: now, note: decisionNote.trim() }],
        };
        writeWorkflowState(updated);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              sessionId: sid,
              decisionsCount: updated.decisions.length,
              lastDecision: updated.decisions[updated.decisions.length - 1],
            }, null, 2),
          }],
        };
      }

      return { content: [{ type: "text", text: `❌ Unsupported action: ${action}` }], isError: true };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: "❌ Error managing Littera workflow: " + (error instanceof Error ? error.message : String(error)),
        }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_search_littera_catalog",
  {
    title: "Costa: Search full Littera catalog (littera.json)",
    description:
      "Searches the complete project Littera dictionary at src/data/littera.json (repo source of truth). Use this BEFORE claiming a code does not exist in the catalog. Do not infer the catalog from __costStore or costa_suggest; those only reflect already-assigned/filtered elements. Supports optional query (all tokens must appear in description+littera+keywords+category), codePrefix (e.g. 4361), exact codes, and categoryContains. Returns littera, description, unit, category, keywords when present.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe(
          "Space-separated tokens; each must appear (case-insensitive) in description, littera code, keywords, or category."
        ),
      codePrefix: z.string().optional().describe("Only codes whose littera field starts with this string (e.g. 4361)."),
      codes: z
        .array(z.string())
        .optional()
        .describe("Exact littera codes to resolve (e.g. [\"436160\",\"436135\"])."),
      categoryContains: z
        .string()
        .optional()
        .describe("Case-insensitive substring match on the category field."),
      maxResults: z
        .number()
        .optional()
        .describe("Max rows to return (default 80, max 500)."),
    }),
  },
  async ({ query, codePrefix, codes, categoryContains, maxResults }) => {
    try {
      const { matches, totalCatalogEntries, truncated, catalogPath } = searchLitteraCatalog({
        query,
        codePrefix,
        codes,
        categoryContains,
        maxResults: maxResults ?? 80,
      });
      const payload = {
        catalogPath,
        totalCatalogEntries,
        returnedCount: matches.length,
        truncated,
        matches: matches.map((e) => ({
          littera: e?.littera,
          description: e?.description,
          unit: e?.unit,
          category: e?.category,
          isCategory: e?.isCategory,
          keywords: e?.keywords,
        })),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error searching Littera catalog: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_search_talo_catalog",
  {
    title: "Costa: Search Talo 2000 classification catalog",
    description:
      "Searches the Talo 2000 Hankenimikkeistö classification catalog (src/data/talo2000.json). Use this to look up valid Talo codes before assigning them to IFC elements. Supports query (Finnish name tokens), codePrefix (e.g. '12' for Talo-osat), and exact codes. Returns code, name, parent.",
    inputSchema: z.object({
      query: z
        .string()
        .optional()
        .describe("Space-separated Finnish name tokens to search (e.g. 'ovi' or 'ulko-ovi')."),
      codePrefix: z.string().optional().describe("Only codes that start with this prefix (e.g. '12', '13')."),
      codes: z
        .array(z.string())
        .optional()
        .describe("Exact Talo codes to resolve (e.g. [\"1231\",\"1232\"])."),
      maxResults: z.number().optional().describe("Max rows to return (default 80, max 500)."),
    }),
  },
  async ({ query, codePrefix, codes, maxResults }) => {
    try {
      const { matches, totalCatalogEntries, truncated, catalogPath } = searchTaloCatalog({
        query,
        codePrefix,
        codes,
        maxResults: maxResults ?? 80,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { catalogPath, totalCatalogEntries, returnedCount: matches.length, truncated, matches },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Error searching Talo catalog: " + (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_analyze_littera_by_ifc_type",
  {
    title: "Costa: Analyze Littera by IFC Type",
    description:
      "Analyzes Littera congruence grouped by IFC Type + normalized Name + TALO Code using active Costa store context. Read-only; no Excel writes. **Do not use this as the first diagnostic call** when the user asks generically to improve Littera: first run costa_get_ifc_types_in_store, present all types to the user, then run this per chosen ifcType (or after the user confirms the type).",
    inputSchema: z.object({
      ifcType: z.string().describe("IFC type to analyze, e.g. IfcDoor"),
      groupLimit: z.number().optional().describe("Max semantic groups to return (default 50, max 500)."),
      elementLimit: z.number().optional().describe("Max elements of this type to analyze (default 500, max 5000)."),
      maxSuggestions: z.number().optional().describe("Max recommended Littera suggestions per group (default 5, max 8)."),
      minConfidence: z
        .number()
        .optional()
        .describe("Minimum confidence [0..1] used to build keep/remove/add proposals (default 0.5)."),
    }),
  },
  async ({ ifcType, groupLimit, elementLimit, maxSuggestions, minConfidence }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_analyze_littera_by_ifc_type",
        ifcTypeReview: ifcType,
        groupLimit,
        elementLimit,
        maxSuggestions,
        minConfidence,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error analyzing Littera by IFC type in Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_get_element_properties",
  {
    title: "Costa: Get Element Properties",
    description:
      "Returns published quantities and CostaBIM extras for express IDs. Reads CostPage store first (LayerRole, ContributeToMaara, PublishedQuantity, baseQuantities). Does not write IFC. Recalculates from the viewer only for ids missing from the store.",
    inputSchema: z.object({
      ids: z.array(z.number()).min(1).describe("Express IDs of elements"),
    }),
  },
  async ({ ids }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_get_element_properties",
        ids,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error getting element properties from Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_suggest_cost_codes",
  {
    title: "Costa: Suggest TALO/Littera Codes",
    description:
      "Returns TALO and Littera suggestions for CostPage context. Uses Costa app services and Finnish dictionaries. Provide ids (preferred) or ifcTypes.",
    inputSchema: z.object({
      ids: z.array(z.number()).optional().describe("Express IDs to evaluate (recommended)."),
      ifcTypes: z.array(z.string()).optional().describe("IFC types to evaluate, e.g. [\"IfcDoor\"]."),
      taloCodes: z
        .array(z.string())
        .optional()
        .describe("Optional TALO 2000 codes to filter CostPage elements (e.g. [\"1.3.1.5\"])."),
      litteraMainGroups: z
        .array(z.number())
        .optional()
        .describe("Optional main group(s) (0-9) derived from the first digit of the element's primary Littera code."),
      nameContains: z.string().optional().describe("Case-insensitive substring match for element name."),
      maxResults: z.number().optional().describe("Max elements to analyze (default 250, max 1000)."),
      maxSuggestions: z.number().optional().describe("Max suggestions per element (default 3, max 8)."),
    }),
  },
  async ({ ids, ifcTypes, taloCodes, litteraMainGroups, nameContains, maxResults, maxSuggestions }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_suggest_cost_codes",
        ids,
        ifcTypes,
        taloCodes: taloCodes ?? [],
        litteraMainGroups: litteraMainGroups ?? [],
        nameContains,
        maxResults,
        maxSuggestions,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error getting TALO/Littera suggestions from Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_fill_talo_in_excel",
  {
    title: "Costa: Fill TALO in Excel",
    description:
      "Reads a CostTable-style Excel file and fills TALO Code (and optional TALO Name) using the IFC context currently loaded in IFCViewer.",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute or repo-relative path to input .xlsx/.xls/.csv"),
      outputPath: z.string().optional().describe("Optional output path. Default: <input>-talo-filled.xlsx"),
      sheetName: z.string().optional().describe("Optional sheet name. Default auto-detect (Measurement Data/IFC Measurements/Sync)."),
      overwriteExisting: z
        .boolean()
        .optional()
        .describe("If true, existing TALO Code values are replaced. Default: false."),
    }),
  },
  async ({ excelPath, outputPath, sheetName, overwriteExisting }) => {
    try {
      const fullInputPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
      if (!fs.existsSync(fullInputPath)) {
        return {
          content: [{ type: "text", text: `❌ Excel file not found: ${fullInputPath}` }],
          isError: true,
        };
      }

      const workbook = XLSX.readFile(fullInputPath, { raw: true });
      const {
        sheetName: usedSheetName,
        sheet,
        aoa,
        headerRowIndex,
        headers,
      } = pickWorksheetForCostTable(workbook, sheetName, "talo");
      if (aoa.length <= headerRowIndex + 1) {
        return {
          content: [{ type: "text", text: `❌ Sheet "${usedSheetName}" has no data rows below the header.` }],
          isError: true,
        };
      }

      const headersLower = headers.map((h) => h.toLowerCase());
      const idxGuid = headersLower.indexOf("guid");
      const idxIfcType = headersLower.indexOf("ifc type");
      const idxName = headersLower.indexOf("name");
      const idxTalo = headersLower.indexOf("talo code");
      const idxTaloName = headersLower.indexOf("talo name");

      if (idxTalo < 0) {
        return {
          content: [{ type: "text", text: `❌ Sheet "${usedSheetName}" is missing "TALO Code" column.` }],
          isError: true,
        };
      }

      const elementsMsg = await sendJsonToFirstClient({
        type: "costa_get_elements",
        maxResults: 200000,
      });
      const elementsRes = (elementsMsg as any).result ?? elementsMsg;
      const viewerElements = Array.isArray(elementsRes?.elements) ? elementsRes.elements : [];

      const byGuid = new Map<string, any>();
      const byTypeAndName = new Map<string, any[]>();
      for (const el of viewerElements) {
        const guid = String(el?.globalId ?? "").trim().toLowerCase();
        if (guid) byGuid.set(guid, el);
        const key =
          `${String(el?.type ?? "").trim().toLowerCase()}__${normalizeElementName(el?.name)}`;
        if (!byTypeAndName.has(key)) byTypeAndName.set(key, []);
        byTypeAndName.get(key)!.push(el);
      }

      type RowLink = {
        row: number;
        ids: number[];
        existingTalo: string;
      };
      const linkedRows: RowLink[] = [];
      const targetIdsSet = new Set<number>();
      let skippedNoLink = 0;

      for (let r = headerRowIndex + 1; r < aoa.length; r++) {
        const row = aoa[r] ?? [];
        const existingTalo = String(row[idxTalo] ?? "").trim();
        if (existingTalo && !overwriteExisting) continue;

        const ids: number[] = [];
        const guid = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim().toLowerCase() : "";
        if (guid && byGuid.has(guid)) {
          const el = byGuid.get(guid);
          const idNum = Number(el?.id ?? el?.expressId);
          if (!isNaN(idNum)) ids.push(idNum);
        } else {
          const typeStr = idxIfcType >= 0 ? String(row[idxIfcType] ?? "").trim().toLowerCase() : "";
          const nameStr = idxName >= 0 ? normalizeElementName(row[idxName]) : "";
          if (typeStr && nameStr) {
            const key = `${typeStr}__${nameStr}`;
            const matches = byTypeAndName.get(key) ?? [];
            for (const el of matches) {
              const idNum = Number(el?.id ?? el?.expressId);
              if (!isNaN(idNum)) ids.push(idNum);
            }
          }
        }

        const uniqueIds = Array.from(new Set(ids));
        if (uniqueIds.length === 0) {
          skippedNoLink += 1;
          continue;
        }
        uniqueIds.forEach((id) => targetIdsSet.add(id));
        linkedRows.push({ row: r, ids: uniqueIds, existingTalo });
      }

      const targetIds = Array.from(targetIdsSet);
      if (targetIds.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: "No rows in Excel could be linked to IFC elements in the current viewer context.",
                sheet: usedSheetName,
                skippedNoLink,
              }),
            },
          ],
          isError: true,
        };
      }

      const suggestionsById = new Map<number, { taloCode: string; taloName?: string }>();
      const chunkSize = 500;
      for (let i = 0; i < targetIds.length; i += chunkSize) {
        const chunk = targetIds.slice(i, i + chunkSize);
        const suggestMsg = await sendJsonToFirstClient({
          type: "costa_suggest_cost_codes",
          ids: chunk,
          maxResults: chunk.length,
          maxSuggestions: 3,
        });
        const suggestRes = (suggestMsg as any).result ?? suggestMsg;
        const elements = Array.isArray(suggestRes?.elements) ? suggestRes.elements : [];
        for (const el of elements) {
          const idNum = Number(el?.id ?? el?.expressId);
          if (isNaN(idNum)) continue;
          const taloSuggestions = Array.isArray(el?.taloSuggestions) ? el.taloSuggestions : [];
          const top = taloSuggestions[0];
          const taloCode = String(top?.taloCode ?? "").trim();
          if (!taloCode) continue;
          suggestionsById.set(idNum, {
            taloCode,
            taloName: String(top?.rtName ?? "").trim() || undefined,
          });
        }
      }

      let updatedRows = 0;
      let unresolvedRows = 0;
      for (const rowLink of linkedRows) {
        const tally = new Map<string, { count: number; taloName?: string }>();
        for (const id of rowLink.ids) {
          const sug = suggestionsById.get(id);
          if (!sug?.taloCode) continue;
          const prev = tally.get(sug.taloCode) ?? { count: 0, taloName: sug.taloName };
          prev.count += 1;
          if (!prev.taloName && sug.taloName) prev.taloName = sug.taloName;
          tally.set(sug.taloCode, prev);
        }
        if (tally.size === 0) {
          unresolvedRows += 1;
          continue;
        }
        const [bestCode, bestMeta] = Array.from(tally.entries()).sort((a, b) => b[1].count - a[1].count)[0];
        updateSheetCell(sheet, rowLink.row, idxTalo, bestCode);
        if (idxTaloName >= 0 && bestMeta?.taloName) {
          const currentName = String((aoa[rowLink.row] ?? [])[idxTaloName] ?? "").trim();
          if (!currentName || overwriteExisting) {
            updateSheetCell(sheet, rowLink.row, idxTaloName, bestMeta.taloName);
          }
        }
        updatedRows += 1;
      }

      const parsed = path.parse(fullInputPath);
      const finalOutputPath = outputPath
        ? path.isAbsolute(outputPath)
          ? outputPath
          : path.resolve(REPO_ROOT, outputPath)
        : path.join(parsed.dir, `${parsed.name}-talo-filled.xlsx`);
      XLSX.writeFile(workbook, finalOutputPath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              sheet: usedSheetName,
              inputPath: fullInputPath,
              outputPath: finalOutputPath,
              linkedRows: linkedRows.length,
              updatedRows,
              unresolvedRows,
              skippedNoLink,
              idsAnalyzed: targetIds.length,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error filling TALO codes in Excel: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_improve_littera_in_excel",
  {
    title: "Costa: Improve Littera in Excel",
    description:
      "Temporarily blocked. Read-only reset point to avoid Excel format corruption while surgical writer is redesigned.",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute or repo-relative path to input .xlsx/.xls/.csv"),
      outputPath: z.string().optional().describe("Optional output path. Default: <input>-littera-improved.xlsx"),
      sheetName: z.string().optional().describe("Optional worksheet name. Default auto-detect."),
      overwriteExisting: z
        .boolean()
        .optional()
        .describe("If true, existing Littera Code rows are overwritten. Default: true."),
      maxSuggestions: z
        .number()
        .optional()
        .describe("Max suggestions per element when querying store. Default: 5 (max 8)."),
    }),
  },
  async ({ excelPath, outputPath, sheetName, overwriteExisting, maxSuggestions }) => {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error:
              "WRITE_BLOCKED: costa_improve_littera_in_excel is temporarily disabled to prevent Excel format corruption. Use probe + clone only.",
            acceptedInput: {
              excelPath,
              outputPath: outputPath ?? null,
              sheetName: sheetName ?? null,
              overwriteExisting: overwriteExisting ?? null,
              maxSuggestions: maxSuggestions ?? null,
            },
          }),
        },
      ],
      isError: true,
    };
  }
);

server.registerTool(
  "costa_probe_excel_store_ifc_link",
  {
    title: "Costa: Probe Excel/Store/IFC Link",
    description:
      "Reads an Excel Measurement Data sheet, links one element across Excel row + CostStore + IFC properties, and returns a single 3-level diagnostic sample (no file writes).",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute or repo-relative path to input .xlsx/.xls/.csv"),
      sheetName: z.string().optional().describe("Optional worksheet name. Default auto-detect."),
      preferredIfcType: z.string().optional().describe("Preferred IFC type to sample (default: IfcDoor)."),
    }),
  },
  async ({ excelPath, sheetName, preferredIfcType }) => {
    try {
      const fullInputPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
      if (!fs.existsSync(fullInputPath)) {
        return {
          content: [{ type: "text", text: `❌ Excel file not found: ${fullInputPath}` }],
          isError: true,
        };
      }

      const workbook = XLSX.readFile(fullInputPath, { raw: true });
      const { sheetName: usedSheetName, sheet, aoa, headerRowIndex, headers } = pickWorksheetForCostTable(
        workbook,
        sheetName,
        "littera"
      );
      if (aoa.length <= headerRowIndex + 1) {
        return {
          content: [{ type: "text", text: `❌ Sheet "${usedSheetName}" has no data rows below the header.` }],
          isError: true,
        };
      }

      const headersLower = headers.map((h) => h.toLowerCase());
      const idxIfcType = headersLower.indexOf("ifc type");
      const idxName = headersLower.indexOf("name");
      const idxGuid = headersLower.indexOf("guid");
      const idxTalo = headersLower.indexOf("talo code");
      const idxLitteraCode = headersLower.indexOf("littera code");
      const idxLitteraName = headersLower.indexOf("littera name");
      const idxLitteraCategory = headersLower.indexOf("littera category");
      const idxUnit = headersLower.indexOf("unit");
      const idxQuantity = headersLower.indexOf("quantity");
      const idxRelevance = headersLower.indexOf("relevance score");

      const elementsMsg = await sendJsonToFirstClient({
        type: "costa_get_elements",
        maxResults: 200000,
      });
      const elementsRes = (elementsMsg as any).result ?? elementsMsg;
      const viewerElements = Array.isArray(elementsRes?.elements) ? elementsRes.elements : [];
      const byGuid = new Map<string, any>();
      for (const el of viewerElements) {
        const g = String(el?.globalId ?? "").trim().toLowerCase();
        if (g) byGuid.set(g, el);
      }

      const wantedType = String(preferredIfcType ?? "IfcDoor").trim().toLowerCase();

      type GroupCtx = { row: number; name: string; taloCode: string };
      type LitteraCtx = {
        row: number;
        ifcType: string;
        name: string;
        taloCode: string;
        litteraCode: string;
        litteraName: string;
        litteraCategory: string;
        unit: string;
        quantity: string;
        relevanceScore: string;
      };
      let currentGroup: GroupCtx | null = null;
      let currentLittera: LitteraCtx | null = null;

      let chosen: {
        guidRow: number;
        guid: string;
        store: any;
        group: GroupCtx | null;
        littera: LitteraCtx | null;
      } | null = null;

      for (let r = headerRowIndex + 1; r < aoa.length; r++) {
        const row = aoa[r] ?? [];
        const ifcType = idxIfcType >= 0 ? String(row[idxIfcType] ?? "").trim() : "";
        const name = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
        const guid = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
        const taloCode = idxTalo >= 0 ? String(row[idxTalo] ?? "").trim() : "";

        if (!guid && !ifcType && name) {
          currentGroup = { row: r + 1, name, taloCode };
          continue;
        }

        if (
          isMeasurementDataLitteraRow(
            row,
            idxGuid,
            idxIfcType,
            idxName,
            idxTalo,
            idxLitteraCode,
            idxLitteraName,
            idxLitteraCategory,
            idxUnit,
            idxQuantity,
            idxRelevance
          )
        ) {
          currentLittera = {
            row: r + 1,
            ifcType,
            name,
            taloCode,
            litteraCode: idxLitteraCode >= 0 ? String(row[idxLitteraCode] ?? "").trim() : "",
            litteraName: idxLitteraName >= 0 ? String(row[idxLitteraName] ?? "").trim() : "",
            litteraCategory: idxLitteraCategory >= 0 ? String(row[idxLitteraCategory] ?? "").trim() : "",
            unit: idxUnit >= 0 ? String(row[idxUnit] ?? "").trim() : "",
            quantity: idxQuantity >= 0 ? String(row[idxQuantity] ?? "").trim() : "",
            relevanceScore: idxRelevance >= 0 ? String(row[idxRelevance] ?? "").trim() : "",
          };
          continue;
        }

        if (guid) {
          const storeEl = byGuid.get(guid.toLowerCase());
          if (!storeEl) continue;
          const elType = String(storeEl?.type ?? "").trim().toLowerCase();
          if (wantedType && elType !== wantedType) continue;
          chosen = {
            guidRow: r + 1,
            guid,
            store: storeEl,
            group: currentGroup,
            littera: currentLittera,
          };
          break;
        }
      }

      if (!chosen) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error:
                  `No sample element found for preferredIfcType="${preferredIfcType ?? "IfcDoor"}" with GUID row linked to store.`,
                sheet: usedSheetName,
              }),
            },
          ],
          isError: true,
        };
      }

      const idNum = Number(chosen.store?.id ?? chosen.store?.expressId);
      let ifcProperties: any = null;
      if (!isNaN(idNum)) {
        const propMsg = await sendJsonToFirstClient({
          type: "costa_get_element_properties",
          ids: [idNum],
        });
        const propRes = (propMsg as any).result ?? propMsg;
        ifcProperties = Array.isArray(propRes?.elements) ? propRes.elements[0] ?? null : null;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              inputPath: fullInputPath,
              sheet: usedSheetName,
              preferredIfcType: preferredIfcType ?? "IfcDoor",
              sample: {
                excel: {
                  groupRow: chosen.group,
                  litteraRow: chosen.littera,
                  guidRow: {
                    row: chosen.guidRow,
                    guid: chosen.guid,
                    taloCode: idxTalo >= 0 ? String((aoa[chosen.guidRow - 1] ?? [])[idxTalo] ?? "").trim() : "",
                  },
                },
                store: {
                  id: chosen.store?.id ?? chosen.store?.expressId,
                  expressId: chosen.store?.expressId ?? chosen.store?.id,
                  globalId: chosen.store?.globalId ?? "",
                  type: chosen.store?.type ?? "",
                  name: chosen.store?.name ?? "",
                  taloCode: chosen.store?.taloCode ?? "",
                  litteraCodesCount: Array.isArray(chosen.store?.litteraCodes) ? chosen.store.litteraCodes.length : 0,
                },
                ifc: ifcProperties
                  ? {
                      id: ifcProperties?.id ?? ifcProperties?.expressId,
                      expressId: ifcProperties?.expressId ?? ifcProperties?.id,
                      globalId: ifcProperties?.globalId ?? "",
                      baseQuantities: ifcProperties?.baseQuantities ?? {},
                      extraProperties: ifcProperties?.extraProperties ?? {},
                    }
                  : null,
              },
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error probing Excel/Store/IFC link: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_clone_excel_without_changes",
  {
    title: "Costa: Clone Excel Without Changes",
    description:
      "Creates a byte-identical copy of an Excel file with a new output path. No content or format modifications.",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute or repo-relative path to input Excel"),
      outputPath: z.string().optional().describe("Optional output path. Default: <input>-copy.xlsx"),
    }),
  },
  async ({ excelPath, outputPath }) => {
    try {
      const fullInputPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
      if (!fs.existsSync(fullInputPath)) {
        return {
          content: [{ type: "text", text: `❌ Excel file not found: ${fullInputPath}` }],
          isError: true,
        };
      }

      const parsed = path.parse(fullInputPath);
      const defaultOut = path.join(parsed.dir, `${parsed.name}-copy${parsed.ext || ".xlsx"}`);
      const finalOutputPath = outputPath
        ? path.isAbsolute(outputPath)
          ? outputPath
          : path.resolve(REPO_ROOT, outputPath)
        : defaultOut;

      fs.copyFileSync(fullInputPath, finalOutputPath);
      const inStat = fs.statSync(fullInputPath);
      const outStat = fs.statSync(finalOutputPath);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              inputPath: fullInputPath,
              outputPath: finalOutputPath,
              bytesIn: inStat.size,
              bytesOut: outStat.size,
              unchanged: inStat.size === outStat.size,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error cloning Excel without changes: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_diagnose_littera_excel",
  {
    title: "Costa: Diagnose Littera Quality in Excel",
    description:
      "Reads a CostPage Excel file and returns a structured quality report for Littera code assignments across the Measurement Data sheet. " +
      "Classifies every element group as OK | MISSING | OVER_ASSIGNED | TALO_MISMATCH. " +
      "Also checks whether the Määräluettelo sheet (if present) is in sync with Measurement Data. " +
      "Read-only — never writes to the file. " +
      "WORKFLOW: call this first at the start of any Littera improvement session. The report tells you exactly which groups need attention and in what priority order, so subsequent costa_set_littera_codes_batch_in_excel calls are focused and efficient.",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute path to the CostPage Excel file (.xlsx)."),
      overAssignedThreshold: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Max Littera codes per group before flagging as OVER_ASSIGNED. Default: 8."),
      includeOkGroups: z
        .boolean()
        .optional()
        .describe("If true, include OK groups in the output (verbose). Default: false — only problems."),
    }),
  },
  async ({ excelPath, overAssignedThreshold, includeOkGroups }) => {
    try {
      const fullPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
      if (!fs.existsSync(fullPath)) {
        return { content: [{ type: "text", text: `❌ File not found: ${fullPath}` }], isError: true };
      }
      if (!fullPath.toLowerCase().endsWith(".xlsx")) {
        return { content: [{ type: "text", text: "❌ Only .xlsx files are supported." }], isError: true };
      }

      const maxCodes = overAssignedThreshold ?? 8;
      const showOk = includeOkGroups ?? false;

      // ── Read Measurement Data sheet ──
      const workbook = XLSX.readFile(fullPath, { raw: true });
      const picked = pickWorksheetForCostTable(workbook, "Measurement Data", "littera");
      const { aoa, headerRowIndex, headers } = picked;

      const headersLower = headers.map((h) => h.toLowerCase());
      const idxIfcType      = headersLower.indexOf("ifc type");
      const idxName         = headersLower.indexOf("name");
      const idxGuid         = headersLower.indexOf("guid");
      const idxTalo         = headersLower.indexOf("talo code");
      const idxLitteraCode  = headersLower.indexOf("littera code");
      const idxLitteraName  = headersLower.indexOf("littera name");
      const idxLitteraCategory = headersLower.indexOf("littera category");
      const idxUnit         = headersLower.indexOf("unit");
      const idxQuantity     = headersLower.indexOf("quantity");
      const idxRelevance    = headersLower.indexOf("relevance score");

      if (idxGuid < 0 || idxName < 0 || idxIfcType < 0) {
        return { content: [{ type: "text", text: "❌ Required columns (GUID, Name, IFC Type) not found in sheet." }], isError: true };
      }

      // ── Parse CostPage group blocks (GUID-centric, mirrors the writer surgical) ──
      // Strategy: find every GUID row, trace backward to locate its group header,
      // then collect only the littera rows between header and first GUID.
      // This is exactly what costa_set_littera_codes_batch_in_excel does,
      // so diagnose and writer will always agree on group boundaries.
      interface GroupRecord {
        ifcType: string;
        name: string;
        taloCode: string;
        groupRow: number;        // 0-indexed aoa row of group header
        litteraCodes: string[];
        litteraCategories: string[];
        hasPlaceholder: boolean;
        sampleGuids: string[];
      }

      // Pass 1: collect all GUID rows
      const guidRows: Array<{ r: number; guid: string }> = [];
      for (let r = headerRowIndex + 1; r < aoa.length; r++) {
        const row = aoa[r] ?? [];
        const guid = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
        if (guid) guidRows.push({ r, guid });
      }

      // Pass 2: for each GUID row, trace backward to its group header.
      // Group header = no GUID, has IFC type + name, NOT a Littera row.
      // CostPage writes group header rows with ifcType='' (empty) and name=<group name>.
      // This mirrors the writer's criterion: !g && !ifc && !!name.
      const isGroupHeader = (row: string[]): boolean => {
        const g = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
        if (g) return false;
        const ifc = idxIfcType >= 0 ? String(row[idxIfcType] ?? "").trim() : "";
        if (ifc) return false; // IFC type summaries, littera rows, and GRAND TOTAL have non-empty ifcType
        const nm  = idxName >= 0 ? String(row[idxName] ?? "").trim() : "";
        if (!nm) return false;
        if (/\bgroups?,\s*\d+\s*elements?\b/i.test(nm)) return false;
        return !isMeasurementDataLitteraRow(row, idxGuid, idxIfcType, idxName, idxTalo, idxLitteraCode, idxLitteraName, idxLitteraCategory, idxUnit, idxQuantity, idxRelevance);
      };

      // Map from groupRow (aoa index) → GroupRecord (shared across all GUIDs in the group)
      const groupByRow = new Map<number, GroupRecord>();

      for (const { r: guidR, guid } of guidRows) {
        // Find the group header by scanning backward
        let groupRowAoa = -1;
        for (let r = guidR - 1; r >= headerRowIndex; r--) {
          if (isGroupHeader(aoa[r] ?? [])) {
            groupRowAoa = r;
            break;
          }
        }
        if (groupRowAoa < 0) continue; // orphan GUID — no group header found

        if (!groupByRow.has(groupRowAoa)) {
          const hRow = aoa[groupRowAoa] ?? [];
          const ifcType = idxIfcType >= 0 ? String(hRow[idxIfcType] ?? "").trim() : "";
          const name    = idxName >= 0 ? String(hRow[idxName] ?? "").trim() : "";
          const talo    = idxTalo >= 0 ? String(hRow[idxTalo] ?? "").trim() : "";

          // Collect littera rows between group header and THIS GUID row
          const litteraCodes: string[] = [];
          const litteraCategories: string[] = [];
          let hasPlaceholder = false;
          for (let r = groupRowAoa + 1; r < guidR; r++) {
            const row = aoa[r] ?? [];
            const g = idxGuid >= 0 ? String(row[idxGuid] ?? "").trim() : "";
            if (g) break; // hit a GUID row — stop
            if (!isMeasurementDataLitteraRow(row, idxGuid, idxIfcType, idxName, idxTalo, idxLitteraCode, idxLitteraName, idxLitteraCategory, idxUnit, idxQuantity, idxRelevance)) continue;
            const lc   = idxLitteraCode >= 0 ? String(row[idxLitteraCode] ?? "").trim() : "";
            const lcat = idxLitteraCategory >= 0 ? String(row[idxLitteraCategory] ?? "").trim() : "";
            if (isLitteraPlaceholderCell(lc)) {
              hasPlaceholder = true;
            } else if (lc) {
              litteraCodes.push(lc);
              if (lcat) litteraCategories.push(lcat);
            }
          }

          groupByRow.set(groupRowAoa, {
            ifcType,
            name,
            taloCode: talo,
            groupRow: groupRowAoa + 1, // 1-based for reporting
            litteraCodes,
            litteraCategories,
            hasPlaceholder,
            sampleGuids: [guid],
          });
        } else {
          // Same group, additional element — just add the GUID sample
          const rec = groupByRow.get(groupRowAoa)!;
          if (rec.sampleGuids.length < 5) rec.sampleGuids.push(guid);
        }
      }

      const groups: GroupRecord[] = Array.from(groupByRow.values())
        .sort((a, b) => a.groupRow - b.groupRow);

      // ── Classify each group ──
      type GroupStatus = "OK" | "MISSING" | "OVER_ASSIGNED" | "TALO_MISMATCH";

      interface DiagGroup {
        status: GroupStatus;
        ifcType: string;
        name: string;
        taloCode: string;
        groupRow: number;
        sampleGuids: string[];
        litteraCount: number;
        litteraCodes: string[];
        note: string;
      }

      const diagnosed: DiagGroup[] = [];

      for (const g of groups) {
        const count = g.litteraCodes.length;
        let status: GroupStatus = "OK";
        let note = "";

        if (count === 0 || g.hasPlaceholder) {
          status = "MISSING";
          note = g.hasPlaceholder ? "Marked as (No Littera codes)" : "No Littera codes found";
        } else if (count > maxCodes) {
          status = "OVER_ASSIGNED";
          note = `${count} codes assigned (threshold: ${maxCodes}). Likely entire family range — needs pruning to specific type.`;
        } else {
          // Simple TALO-Littera coherence heuristic based on category prefix
          // If a TALO code is present and the assigned Littera categories suggest a category mismatch
          const taloPrefix = g.taloCode.replace(/\./g, "").replace(/^0+/, "").substring(0, 1);
          const cats = g.litteraCategories.map((c) => c.toLowerCase());
          // Flag likely mismatches: e.g., TALO 1.3.1.x (interior) with exterior-sounding category
          const isInteriorTalo = /^1\.3\./i.test(g.taloCode);
          const hasExteriorCategory = cats.some((c) => c.includes("ulkoseinä") || c.includes("julkisivu") || c.includes("ulkoovi") || c.includes("ulkopalo"));
          if (isInteriorTalo && hasExteriorCategory) {
            status = "TALO_MISMATCH";
            note = `TALO ${g.taloCode} (interior/finishing) but Littera category suggests exterior element. Verify with catalog.`;
          }
        }

        if (status === "OK" && !showOk) continue;

        diagnosed.push({
          status,
          ifcType: g.ifcType,
          name: g.name,
          taloCode: g.taloCode,
          groupRow: g.groupRow,
          sampleGuids: g.sampleGuids,
          litteraCount: count,
          litteraCodes: g.litteraCodes,
          note,
        });
      }

      // ── Check Määräluettelo sync ──
      let maaraSyncNote = "Sheet 'Määräluettelo' not found in workbook.";
      let maaraInSync: boolean | null = null;
      let maaraDiscrepancies = 0;

      if (workbook.SheetNames.includes("Määräluettelo")) {
        const maaraSheet = workbook.Sheets["Määräluettelo"];
        const maaraAoa: string[][] = XLSX.utils.sheet_to_json(maaraSheet, { header: 1, defval: "" }) as string[][];
        // Find header row that contains the 4 required columns
        let headerIdx = -1;
        let idxLit = -1;
        for (let r = 0; r < Math.min(30, maaraAoa.length); r++) {
          const low = rowHeadersLower(maaraAoa[r] ?? []);
          const lit = low.indexOf("littera");
          const sel = low.indexOf("selite");
          const maa = low.indexOf("määrä");
          const yks = low.indexOf("yks");
          if (lit >= 0 && sel >= 0 && maa >= 0 && yks >= 0) {
            headerIdx = r;
            idxLit = lit;
            break;
          }
        }
        const maaraCodes = new Set<string>();
        if (headerIdx >= 0 && idxLit >= 0) {
          for (let r = headerIdx + 1; r < maaraAoa.length; r++) {
            const code = String((maaraAoa[r] ?? [])[idxLit] ?? "").trim();
            // 5+ digit numeric codes are measurement rows (shorter numeric codes are chapter headers)
            if (code && code.length >= 5 && /^\d+$/.test(code)) maaraCodes.add(code);
          }
        }
        // Collect unique Littera codes from Measurement Data
        const mdCodes = new Set<string>();
        for (const g of groups) g.litteraCodes.forEach((c) => mdCodes.add(c));

        // Scope rows are intentionally present in Määräluettelo and may not be present in Measurement Data.
        const isScopeCode = (c: string) => c === "001000" || c === "002000" || c === "003000";
        const mdCodesFiltered = [...mdCodes].filter((c) => !isScopeCode(c));
        const maaraCodesFiltered = [...maaraCodes].filter((c) => !isScopeCode(c));

        const onlyInMd = mdCodesFiltered.filter((c) => !maaraCodesFiltered.includes(c));
        const onlyInMaara = maaraCodesFiltered.filter((c) => !mdCodesFiltered.includes(c));
        maaraDiscrepancies = onlyInMd.length + onlyInMaara.length;
        maaraInSync = maaraDiscrepancies === 0;
        if (maaraInSync) {
          maaraSyncNote = `✓ In sync — ${maaraCodes.size} codes match between Measurement Data and Määräluettelo.`;
        } else {
          maaraSyncNote =
            `⚠ ${maaraDiscrepancies} discrepancy(ies): ` +
            (onlyInMd.length ? `${onlyInMd.length} codes in Measurement Data but not in Määräluettelo (${onlyInMd.slice(0, 5).join(", ")}${onlyInMd.length > 5 ? "…" : ""}). ` : "") +
            (onlyInMaara.length ? `${onlyInMaara.length} codes in Määräluettelo but not in Measurement Data (${onlyInMaara.slice(0, 5).join(", ")}${onlyInMaara.length > 5 ? "…" : ""}).` : "");
        }
      }

      // ── Summary ──
      const totalGroups = groups.length;
      const byStatus = { OK: 0, MISSING: 0, OVER_ASSIGNED: 0, TALO_MISMATCH: 0 };
      for (const g of groups) {
        const count = g.litteraCodes.length;
        if (count === 0 || g.hasPlaceholder) byStatus.MISSING++;
        else if (count > maxCodes) byStatus.OVER_ASSIGNED++;
        else {
          const cats = g.litteraCategories.map((c) => c.toLowerCase());
          const isInteriorTalo = /^1\.3\./i.test(g.taloCode);
          const hasExteriorCategory = cats.some((c) => c.includes("ulkoseinä") || c.includes("julkisivu") || c.includes("ulkoovi") || c.includes("ulkopalo"));
          if (isInteriorTalo && hasExteriorCategory) byStatus.TALO_MISMATCH++;
          else byStatus.OK++;
        }
      }

      const priorityOrder = [
        ...diagnosed.filter((d) => d.status === "MISSING"),
        ...diagnosed.filter((d) => d.status === "TALO_MISMATCH"),
        ...diagnosed.filter((d) => d.status === "OVER_ASSIGNED"),
        ...diagnosed.filter((d) => d.status === "OK"),
      ];

      const report = {
        file: path.basename(fullPath),
        overAssignedThreshold: maxCodes,
        summary: {
          totalGroups,
          ok: byStatus.OK,
          missing: byStatus.MISSING,
          overAssigned: byStatus.OVER_ASSIGNED,
          taloMismatch: byStatus.TALO_MISMATCH,
        },
        maaraluettelo: { inSync: maaraInSync, discrepancies: maaraDiscrepancies, note: maaraSyncNote },
        groups: priorityOrder,
        _debug: {
          sheetPicked: picked.sheetName,
          headerRowIndex,
          aoaLength: aoa.length,
          headerRow: headers.slice(0, 10).map((h) => String(h ?? "")),
          idxIfcType,
          idxName,
          idxGuid,
          idxLitteraCode,
          guidRowsFound: guidRows.length,
          sampleDataRow: aoa[headerRowIndex + 1]?.slice(0, 8).map((c) => String(c ?? "")) ?? [],
          sampleGuidRows: guidRows.slice(0, 3).map((gr) => ({ r: gr.r, guid: gr.guid })),
        },
      };

      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: "❌ Error: " + (error instanceof Error ? error.message : String(error)) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_set_littera_codes_for_guid_in_excel",
  {
    title: "Costa: Set Littera Codes For GUID in Excel",
    description:
      "Surgical edit for ONE element group in Measurement Data. For 2 or more groups use costa_set_littera_codes_batch_in_excel instead — it is much faster and cheaper. " +
      "DEFAULT writeMode is 'inplace': NEVER deletes rows — overwrites existing Littera Code cells in order and clears extras. " +
      "ALWAYS use dryRun:true first. CRITICAL: if this tool fails or times out, STOP and report — never fall back to costa_apply_cost_codes.",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute or repo-relative path to input .xlsx"),
      outputPath: z.string().optional().describe("Optional output path. Default: <input>-littera-surgical.xlsx"),
      sheetName: z.string().optional().describe("Optional worksheet name. Default auto-detect."),
      guid: z.string().describe("Target IFC GlobalId/GUID to locate the group block in Excel."),
      litteraCodes: z.array(z.string()).min(1).describe("Ordered Littera codes to keep/add in the group block."),
      dryRun: z.boolean().optional().describe("If true, analyze only and do not write file. Default: false."),
      writeMode: z.enum(["inplace", "v2"]).optional().describe("'inplace' (default, safe): never deletes rows, overwrites in-place; 'v2' (legacy): inserts/deletes rows to match exact count."),
    }),
  },
  async ({ excelPath, outputPath, sheetName, guid, litteraCodes, dryRun, writeMode }) => {
    try {
      const fullInputPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
      if (!fs.existsSync(fullInputPath)) {
        return {
          content: [{ type: "text", text: `❌ Excel file not found: ${fullInputPath}` }],
          isError: true,
        };
      }
      if (!fullInputPath.toLowerCase().endsWith(".xlsx")) {
        return {
          content: [{ type: "text", text: "❌ This surgical tool currently supports only .xlsx files." }],
          isError: true,
        };
      }

      const cleanedCodes = Array.from(
        new Set(
          (Array.isArray(litteraCodes) ? litteraCodes : [])
            .map((c) => String(c ?? "").trim())
            .filter(Boolean)
        )
      );
      if (cleanedCodes.length === 0) {
        return {
          content: [{ type: "text", text: "❌ Provide at least one non-empty Littera code." }],
          isError: true,
        };
      }

      const workbook = XLSX.readFile(fullInputPath, { raw: true });
      const { sheetName: usedSheetName, aoa, headerRowIndex, headers } = pickWorksheetForCostTable(
        workbook,
        sheetName,
        "littera"
      );
      const headersLower = headers.map((h) => h.toLowerCase());
      const idxIfcType = headersLower.indexOf("ifc type");
      const idxName = headersLower.indexOf("name");
      const idxGuid = headersLower.indexOf("guid");
      const idxTalo = headersLower.indexOf("talo code");
      const idxLitteraCode = headersLower.indexOf("littera code");
      const idxLitteraName = headersLower.indexOf("littera name");
      const idxLitteraCategory = headersLower.indexOf("littera category");
      const idxUnit = headersLower.indexOf("unit");
      const idxQuantity = headersLower.indexOf("quantity");
      const idxRelevance = headersLower.indexOf("relevance score");

      if (idxGuid < 0 || idxLitteraCode < 0 || idxName < 0 || idxIfcType < 0) {
        return {
          content: [{ type: "text", text: "❌ Missing required columns (GUID, IFC Type, Name, Littera Code)." }],
          isError: true,
        };
      }

      const targetGuidLower = String(guid ?? "").trim().toLowerCase();
      if (!targetGuidLower) {
        return {
          content: [{ type: "text", text: "❌ guid is required." }],
          isError: true,
        };
      }

      let guidRowAoa = -1;
      for (let r = headerRowIndex + 1; r < aoa.length; r++) {
        const row = aoa[r] ?? [];
        const g = String(row[idxGuid] ?? "").trim().toLowerCase();
        if (g && g === targetGuidLower) {
          guidRowAoa = r;
          break;
        }
      }
      if (guidRowAoa < 0) {
        return {
          content: [{ type: "text", text: `❌ GUID not found in sheet "${usedSheetName}": ${guid}` }],
          isError: true,
        };
      }

      // Find group summary row above target GUID block.
      let groupRowAoa = -1;
      for (let r = guidRowAoa - 1; r >= headerRowIndex + 1; r--) {
        const row = aoa[r] ?? [];
        const g = String(row[idxGuid] ?? "").trim();
        const ifc = String(row[idxIfcType] ?? "").trim();
        const name = String(row[idxName] ?? "").trim();
        if (!g && !ifc && !!name) {
          groupRowAoa = r;
          break;
        }
      }
      if (groupRowAoa < 0) {
        return {
          content: [{ type: "text", text: "❌ Could not locate group summary row above target GUID row." }],
          isError: true,
        };
      }

      // Existing littera rows are between group summary and first GUID row, matching littera-row shape.
      const litteraRowsAoa: number[] = [];
      for (let r = groupRowAoa + 1; r < guidRowAoa; r++) {
        const row = aoa[r] ?? [];
        if (
          isMeasurementDataLitteraRow(
            row,
            idxGuid,
            idxIfcType,
            idxName,
            idxTalo,
            idxLitteraCode,
            idxLitteraName,
            idxLitteraCategory,
            idxUnit,
            idxQuantity,
            idxRelevance
          )
        ) {
          litteraRowsAoa.push(r);
        }
      }

      if (litteraRowsAoa.length === 0) {
        return {
          content: [{ type: "text", text: "❌ No Littera rows found in target group block." }],
          isError: true,
        };
      }

      const beforeRows = litteraRowsAoa.map((r) => ({
        row: r + 1,
        litteraCode: String((aoa[r] ?? [])[idxLitteraCode] ?? "").trim(),
      }));

      const effectiveMode = writeMode === "v2" ? "v2" : "inplace";

      if (dryRun === true) {
        const willOverwrite = Math.min(cleanedCodes.length, litteraRowsAoa.length);
        const willClear = effectiveMode === "inplace" ? Math.max(0, litteraRowsAoa.length - cleanedCodes.length) : 0;
        const willInsert = Math.max(0, cleanedCodes.length - litteraRowsAoa.length);
        const willDelete = effectiveMode === "v2" ? Math.max(0, litteraRowsAoa.length - cleanedCodes.length) : 0;
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: true,
                dryRun: true,
                mode: effectiveMode,
                inputPath: fullInputPath,
                sheet: usedSheetName,
                guid,
                groupRow: groupRowAoa + 1,
                guidRow: guidRowAoa + 1,
                litteraRows: beforeRows,
                requestedCodes: cleanedCodes,
                willOverwriteRows: willOverwrite,
                willClearRows: willClear,
                willInsertRows: willInsert,
                willDeleteRows: willDelete,
                structureSafe: effectiveMode === "inplace",
              }),
            },
          ],
        };
      }

      // Resolve final output path first (may be on external/slow drive).
      const parsed = path.parse(fullInputPath);
      const requestedOut: string = outputPath ?? "";
      const finalOutputPath: string = requestedOut
        ? path.isAbsolute(requestedOut)
          ? requestedOut
          : path.resolve(REPO_ROOT, requestedOut)
        : path.join(parsed.dir, `${parsed.name}-littera-edited.xlsx`);

      // Copy input to a local temp file so ExcelJS read/write runs on fast local disk.
      const tempDir = os.tmpdir();
      const tempId = `costa-littera-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tempInputPath = path.join(tempDir, `${tempId}-in.xlsx`);
      const tempOutputPath = path.join(tempDir, `${tempId}-out.xlsx`);
      fs.copyFileSync(fullInputPath, tempInputPath);

      // Load workbook for writing from local temp copy.
      const ejWb = new ExcelJS.Workbook();
      try {
        await ejWb.xlsx.readFile(tempInputPath);
      } catch (readErr) {
        fs.rmSync(tempInputPath, { force: true });
        return {
          content: [{ type: "text", text: `❌ ExcelJS could not read workbook: ${readErr instanceof Error ? readErr.message : String(readErr)}` }],
          isError: true,
        };
      }
      const ejWs = ejWb.getWorksheet(usedSheetName);
      if (!ejWs) {
        fs.rmSync(tempInputPath, { force: true });
        return {
          content: [{ type: "text", text: `❌ Worksheet "${usedSheetName}" not found in ExcelJS read.` }],
          isError: true,
        };
      }
      const ws = ejWs!;

      const litteraCols = {
        litteraCode: idxLitteraCode,
        litteraName: idxLitteraName,
        litteraCategory: idxLitteraCategory,
        unit: idxUnit,
        quantity: idxQuantity,
        relevance: idxRelevance,
      };

      // Build catalog lookup for name/category/unit enrichment
      const guidCatalogAll = loadLitteraCatalog();
      const guidCatalogMap = new Map<string, any>(
        guidCatalogAll.map((e: any) => [String(e?.littera ?? "").trim(), e])
      );
      const writeGuidLitteraRow = (row1: number, code: string) => {
        excelJsSetCell(ws, row1, idxLitteraCode + 1, code);
        const entry = guidCatalogMap.get(code);
        if (entry) {
          if (idxLitteraName >= 0) excelJsSetCell(ws, row1, idxLitteraName + 1, String(entry.description ?? ""));
          if (idxLitteraCategory >= 0) excelJsSetCell(ws, row1, idxLitteraCategory + 1, String(entry.category ?? ""));
          if (idxUnit >= 0) excelJsSetCell(ws, row1, idxUnit + 1, String(entry.unit ?? ""));
        }
      };

      let insertedRows = 0;
      let deletedRows = 0;
      let clearedRows = 0;
      let afterRows: { row: number; litteraCode: string }[] = [];
      let guidRowAfter = guidRowAoa + 1;

      if (effectiveMode === "inplace") {
        // INPLACE: never delete rows — overwrite in sequence, clear extras, insert only if needed.
        const existingRows1 = litteraRowsAoa.map((r) => r + 1);
        let currentGuidRow1 = guidRowAoa + 1;

        // Overwrite existing rows with new codes or clear them.
        for (let i = 0; i < existingRows1.length; i++) {
          if (i < cleanedCodes.length) {
            writeGuidLitteraRow(existingRows1[i]!, cleanedCodes[i]!);
          } else {
            clearLitteraColumnsExcelJs(ws, existingRows1[i]!, litteraCols);
            clearedRows++;
          }
        }

        // INPLACE never inserts rows — extra codes beyond existing rows are silently dropped.
        // This preserves Excel native row grouping/outline metadata (spliceRows breaks it).
        // Use costa_set_littera_codes_batch_in_excel for groups that may need more codes than rows.

        guidRowAfter = currentGuidRow1;
        afterRows = existingRows1.map((row, i) => ({
          row,
          litteraCode: i < cleanedCodes.length ? cleanedCodes[i]! : "",
        }));

      } else {
        // V2 LEGACY: insert/delete rows to match exact code count.
        let targetRows1 = litteraRowsAoa.map((r) => r + 1);
        let guidRow1 = guidRowAoa + 1;
        const baseTemplateRow1 = targetRows1[0]!;

        if (cleanedCodes.length > targetRows1.length) {
          const toAdd = cleanedCodes.length - targetRows1.length;
          for (let i = 0; i < toAdd; i++) {
            ws.spliceRows(guidRow1, 0, []);
            const inserted = ws.getRow(guidRow1);
            const template = ws.getRow(baseTemplateRow1);
            inserted.height = template.height;
            template.eachCell({ includeEmpty: true }, (cell, colNumber) => {
              const c = inserted.getCell(colNumber);
              c.style = { ...cell.style };
              c.value = null;
            });
            excelJsSetCell(ws, guidRow1, idxIfcType + 1, (template.getCell(idxIfcType + 1).value as string | number | null) ?? "");
            excelJsSetCell(ws, guidRow1, idxName + 1, (template.getCell(idxName + 1).value as string | number | null) ?? "");
            if (idxTalo >= 0) {
              excelJsSetCell(ws, guidRow1, idxTalo + 1, (template.getCell(idxTalo + 1).value as string | number | null) ?? "");
            }
            excelJsSetCell(ws, guidRow1, idxLitteraCode + 1, "");
            targetRows1.push(guidRow1);
            guidRow1++;
            insertedRows++;
          }
        }

        if (cleanedCodes.length < targetRows1.length) {
          const toDelete = targetRows1.length - cleanedCodes.length;
          for (let i = 0; i < toDelete; i++) {
            const rowToDelete = targetRows1[targetRows1.length - 1]!;
            ws.spliceRows(rowToDelete, 1);
            targetRows1.pop();
            if (rowToDelete < guidRow1) guidRow1--;
            deletedRows++;
          }
        }

        for (let i = 0; i < targetRows1.length; i++) {
          const code = cleanedCodes[i] ?? "";
          if (code) {
            writeGuidLitteraRow(targetRows1[i]!, code);
          } else {
            excelJsSetCell(ws, targetRows1[i]!, idxLitteraCode + 1, "");
          }
        }

        guidRowAfter = guidRow1;
        afterRows = targetRows1.map((r, i) => ({ row: r, litteraCode: cleanedCodes[i] ?? "" }));
      }

      // Write to local temp first (fast), then copy to final destination.
      await ejWb.xlsx.writeFile(tempOutputPath);
      fs.copyFileSync(tempOutputPath, finalOutputPath);
      fs.rmSync(tempInputPath, { force: true });
      fs.rmSync(tempOutputPath, { force: true });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              mode: effectiveMode,
              inputPath: fullInputPath,
              outputPath: finalOutputPath,
              sheet: usedSheetName,
              guid,
              groupRow: groupRowAoa + 1,
              guidRowBefore: guidRowAoa + 1,
              guidRowAfter,
              beforeRows,
              afterRows,
              insertedRows,
              deletedRows,
              clearedRows,
              structureSafe: effectiveMode === "inplace",
              changedColumns: ["Littera Code"],
              touchedGuidRows: false,
              touchedTaloColumn: false,
            }),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error setting surgical Littera codes in Excel: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_set_littera_codes_batch_in_excel",
  {
    title: "Costa: Batch Set Littera Codes in Excel",
    description:
      "Processes multiple GUID groups in a SINGLE Excel read/write cycle — much faster and cheaper than calling costa_set_littera_codes_for_guid_in_excel once per group. " +
      "Use this whenever you need to update 2 or more groups (e.g. all 25 IfcDoor groups at once). " +
      "DEFAULT writeMode is 'inplace': never deletes rows — overwrites existing Littera Code cells and clears extras; safe for any number of groups. " +
      "WORKFLOW: (1) run with dryRun:true and show the consolidated report to the user; (2) after user approval, run with dryRun:false — set outputPath equal to excelPath to overwrite the working copy. " +
      "CRITICAL: if this tool fails or times out, STOP and report the error. NEVER fall back to costa_apply_cost_codes.",
    inputSchema: z.object({
      excelPath: z.string().describe("Absolute path to the working Excel copy (.xlsx)."),
      outputPath: z.string().optional().describe("Output path. Set equal to excelPath to overwrite the working copy in place."),
      sheetName: z.string().optional().describe("Sheet name. Default: auto-detect."),
      changes: z
        .array(
          z.object({
            guid: z.string().describe("IFC GlobalId of the group to update."),
            litteraCodes: z.array(z.string()).min(1).describe("New ordered Littera codes for this group."),
          })
        )
        .min(1)
        .describe("All groups to update in one call."),
      dryRun: z.boolean().optional().describe("If true, analyze only — do not write. Default: false."),
      writeMode: z.enum(["inplace", "v2"]).optional().describe("'inplace' (default, safe): never deletes rows; 'v2' (legacy): may delete rows, can corrupt groupings."),
    }),
  },
  async ({ excelPath, outputPath, sheetName, changes, dryRun, writeMode }) => {
    try {
      const fullInputPath = path.isAbsolute(excelPath) ? excelPath : path.resolve(REPO_ROOT, excelPath);
      if (!fs.existsSync(fullInputPath)) {
        return { content: [{ type: "text" as const, text: `❌ Excel file not found: ${fullInputPath}` }], isError: true };
      }
      if (!fullInputPath.toLowerCase().endsWith(".xlsx")) {
        return { content: [{ type: "text" as const, text: "❌ Only .xlsx files are supported." }], isError: true };
      }

      const effectiveMode = writeMode === "v2" ? "v2" : "inplace";

      const parsedPath = path.parse(fullInputPath);
      const requestedOut: string = outputPath ?? "";
      const finalOutputPath: string = requestedOut
        ? path.isAbsolute(requestedOut) ? requestedOut : path.resolve(REPO_ROOT, requestedOut)
        : path.join(parsedPath.dir, `${parsedPath.name}-littera-batch.xlsx`);

      // ── PHASE 1: read with XLSX (fast) to build per-GUID plans ──
      const workbook = XLSX.readFile(fullInputPath, { raw: true });
      const { sheetName: usedSheetName, aoa, headerRowIndex, headers } = pickWorksheetForCostTable(workbook, sheetName, "littera");

      const headersLower = headers.map((h) => h.toLowerCase());
      const idxIfcType = headersLower.indexOf("ifc type");
      const idxName = headersLower.indexOf("name");
      const idxGuid = headersLower.indexOf("guid");
      const idxTalo = headersLower.indexOf("talo code");
      const idxLitteraCode = headersLower.indexOf("littera code");
      const idxLitteraName = headersLower.indexOf("littera name");
      const idxLitteraCategory = headersLower.indexOf("littera category");
      const idxUnit = headersLower.indexOf("unit");
      const idxQuantity = headersLower.indexOf("quantity");
      const idxRelevance = headersLower.indexOf("relevance score");

      if (idxGuid < 0 || idxLitteraCode < 0 || idxName < 0 || idxIfcType < 0) {
        return { content: [{ type: "text" as const, text: "❌ Missing required columns (GUID, IFC Type, Name, Littera Code)." }], isError: true };
      }

      interface GuidPlan {
        guid: string;
        cleanedCodes: string[];
        guidRowAoa: number;
        groupRowAoa: number;
        litteraRowsAoa: number[];
        beforeCodes: string[];
        groupName: string;
        error?: string;
      }

      const plans: GuidPlan[] = [];

      for (const change of changes) {
        const cleanedCodes = Array.from(
          new Set(
            (Array.isArray(change.litteraCodes) ? change.litteraCodes : [])
              .map((c) => String(c ?? "").trim())
              .filter(Boolean)
          )
        );
        const targetGuidLower = String(change.guid ?? "").trim().toLowerCase();

        if (!targetGuidLower) {
          plans.push({ guid: change.guid, cleanedCodes, guidRowAoa: -1, groupRowAoa: -1, litteraRowsAoa: [], beforeCodes: [], groupName: "", error: "Empty GUID." });
          continue;
        }
        if (cleanedCodes.length === 0) {
          plans.push({ guid: change.guid, cleanedCodes, guidRowAoa: -1, groupRowAoa: -1, litteraRowsAoa: [], beforeCodes: [], groupName: "", error: "No valid Littera codes." });
          continue;
        }

        let guidRowAoa = -1;
        for (let r = headerRowIndex + 1; r < aoa.length; r++) {
          const g = String((aoa[r] ?? [])[idxGuid] ?? "").trim().toLowerCase();
          if (g && g === targetGuidLower) { guidRowAoa = r; break; }
        }
        if (guidRowAoa < 0) {
          plans.push({ guid: change.guid, cleanedCodes, guidRowAoa: -1, groupRowAoa: -1, litteraRowsAoa: [], beforeCodes: [], groupName: "", error: "GUID not found in sheet." });
          continue;
        }

        let groupRowAoa = -1;
        for (let r = guidRowAoa - 1; r >= headerRowIndex + 1; r--) {
          const row = aoa[r] ?? [];
          const g = String(row[idxGuid] ?? "").trim();
          const ifc = String(row[idxIfcType] ?? "").trim();
          const name = String(row[idxName] ?? "").trim();
          if (!g && !ifc && !!name) { groupRowAoa = r; break; }
        }
        if (groupRowAoa < 0) {
          plans.push({ guid: change.guid, cleanedCodes, guidRowAoa, groupRowAoa: -1, litteraRowsAoa: [], beforeCodes: [], groupName: "", error: "Group summary row not found." });
          continue;
        }

        const litteraRowsAoa: number[] = [];
        for (let r = groupRowAoa + 1; r < guidRowAoa; r++) {
          if (isMeasurementDataLitteraRow(aoa[r] ?? [], idxGuid, idxIfcType, idxName, idxTalo, idxLitteraCode, idxLitteraName, idxLitteraCategory, idxUnit, idxQuantity, idxRelevance)) {
            litteraRowsAoa.push(r);
          }
        }

        const groupName = String((aoa[groupRowAoa] ?? [])[idxName] ?? "");
        const beforeCodes = litteraRowsAoa.map((r) => String((aoa[r] ?? [])[idxLitteraCode] ?? "").trim());

        if (litteraRowsAoa.length === 0) {
          plans.push({ guid: change.guid, cleanedCodes, guidRowAoa, groupRowAoa, litteraRowsAoa: [], beforeCodes: [], groupName, error: "No Littera rows found in group block." });
          continue;
        }

        plans.push({ guid: change.guid, cleanedCodes, guidRowAoa, groupRowAoa, litteraRowsAoa, beforeCodes, groupName });
      }

      // ── PHASE 2: build result (dryRun or write) ──
      const buildDryRunEntry = (p: GuidPlan) => {
        if (p.error) return { guid: p.guid, groupName: p.groupName, ok: false, error: p.error };
        const extraRows = Math.max(0, p.litteraRowsAoa.length - p.cleanedCodes.length);
        return {
          guid: p.guid,
          groupName: p.groupName,
          groupRow: p.groupRowAoa + 1,
          guidRow: p.guidRowAoa + 1,
          beforeCodes: p.beforeCodes,
          requestedCodes: p.cleanedCodes,
          willOverwriteRows: Math.min(p.cleanedCodes.length, p.litteraRowsAoa.length),
          // inplace: extra rows are cleared in-place (no row count change, format preserved)
          // v2: extra rows are deleted (may corrupt Excel outline/grouping)
          willClearRows: effectiveMode === "inplace" ? extraRows : 0,
          willInsertRows: effectiveMode === "inplace" ? 0 : Math.max(0, p.cleanedCodes.length - p.litteraRowsAoa.length),
          willDeleteRows: effectiveMode === "v2" ? extraRows : 0,
          structureSafe: effectiveMode === "inplace",
          ok: true,
        };
      };

      if (dryRun === true) {
        const results = plans.map(buildDryRunEntry);
        const ok = results.filter((r) => r.ok);
        const errs = results.filter((r) => !r.ok);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              dryRun: true,
              mode: effectiveMode,
              inputPath: fullInputPath,
              sheet: usedSheetName,
              totalChanges: changes.length,
              successCount: ok.length,
              errorCount: errs.length,
              results,
              summary: {
                allStructureSafe: ok.every((r: any) => r.structureSafe),
                totalWillOverwriteRows: ok.reduce((s: number, r: any) => s + (r.willOverwriteRows ?? 0), 0),
                totalWillClearRows: ok.reduce((s: number, r: any) => s + (r.willClearRows ?? 0), 0),
                totalWillInsertRows: ok.reduce((s: number, r: any) => s + (r.willInsertRows ?? 0), 0),
                totalWillDeleteRows: ok.reduce((s: number, r: any) => s + (r.willDeleteRows ?? 0), 0),
              },
            }, null, 2),
          }],
        };
      }

      // ── PHASE 3: write — copy to temp, ExcelJS, apply all plans, write, copy back ──
      const tempDir = os.tmpdir();
      const tempId = `costa-batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const tempInputPath = path.join(tempDir, `${tempId}-in.xlsx`);
      const tempOutputPath = path.join(tempDir, `${tempId}-out.xlsx`);
      fs.copyFileSync(fullInputPath, tempInputPath);

      const ejWb = new ExcelJS.Workbook();
      try {
        await ejWb.xlsx.readFile(tempInputPath);
      } catch (readErr) {
        fs.rmSync(tempInputPath, { force: true });
        return { content: [{ type: "text" as const, text: `❌ ExcelJS could not read workbook: ${readErr instanceof Error ? readErr.message : String(readErr)}` }], isError: true };
      }

      const ejWs = ejWb.getWorksheet(usedSheetName);
      if (!ejWs) {
        fs.rmSync(tempInputPath, { force: true });
        return { content: [{ type: "text" as const, text: `❌ Worksheet "${usedSheetName}" not found.` }], isError: true };
      }
      const batchWs = ejWs!;

      const litteraCols = {
        litteraCode: idxLitteraCode, litteraName: idxLitteraName, litteraCategory: idxLitteraCategory,
        unit: idxUnit, quantity: idxQuantity, relevance: idxRelevance,
      };

      // Build catalog lookup map for name/category/unit enrichment
      const batchCatalogAll = loadLitteraCatalog();
      const batchCatalogMap = new Map<string, any>(
        batchCatalogAll.map((e: any) => [String(e?.littera ?? "").trim(), e])
      );
      const writeLitteraRow = (ws: ExcelJS.Worksheet, row1: number, code: string) => {
        excelJsSetCell(ws, row1, idxLitteraCode + 1, code);
        const entry = batchCatalogMap.get(code);
        if (entry) {
          if (idxLitteraName >= 0) excelJsSetCell(ws, row1, idxLitteraName + 1, String(entry.description ?? ""));
          if (idxLitteraCategory >= 0) excelJsSetCell(ws, row1, idxLitteraCategory + 1, String(entry.category ?? ""));
          if (idxUnit >= 0) excelJsSetCell(ws, row1, idxUnit + 1, String(entry.unit ?? ""));
        }
      };

      let rowOffset = 0;
      const writeResults: any[] = [];

      for (const plan of plans) {
        if (plan.error) { writeResults.push({ guid: plan.guid, groupName: plan.groupName, ok: false, error: plan.error }); continue; }

        let insertedRows = 0;
        let clearedRows = 0;
        let deletedRows = 0;

        if (effectiveMode === "inplace") {
          // SAFE inplace: NEVER insert or delete rows — only overwrite cell values.
          // Extra rows (more existing than needed) get Littera Code cleared in place.
          // This is the only mode that preserves Excel row grouping/outline metadata.
          const existingRows1 = plan.litteraRowsAoa.map((r) => r + 1 + rowOffset);

          for (let i = 0; i < existingRows1.length; i++) {
            if (i < plan.cleanedCodes.length) {
              writeLitteraRow(batchWs, existingRows1[i]!, plan.cleanedCodes[i]!);
            } else {
              // Clear only the Littera Code cell — keep the row intact.
              clearLitteraColumnsExcelJs(batchWs, existingRows1[i]!, litteraCols);
              clearedRows++;
            }
          }
          // rowOffset never changes in inplace mode (no row count changes).
        } else {
          let targetRows1 = plan.litteraRowsAoa.map((r) => r + 1 + rowOffset);
          let guidRow1 = plan.guidRowAoa + 1 + rowOffset;
          const baseTemplateRow1 = targetRows1[0]!;

          if (plan.cleanedCodes.length > targetRows1.length) {
            for (let i = 0; i < plan.cleanedCodes.length - targetRows1.length; i++) {
              batchWs.spliceRows(guidRow1, 0, []);
              const ins = batchWs.getRow(guidRow1);
              const tpl = batchWs.getRow(baseTemplateRow1);
              ins.height = tpl.height;
              tpl.eachCell({ includeEmpty: true }, (cell, col) => { const c = ins.getCell(col); c.style = { ...cell.style }; c.value = null; });
              excelJsSetCell(batchWs, guidRow1, idxIfcType + 1, (tpl.getCell(idxIfcType + 1).value as string | number | null) ?? "");
              excelJsSetCell(batchWs, guidRow1, idxName + 1, (tpl.getCell(idxName + 1).value as string | number | null) ?? "");
              if (idxTalo >= 0) excelJsSetCell(batchWs, guidRow1, idxTalo + 1, (tpl.getCell(idxTalo + 1).value as string | number | null) ?? "");
              excelJsSetCell(batchWs, guidRow1, idxLitteraCode + 1, "");
              targetRows1.push(guidRow1); guidRow1++; insertedRows++; rowOffset++;
            }
          }
          if (plan.cleanedCodes.length < targetRows1.length) {
            for (let i = 0; i < targetRows1.length - plan.cleanedCodes.length; i++) {
              const rowToDelete = targetRows1[targetRows1.length - 1]!;
              batchWs.spliceRows(rowToDelete, 1);
              targetRows1.pop();
              if (rowToDelete < guidRow1) guidRow1--;
              deletedRows++; rowOffset--;
            }
          }
          for (let i = 0; i < targetRows1.length; i++) {
            const code = plan.cleanedCodes[i] ?? "";
            if (code) {
              writeLitteraRow(batchWs, targetRows1[i]!, code);
            } else {
              excelJsSetCell(batchWs, targetRows1[i]!, idxLitteraCode + 1, "");
            }
          }
        }

        writeResults.push({ guid: plan.guid, groupName: plan.groupName, afterCodes: plan.cleanedCodes, insertedRows, clearedRows, deletedRows, structureSafe: true, ok: true });
      }

      await ejWb.xlsx.writeFile(tempOutputPath);
      fs.copyFileSync(tempOutputPath, finalOutputPath);
      fs.rmSync(tempInputPath, { force: true });
      fs.rmSync(tempOutputPath, { force: true });

      const successCount = writeResults.filter((r) => r.ok).length;
      const errorCount = writeResults.filter((r) => !r.ok).length;

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ok: errorCount === 0,
            mode: effectiveMode,
            inputPath: fullInputPath,
            outputPath: finalOutputPath,
            sheet: usedSheetName,
            totalChanges: changes.length,
            successCount,
            errorCount,
            results: writeResults,
            summary: {
              allStructureSafe: writeResults.filter((r) => r.ok).every((r) => r.structureSafe),
              totalInsertedRows: writeResults.reduce((s, r) => s + (r.insertedRows ?? 0), 0),
              totalDeletedRows: writeResults.reduce((s, r) => s + (r.deletedRows ?? 0), 0),
              totalClearedRows: writeResults.reduce((s, r) => s + (r.clearedRows ?? 0), 0),
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: "❌ Error in batch Littera write: " + (error instanceof Error ? error.message : String(error)) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_prepare_measurement_export",
  {
    title: "Costa: Prepare Measurement Export",
    description:
      "Runs mandatory safety checks before measurement export: validates active IFC/Store context, analyzes measurement-source coverage (BaseQuantities vs extraProperties), and returns available/default columns so the user can choose columns explicitly before exporting. Also returns dimensionalQuality from a bounded sample (stratified by IFC type when ids are not explicit): per-column coverage, per-IFC-type coverage, BQ vs Dimensions.* dual-source agreement and suspected unit-scaling (25.4/304.8/1000), optional slab/footing V/A plausibility, measurementAuditTrust counters (advisory JSON only — not written to bridge Excel), and short guidance for the user. Bridge Excel default = identity + IFC raw + Published + Cost units only.",
    inputSchema: z.object({
      ifcTypes: z.array(z.string()).optional().describe("Optional IFC types for scoped analysis."),
      ids: z.array(z.number()).optional().describe("Optional express IDs for scoped analysis."),
      sampleSize: z
        .number()
        .optional()
        .describe("Max elements in the preflight sample (default 50, cap 80). Smaller = fewer tokens/latency."),
      intendedQuantityKeys: z
        .array(z.string())
        .optional()
        .describe(
          "Quantity keys to score for coverage, e.g. [\"Perimeter\",\"NetArea\"]. If omitted, extraColumns keys and a default list are used."
        ),
      extraColumns: z
        .array(
          z.object({
            key: z.string().describe("Column key, e.g. doorColor"),
            header: z.string().optional().describe("Column header, e.g. Door Color"),
          })
        )
        .optional()
        .describe("Optional extra columns expected in the final export."),
    }),
  },
  async ({ ifcTypes, ids, extraColumns, sampleSize, intendedQuantityKeys }) => {
    try {
      const prep = await buildMeasurementExportPreparation(ifcTypes, ids, extraColumns, {
        sampleSize,
        intendedQuantityKeys,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, ...prep }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error preparing measurement export: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_list_export_provenance",
  {
    title: "Costa: List Export Provenance Records",
    description:
      "Lists persisted measurement-export provenance records (IFC source + extraction routes + output context) so Claude can keep IFC-to-Excel context stable across sessions.",
    inputSchema: z.object({
      limit: z.number().optional().describe("Max records to return (default 20, max 100)."),
      excelPathContains: z.string().optional().describe("Optional case-insensitive filter by exported excel path."),
      ifcPathContains: z.string().optional().describe("Optional case-insensitive filter by IFC source path."),
    }),
  },
  async ({ limit, excelPathContains, ifcPathContains }) => {
    try {
      const max = Math.max(1, Math.min(Number(limit ?? 20), 100));
      const qExcel = String(excelPathContains ?? "").trim().toLowerCase();
      const qIfc = String(ifcPathContains ?? "").trim().toLowerCase();
      let rows = readProvenanceStore();
      if (qExcel) {
        rows = rows.filter((r) => JSON.stringify(r.appResult ?? {}).toLowerCase().includes(qExcel));
      }
      if (qIfc) {
        rows = rows.filter((r) => String(r.ifcPath ?? "").toLowerCase().includes(qIfc));
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, total: rows.length, rows: rows.slice(0, max) }, null, 2) }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: "❌ Error listing export provenance: " + (error instanceof Error ? error.message : String(error)) }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_export_measurement_excel",
  {
    title: "Costa: Export Measurement Excel",
    description:
      "Exports Costa BRIDGE measurement Excel (IFC raw → Published → Cost units), same as IFC Measurement Excel panel. Building scope via ids or ifcTypes. Omitting selectedColumns uses the bridge preset automatically. Requires CostStore; if empty tell user Cost → Send to Quantities & Cost. allowIfcRaw:true = IFC-only escape (not the bridge).",
    inputSchema: z.object({
      ifcTypes: z.array(z.string()).optional().describe("IFC types to filter before export, e.g. [\"IfcDoor\"]"),
      ids: z.array(z.number()).optional().describe("Express IDs to export (recommended; avoids scanning)."),
      filename: z.string().optional().describe("Output filename, e.g. doors-list.xlsx"),
      preparationId: z
        .string()
        .optional()
        .describe("Preparation id returned by costa_prepare_measurement_export. If omitted, MCP prepares automatically."),
      selectedColumns: z
        .array(z.string())
        .optional()
        .describe("Optional override. Omit to use bridge preset."),
      extraColumns: z
        .array(
          z.object({
            key: z.string().describe("Column key, e.g. doorColor"),
            header: z.string().optional().describe("Column header, e.g. Door Color"),
          })
        )
        .optional()
        .describe("Optional extra columns appended to Excel."),
      extraValuesById: z
        .record(
          z.record(
            z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.null(),
              z.object({
                value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
                unit: z.any().optional(),
              }),
            ])
          )
        )
        .optional()
        .describe(
          "Optional values keyed by expressId or GlobalId string. Supports scalar values directly, and also {value, unit} objects (auto-unwrapped to scalar). Example: {\"11291\":{\"doorColor\":\"Blue\"}}"
        ),
      allowIfcRaw: z
        .boolean()
        .optional()
        .describe("If true: IFC-raw format when user declined CostStore."),
    }),
  },
  async ({ ifcTypes, ids, filename, preparationId, selectedColumns, extraColumns, extraValuesById, allowIfcRaw }) => {
    try {
      return await executeMeasurementExcelExport({
        ifcTypes,
        ids,
        filename,
        preparationId,
        selectedColumns,
        extraColumns,
        extraValuesById,
        bridgePreset: allowIfcRaw !== true,
        ifcRawOnly: allowIfcRaw === true,
      });
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error exporting measurement Excel: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_select_elements",
  {
    title: "Costa: Select Elements (MCP auto)",
    description:
      "Highlights elements by express ID using the MCP automation channel (cost-select, blue). Does NOT write the live selection bag (3D click/lasso) — so Element Search scope is unchanged. visualMode: ghost (default, transparency), isolate (Hider only, no blue paint), or none. Use costa_get_viewer_selection to read liveBag vs autoSelection vs searchCatalog.",
    inputSchema: z.object({
      ids: z.array(z.number()).min(1).describe("Express IDs of elements"),
      visualMode: z
        .enum(["ghost", "isolate", "none"])
        .optional()
        .describe("ghost (default) | isolate (Hider) | none (paint only)"),
    }),
  },
  async ({ ids, visualMode }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_select_elements",
        ids,
        visualMode,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error selecting elements in Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_get_viewer_selection",
  {
    title: "Costa: Get Viewer Selection State",
    description:
      "Returns the full Model/Selection state: liveBag (3D pick), searchCatalog (Element Search checkboxes), autoSelection (MCP/cost-select), preview (search-preview), groupAddMode, treeScope (Model Tree isolate), and effectiveForSaveGroup (live + catalog). Requires IFCViewer mounted with a loaded model.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const msg = await sendJsonToFirstClient({ type: "costa_get_viewer_selection" });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error reading viewer selection: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_list",
  {
    title: "Costa: List Named Groups",
    description:
      "Lists CostaBIM named selection groups (name + expressIds) from the same document as the UI / localStorage (costa.namedGroups.v1). Does not read IfcGroup from the IFC file. IFC must be loaded for member resolution in follow-up tools.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const msg = await sendJsonToFirstClient({ type: "costa_groups_list" });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error listing Costa groups: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_create",
  {
    title: "Costa: Create Named Group",
    description:
      "Creates a CostaBIM named group (name + expressIds). Fails if the name already exists. " +
      "To build an EXCLUDE / garbage selection of any IFC types, create that group here (or in the UI), " +
      "then call costa_groups_create_complement to get the inverse selection (loaded IFC minus that group).",
    inputSchema: z.object({
      name: z.string().describe("Unique Costa group name"),
      expressIds: z
        .array(z.number())
        .min(1)
        .describe("IFC expressIds for group members"),
    }),
  },
  async ({ name, expressIds }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_groups_create",
        name,
        expressIds,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error creating Costa group: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_update",
  {
    title: "Costa: Update Named Group",
    description:
      "Updates an existing CostaBIM named group by groupId or groupName. Provide a new name and/or expressIds. At least one field must change. Same document as UI / localStorage.",
    inputSchema: z.object({
      groupId: z.string().optional().describe("Costa group id (cg-…)"),
      groupName: z.string().optional().describe("Exact current Costa group name"),
      name: z.string().optional().describe("New group name"),
      expressIds: z
        .array(z.number())
        .optional()
        .describe("New member expressIds (replaces entire list)"),
    }),
  },
  async ({ groupId, groupName, name, expressIds }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_groups_update",
        groupId,
        groupName,
        name,
        expressIds,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error updating Costa group: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_get_members",
  {
    title: "Costa: Get Group Members (IFC)",
    description:
      "Resolves members of a CostaBIM named group against the IFC loaded in IFCViewer. Returns expressId, globalId, ifcType, name, description, floor from IFC (read-only). Provide groupId or groupName.",
    inputSchema: z.object({
      groupId: z.string().optional().describe("Costa group id (cg-…)"),
      groupName: z.string().optional().describe("Exact Costa group name"),
    }),
  },
  async ({ groupId, groupName }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_groups_get_members",
        groupId,
        groupName,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error getting group members: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_extract",
  {
    title: "Costa: Extract Group Data (IFC)",
    description:
      "Selective IFC read for a CostaBIM named group: member identity + optional base quantities and property sets from the loaded model. Does not use CostStore and does not write IFC.",
    inputSchema: z.object({
      groupId: z.string().optional().describe("Costa group id (cg-…)"),
      groupName: z.string().optional().describe("Exact Costa group name"),
      includeBaseQuantities: z
        .boolean()
        .optional()
        .describe("Include IFC quantity sets (default true)"),
      includeProperties: z
        .boolean()
        .optional()
        .describe("Include IfcPropertySingleValue from Psets (default true)"),
      psetNameContains: z
        .string()
        .optional()
        .describe("Optional substring filter on Pset names"),
      maxMembers: z
        .number()
        .optional()
        .describe("Safety cap on rows (default 500, max 2000)"),
    }),
  },
  async ({
    groupId,
    groupName,
    includeBaseQuantities,
    includeProperties,
    psetNameContains,
    maxMembers,
  }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_groups_extract",
        groupId,
        groupName,
        includeBaseQuantities,
        includeProperties,
        psetNameContains,
        maxMembers,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error extracting group data: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_select",
  {
    title: "Costa: Highlight Costa Group (MCP auto)",
    description:
      "Highlights a CostaBIM named group via cost-select (blue MCP channel). Does NOT write liveBag. visualMode ghost (default) | isolate (Hider only, same as Groups panel Isolate — no blue orphan). Provide groupId or groupName.",
    inputSchema: z.object({
      groupId: z.string().optional().describe("Costa group id (cg-…)"),
      groupName: z.string().optional().describe("Exact Costa group name"),
      visualMode: z
        .enum(["ghost", "isolate", "none"])
        .optional()
        .describe("ghost (default) | isolate (Hider) | none"),
    }),
  },
  async ({ groupId, groupName, visualMode }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_groups_select",
        groupId,
        groupName,
        visualMode,
        isolate: visualMode === "isolate",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error selecting Costa group: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_create_complement",
  {
    title: "Costa: Inverse Selection (IFC minus CostaBIM group)",
    description:
      "INVERSE SELECTION for Claude MCP. Takes one or more existing CostaBIM groups as an EXCLUDE selection " +
      "(any mix of IFC types — plates, members, openings, hardware, etc.) and creates a new group with every " +
      "element in the loaded IFC that is NOT in that selection. " +
      "Default: universe = entire loaded IFC file. " +
      "Optional ifcTypes: only if the user asks to invert inside specific types after excluding the group. " +
      "Do NOT assume the exclude group is a single IFC type. Respond in the user's language.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("Name for the new inverse-selection group (IFC minus exclude)"),
      excludeGroupId: z
        .string()
        .optional()
        .describe("CostaBIM group id to exclude from the IFC (cg-…)"),
      excludeGroupName: z
        .string()
        .optional()
        .describe("Exact CostaBIM group name to exclude from the IFC"),
      excludeGroupIds: z
        .array(z.string())
        .optional()
        .describe("Exclude several CostaBIM groups by id"),
      excludeGroupNames: z
        .array(z.string())
        .optional()
        .describe("Exclude several CostaBIM groups by exact name"),
      ifcTypes: z
        .array(z.string())
        .optional()
        .describe(
          "OPTIONAL. Only when the user wants the inverse inside specific IFC types. Omit = whole loaded IFC minus the exclude group(s)."
        ),
    }),
  },
  async ({
    name,
    excludeGroupId,
    excludeGroupName,
    excludeGroupIds,
    excludeGroupNames,
    ifcTypes,
  }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_groups_create_complement",
        name,
        excludeGroupId,
        excludeGroupName,
        excludeGroupIds,
        excludeGroupNames,
        ifcTypes,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(extractResult(msg)) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error creating inverse selection Costa group: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

const costaGroupsExportScopeSchema = {
  groupId: z.string().optional().describe("Costa group id (cg-…). Export one group."),
  groupName: z.string().optional().describe("Exact Costa group name. Export one group."),
  exportAllGroups: z
    .boolean()
    .optional()
    .describe("If true, export every Costa named group from localStorage in one Excel."),
};

server.registerTool(
  "costa_groups_prepare_measurement_export",
  {
    title: "Costa: Prepare Groups Measurement Export",
    description:
      "Prepares Costa BRIDGE measurement Excel for named groups (IFC raw dims → PublishedQuantity/Unit → Cost units JM/M2/…). Same format as IFC Measurement Excel panel. Requires CostStore: if empty, tell user to click Cost → Send to Quantities & Cost (IFC already loaded — do not ask to open IFC). If user declines, retry export with allowIfcRaw:true. defaultColumns = bridge preset — Claude should export without asking column menus. Respond in the user's language; UI labels stay English.",
    inputSchema: z.object({
      ...costaGroupsExportScopeSchema,
      sampleSize: z.number().optional().describe("Preflight sample size (default 50, max 80)."),
      intendedQuantityKeys: z
        .array(z.string())
        .optional()
        .describe("Quantity keys to score in dimensionalQuality preflight."),
      allowIfcRaw: z
        .boolean()
        .optional()
        .describe("If true, allow prepare when CostStore is empty (IFC-raw path)."),
    }),
  },
  async ({ groupId, groupName, exportAllGroups, sampleSize, intendedQuantityKeys, allowIfcRaw }) => {
    try {
      const storeGate = await assertCostStoreReadyForGroupsExport({ allowIfcRaw });
      const scope = await resolveCostaGroupsExportScope({ groupId, groupName, exportAllGroups });
      if (storeGate.ifcRawOnly) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              format: "ifc_raw",
              storeReady: false,
              defaultColumns: [...BRIDGE_IFC_RAW_HEADERS],
              availableColumns: [...BRIDGE_IFC_RAW_HEADERS, COSTA_GROUP_EXPORT_COLUMN_HEADER],
              groupsScope: {
                groupCount: scope.groups.length,
                groups: scope.groups.map((g) => ({
                  id: g.id,
                  name: g.name,
                  memberCount: g.expressIds.length,
                })),
                resolvedIds: scope.ids.length,
              },
              suggestedFilename: defaultGroupsExportFilename(scope),
              notes: [
                "CostStore empty — IFC-raw format only (no Published / Cost units).",
                "Call costa_groups_export_measurement_excel with allowIfcRaw:true.",
              ],
            }, null, 2),
          }],
        };
      }
      const prep = await buildMeasurementExportPreparation(
        undefined,
        scope.ids,
        [{ key: COSTA_GROUP_EXPORT_COLUMN_KEY, header: COSTA_GROUP_EXPORT_COLUMN_HEADER }],
        { sampleSize, intendedQuantityKeys }
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            format: "costa_bridge",
            ...prep,
            groupsScope: {
              groupCount: scope.groups.length,
              groups: scope.groups.map((g) => ({
                id: g.id,
                name: g.name,
                memberCount: g.expressIds.length,
              })),
              resolvedIds: scope.ids.length,
            },
            suggestedFilename: defaultGroupsExportFilename(scope),
            notes: [
              "Bridge preset is default — export without asking the user which columns.",
              "CostaBIM Group column is added automatically; omit it from selectedColumns.",
              "Order: IFC raw → Published* → Cost units. No TALO/Littera in bridge.",
              "File downloads in the browser.",
            ],
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text:
            "❌ Error preparing groups measurement export: " +
            (error instanceof Error ? error.message : String(error)),
        }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_groups_export_measurement_excel",
  {
    title: "Costa: Export Groups to Measurement Excel",
    description:
      "Exports Costa groups as Costa BRIDGE Excel (IFC raw → Published → Cost units), same as IFC Measurement Excel panel. Default: auto bridge columns (do not ask column menus). Requires CostStore unless allowIfcRaw:true. If store empty: tell user Cost → Send to Quantities & Cost; if they decline, retry with allowIfcRaw:true. Filename = group name. Downloads in Costa browser tab.",
    inputSchema: z.object({
      ...costaGroupsExportScopeSchema,
      filename: z.string().optional().describe("Output filename, e.g. costa-grupos.xlsx"),
      preparationId: z
        .string()
        .optional()
        .describe("Preparation id from costa_groups_prepare_measurement_export."),
      selectedColumns: z
        .array(z.string())
        .optional()
        .describe("Optional override. Omit to use bridge preset automatically."),
      extraColumns: z
        .array(
          z.object({
            key: z.string(),
            header: z.string().optional(),
          })
        )
        .optional(),
      allowIfcRaw: z
        .boolean()
        .optional()
        .describe("If true and CostStore empty: IFC-raw Excel (not the Costa bridge)."),
    }),
  },
  async ({
    groupId,
    groupName,
    exportAllGroups,
    filename,
    preparationId,
    selectedColumns,
    extraColumns,
    allowIfcRaw,
  }) => {
    try {
      const storeGate = await assertCostStoreReadyForGroupsExport({ allowIfcRaw });
      const scope = await resolveCostaGroupsExportScope({ groupId, groupName, exportAllGroups });
      return await executeMeasurementExcelExport({
        ids: scope.ids,
        filename,
        preparationId,
        selectedColumns,
        extraColumns,
        groupsScope: scope,
        bridgePreset: !storeGate.ifcRawOnly,
        ifcRawOnly: storeGate.ifcRawOnly,
      });
    } catch (error) {
      return {
        content: [{
          type: "text",
          text:
            "❌ Error exporting Costa groups to measurement Excel: " +
            (error instanceof Error ? error.message : String(error)),
        }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_get_ontelolaatta_report",
  {
    title: "Costa: Get Ontelolaatta Report",
    description:
      "Returns hollow-core slab (ontelolaatta / Oxx IfcSlab) orientation data collected in IFCViewer: span length, nominal width (1.2 m), piece count, areas, and confirmation status. Data comes from the isolated ontelolaattaMcp slice in CostStore (does not modify Littera or costData). Requires the user to select Oxx slabs in IFCViewer and optionally confirm direction with Rotate 90° / Confirm direction.",
    inputSchema: z.object({
      confirmedOnly: z
        .boolean()
        .optional()
        .describe(
          "If true (default), return only user-confirmed entries. Set false to include pending orientations."
        ),
    }),
  },
  async ({ confirmedOnly }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_get_ontelolaatta_report",
        confirmedOnly,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error getting ontelolaatta report: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_filter_and_select_elements",
  {
    title: "Costa: Filter and Select Elements (MCP auto)",
    description:
      "Filters elements in the loaded IFC (same filters as costa_get_elements) and highlights matches via cost-select (MCP channel). Does NOT write liveBag. respectTreeScope: when true, restricts the query to Model Tree mwVisualScopeIds (if any). visualMode: ghost (default) | isolate | none.",
    inputSchema: z.object({
      ifcType: z.string().optional().describe("Exact IFC type, lowercase ok, e.g. ifcbeam"),
      nameContains: z.string().optional().describe("Case-insensitive substring for element name"),
      globalId: z.string().optional().describe("Exact IFC GlobalId"),
      maxResults: z.number().optional().describe("Safety limit (default 2000)"),
      respectTreeScope: z
        .boolean()
        .optional()
        .describe("If true, filter only within Model Tree visual scope (when set)"),
      visualMode: z
        .enum(["ghost", "isolate", "none"])
        .optional()
        .describe("ghost (default) | isolate | none"),
    }),
  },
  async ({ ifcType, nameContains, globalId, maxResults, respectTreeScope, visualMode }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_filter_and_select_elements",
        ifcType,
        nameContains,
        globalId,
        maxResults,
        respectTreeScope,
        visualMode,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error filtering/selecting elements: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_reset_viewer_visual_state",
  {
    title: "Costa: Reset Viewer Visual State",
    description:
      "Resets parts of the Model/Selection visual state. All flags default to false (no-op). Typical MCP cleanup: autoAndPreviewPaint=true clears cost-select + search-preview; searchFilters=true clears search fields/hits (keeps catalog); hider=true runs Show All; treeScope=true clears Model Tree isolate; searchCatalog=true clears checkbox catalog; groupAddMode=true exits group add mode; liveSelection=true clears 3D live bag and all paint.",
    inputSchema: z.object({
      hider: z.boolean().optional().describe("Hider.set(true) — Show All visibility"),
      liveSelection: z.boolean().optional().describe("Clear live bag + all paint channels"),
      treeScope: z.boolean().optional().describe("Reset Model Tree visual scope"),
      searchCatalog: z.boolean().optional().describe("Clear Element Search checkbox catalog"),
      searchFilters: z.boolean().optional().describe("Clear search filter fields and hit list"),
      groupAddMode: z.boolean().optional().describe("Exit Costa group add mode"),
      autoAndPreviewPaint: z
        .boolean()
        .optional()
        .describe("Clear cost-select + search-preview only (keeps live bag)"),
    }),
  },
  async (opts) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_reset_viewer_visual_state",
        options: opts,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error resetting viewer visual state: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_apply_cost_codes",
  {
    title: "Costa: Apply TALO/Littera Codes",
    description:
      "Applies accepted TALO/Littera suggestions into CostPage (CostStore) by element id. Supports one Littera or a related Littera series per element. Use only after user confirmation.",
    inputSchema: z.object({
      assignments: z
        .array(
          z.object({
            id: z.number().describe("Element id in CostStore"),
            taloCode: z.string().optional().describe("Optional TALO code to apply"),
            litteraCode: z.string().optional().describe("Optional Littera code to add/apply"),
            litteraName: z.string().optional().describe("Littera description/name"),
            litteraCategory: z.string().nullable().optional().describe("Littera category"),
            litteraUnit: z.string().optional().describe("Littera unit, e.g. m2, m3, kpl, ***"),
            litteraSeries: z
              .array(
                z.object({
                  litteraCode: z.string().describe("Littera code in the related series"),
                  litteraName: z.string().optional().describe("Littera description/name"),
                  litteraCategory: z.string().nullable().optional().describe("Littera category"),
                  litteraUnit: z.string().optional().describe("Littera unit"),
                })
              )
              .optional()
              .describe("Optional related Littera series to apply (one-to-many)."),
            mode: z.enum(["append", "replace"]).optional().describe("For Littera: append (default) or replace existing"),
            allowTaloChange: z
              .boolean()
              .optional()
              .describe("If true, tool is allowed to overwrite existing taloCode. If omitted/false, taloCode is never changed."),
            allowLitteraReplace: z
              .boolean()
              .optional()
              .describe("If true, tool is allowed to use mode='replace' for Littera. If omitted/false, replace is rejected."),
          })
        )
        .min(1)
        .describe("Accepted assignments to apply"),
    }),
  },
  async ({ assignments }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_apply_cost_codes",
        assignments,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error applying accepted cost-code suggestions in Costa app: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_confirm_layer_assembly",
  {
    title: "Costa: Confirm facade layer grouping",
    description:
      "After costa_scan_elements_for_talo shows layerAssembly.required, ask the user to group exploded Tekla sandwich layers. action=accept saves the grouping in the Costa session. Then write Talo 1241 only to hosts with costa_write_ifc_classifications — that write also stamps Pset_CostaAssembly on hosts and layers into the IFC copy. Reject measures each wall separately. This tool does not write the IFC.",
    inputSchema: z.object({
      action: z
        .enum(["accept", "reject"])
        .optional()
        .describe("accept (default) applies grouping; reject measures each wall separately."),
      hostNames: z
        .array(z.string())
        .optional()
        .describe("Names that carry the facade paño. Default: KUORIELEMENTTI."),
      layerNames: z
        .array(z.string())
        .optional()
        .describe("Composition names that must not add extra facade M2. Default: SISÄKUORI, ERISTE, KOOLAUS, PAROC, plates."),
      otherNames: z
        .array(z.string())
        .optional()
        .describe("Same IfcWall type but a different määrä line (PUUVERHOUS, VÄLISEINÄ, ERISTE+RUNKO…)."),
    }),
  },
  async ({ action, hostNames, layerNames, otherNames }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_confirm_layer_assembly",
        action: action ?? "accept",
        hostNames,
        layerNames,
        otherNames,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text:
              "❌ Error confirming layer assembly: " +
              (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_scan_elements_for_talo",
  {
    title: "Costa: Scan IFC model elements grouped by type for Talo assignment",
    description:
      "FIRST step of Talo 2000 henkinimikkeistö on a loaded IFC. Returns groups by IFC type (nameVariants, nameCounts, existing Talo). ALSO returns layerAssembly: if Tekla (or unknown origin) exported exploded sandwich layers (KUORIELEMENTTI + ERISTE/SISÄKUORI/…), layerAssembly.required is true — STOP and ask the user to group BEFORE any Talo table or IFC write. Then costa_confirm_layer_assembly. After accept, costa_write_ifc_classifications (manual, autoAssign false) writes Talo AND Pset_CostaAssembly into the IFC copy. Does NOT write anything itself.",
    inputSchema: z.object({
      ifcTypes: z
        .array(z.string())
        .optional()
        .describe("Limit scan to these IFC types (e.g. ['IfcDoor','IfcWall']). Omit to scan all."),
      maxResults: z
        .number()
        .optional()
        .describe("Max number of IFC type groups to return (default 200)."),
    }),
  },
  async ({ ifcTypes, maxResults }) => {
    try {
      const msg = await sendJsonToFirstClient({
        type: "costa_scan_elements_for_talo",
        ifcTypes,
        maxResults,
      });
      return {
        content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg, null, 2) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: "❌ Error scanning elements: " + (error instanceof Error ? error.message : String(error)),
          },
        ],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "costa_write_ifc_classifications",
  {
    title: "Costa: Write Talo/Littera classifications to IFC and export modified file",
    description:
      "Writes Talo 2000 IfcClassificationReference (+ optional Littera pset) into a NEW IFC copy — the original is never modified.\n\nIf the user accepted exploded-sandwich grouping (costa_confirm_layer_assembly), this write ALSO stamps Pset_CostaAssembly (LayerRole host/layer/other) on all IfcWalls matching the recipe. Later writes skip walls that already have the pset. Layers do not receive façade Talo.\n\nALWAYS dryRun:true first. Never autoAssign for Costa Talo process.",
    inputSchema: z.object({
      autoAssign: z
        .boolean()
        .optional()
        .describe("If true (default when elements not provided): auto-scan all CostStore elements and suggest the best Talo code from talo2000.json for each. Groups results by IFC type for review."),
      ifcTypes: z
        .array(z.string())
        .optional()
        .describe("In autoAssign mode: limit scan to these IFC types (e.g. ['IfcDoor','IfcWall']). Omit to scan all."),
      minConfidence: z
        .number()
        .optional()
        .describe("In autoAssign mode: minimum suggestion confidence to include (0–1, default 0.7)."),
      skipExisting: z
        .boolean()
        .optional()
        .describe("In autoAssign mode: if true (default), skip elements that already have a Talo code in CostStore."),
      elements: z
        .array(
          z.object({
            expressId: z.number().optional().describe("Express ID of the element"),
            globalId: z.string().optional().describe("GlobalId (GUID) of the element"),
            taloCode: z.string().optional().describe("Talo 2000 code (e.g. '1231' or '1.2.3.1')"),
            taloName: z.string().optional().describe("Talo 2000 name (optional)"),
            litteraCode: z.string().optional().describe("Littera code (e.g. '436160')"),
            litteraName: z.string().optional().describe("Littera name (optional)"),
            litteraCategory: z.string().optional().describe("Littera category (optional)"),
            layerRole: z
              .enum(["host", "layer", "other"])
              .optional()
              .describe("Sandwich role. If layer, Talo is not written on this element."),
          })
        )
        .optional()
        .describe("Manual mode: explicit element list. Each element needs at least one of expressId or globalId."),
      assembly: z
        .object({
          confirmed: z.boolean(),
          assemblyKey: z.string().optional(),
          hostNames: z.array(z.string()).optional(),
          layerNames: z.array(z.string()).optional(),
          otherNames: z.array(z.string()).optional(),
        })
        .optional()
        .describe("If confirmed, stamp Pset_CostaAssembly on all matching IfcWalls. If omitted, Costa ping is used when the viewer still has a confirmed grouping."),
      elementsFilePath: z
        .string()
        .optional()
        .describe("Absolute path to a JSON file containing manual elements[] payload. Used when payload is too large to inline."),
      outputFilename: z
        .string()
        .optional()
        .describe("Output IFC filename (default: <original>-costa-classified.ifc)"),
      dryRun: z
        .boolean()
        .optional()
        .describe("If true (default): only validates and returns a grouped report — no file written. Set false after user confirms."),
      ifcFilePath: z
        .string()
        .optional()
        .describe("Absolute path to the source IFC file for server-side writing. Defaults to the last file loaded via costa_load_ifc."),
    }),
  },
  async ({ autoAssign, ifcTypes, minConfidence, skipExisting, elements, elementsFilePath, outputFilename, dryRun, ifcFilePath, assembly }) => {
    const isDryRun = dryRun !== false;
    let resolvedElements = elements;

    if ((!resolvedElements || !resolvedElements.length) && elementsFilePath) {
      try {
        if (!path.isAbsolute(elementsFilePath)) {
          return {
            content: [{ type: "text", text: "❌ elementsFilePath debe ser una ruta absoluta." }],
            isError: true,
          };
        }
        if (!fs.existsSync(elementsFilePath)) {
          return {
            content: [{ type: "text", text: `❌ Archivo elementsFilePath no encontrado: ${elementsFilePath}` }],
            isError: true,
          };
        }
        const raw = fs.readFileSync(elementsFilePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return {
            content: [{ type: "text", text: "❌ elementsFilePath debe contener un JSON array." }],
            isError: true,
          };
        }
        resolvedElements = parsed;
        logStderr(`[IFC Write] Loaded ${resolvedElements.length} elements from file: ${elementsFilePath}`);
      } catch (error) {
        return {
          content: [{ type: "text", text: "❌ Error leyendo elementsFilePath: " + (error instanceof Error ? error.message : String(error)) }],
          isError: true,
        };
      }
    }

    // ── Solo dryRun: delegar siempre al browser ──
    if (isDryRun) {
      try {
        const msg = await sendJsonToFirstClient({
          type: "costa_write_ifc_classifications",
          autoAssign: autoAssign !== false && !resolvedElements?.length,
          ifcTypes,
          minConfidence,
          skipExisting,
          elements: resolvedElements,
          outputFilename,
          dryRun: true,
        });
        return {
          content: [{ type: "text", text: JSON.stringify((msg as any).result ?? msg, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: "❌ Error en dryRun: " + (error instanceof Error ? error.message : String(error)) }],
          isError: true,
        };
      }
    }

    // ── Escritura real (dryRun:false): corre en el servidor Node.js ──
    try {
      // Si autoAssign:true pero no hay elements, obtenerlos del browser vía dryRun scan
      let writeElements = resolvedElements ?? [];
      if ((!writeElements.length) && (autoAssign !== false)) {
        logStderr("[IFC Write] autoAssign:true — obteniendo elements del browser vía dryRun scan…");
        const inputPath = ifcFilePath ?? lastLoadedIfcPath;
        if (!inputPath) {
          return {
            content: [{ type: "text", text: "❌ Para autoAssign server-side necesitas llamar costa_load_ifc primero (o pasar ifcFilePath)." }],
            isError: true,
          };
        }
        const scanMsg = await sendJsonToFirstClient({
          type: "costa_write_ifc_classifications",
          autoAssign: true,
          ifcTypes,
          minConfidence,
          skipExisting,
          dryRun: true,
          returnElements: true, // browser incluirá la lista completa de elements
        });
        const scanResult = (scanMsg as any).result ?? scanMsg;
        if (!scanResult?.ok) {
          return {
            content: [{ type: "text", text: "❌ Error en scan autoAssign: " + (scanResult?.error ?? "sin detalles") }],
            isError: true,
          };
        }
        writeElements = Array.isArray(scanResult.elements) ? scanResult.elements : [];
        if (!writeElements.length) {
          return {
            content: [{ type: "text", text: JSON.stringify({ ok: false, error: "El scan no devolvió elementos asignables.", autoSummary: scanResult.autoSummary }, null, 2) }],
            isError: true,
          };
        }
        logStderr(`[IFC Write] Scan returned ${writeElements.length} elements. Proceeding with server-side write.`);
      }

      if (!writeElements.length) {
        return {
          content: [{ type: "text", text: "❌ Para dryRun:false debes pasar elements[] con expressId/globalId y taloCode, o usar autoAssign:true." }],
          isError: true,
        };
      }

      // Reasignar para que el bloque siguiente lo use
      elements = writeElements;

      const inputPath = ifcFilePath ?? lastLoadedIfcPath;
      if (!inputPath) {
        return {
          content: [{ type: "text", text: "❌ No hay archivo IFC de origen. Llama costa_load_ifc primero, o pasa ifcFilePath explícitamente." }],
          isError: true,
        };
      }
      if (!fs.existsSync(inputPath)) {
        return {
          content: [{ type: "text", text: `❌ Archivo IFC no encontrado: ${inputPath}` }],
          isError: true,
        };
      }

      const baseName = path.basename(inputPath, ".ifc");
      const outFilename = outputFilename ?? `${baseName}-costa-classified.ifc`;
      const outPath = path.join(path.dirname(inputPath), outFilename);

      logStderr(`[IFC Write] Abriendo ${inputPath} con web-ifc (Node)…`);
      let assemblyRecipe: AssemblyWriteRecipe | null = assembly?.confirmed ? assembly : null;
      if (!assemblyRecipe?.confirmed) {
        try {
          const pingMsg = await sendJsonToFirstClient({ type: "costa_ping_store_connection" });
          const cur = (pingMsg as any)?.result?.layerAssembly?.current;
          if (cur?.confirmed === true) {
            assemblyRecipe = {
              confirmed: true,
              assemblyKey: cur.assemblyKey,
              hostNames: cur.hostNames,
              layerNames: cur.layerNames,
              otherNames: cur.otherNames,
            };
            logStderr("[IFC Write] Using confirmed layerAssembly from Costa store.");
          }
        } catch {
          logStderr("[IFC Write] No Costa ping for layerAssembly; Talo-only write.");
        }
      }
      const result = await writeIfcClassificationsServerSide(inputPath, writeElements, assemblyRecipe);

      if (result.written === 0 && result.assemblyStamped === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, written: 0, failed: result.failed, errors: result.errors }),
          }],
          isError: true,
        };
      }

      fs.writeFileSync(outPath, Buffer.from(result.outputBuffer));
      lastLoadedIfcPath = outPath;
      logStderr(`[IFC Write] Guardado: ${outPath}`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            written: result.written,
            failed: result.failed,
            outputPath: outPath,
            assemblyStamped: result.assemblyStamped,
            assemblySkipped: result.assemblySkipped,
            assemblyError: result.assemblyError,
            errors: result.errors.length > 0 ? result.errors : undefined,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: "❌ Error escribiendo IFC: " + (error instanceof Error ? error.message : String(error)),
        }],
        isError: true,
      };
    }
  }
);

let isShuttingDown = false;
async function shutdownWebSocket() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  releaseCostaMcpInstanceLock();
  const current = ws;
  ws = null;
  if (!current) return;
  await new Promise<void>((resolve) => {
    current.close(() => resolve());
  });
}

process.on("SIGINT", () => {
  shutdownWebSocket().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  shutdownWebSocket().finally(() => process.exit(0));
});
process.on("exit", () => {
  releaseCostaMcpInstanceLock();
  try {
    ws?.close();
  } catch {
    // ignore
  }
});

async function startBridgeWebSocket(): Promise<void> {
  if (bridgeRole !== "primary") {
    logStderr(`[Costa MCP] Secondary stdio only — browser bridge on primary (port ${PORT}).`);
    return;
  }
  try {
    ws = await createWebSocketServerWithRetry(PORT, 4);
    attachBridgeRelayServer(ws, sendJsonToBrowserClient, logStderr);
  } catch (error) {
    logStderr(
      `[Costa MCP] WebSocket bridge failed on port ${PORT}: ${String(error)}. ` +
        `Browser-linked tools will fail until restart; catalog/Excel tools still work.`
    );
    ws = null;
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
await startBridgeWebSocket();
