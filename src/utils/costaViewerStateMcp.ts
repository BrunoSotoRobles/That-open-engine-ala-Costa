/**
 * MCP / WebSocket viewer state — aligned with Model/Selection UI contract.
 *
 * Channels:
 * - liveBag (select) — 3D click/lasso
 * - searchCatalog — Element Search checkboxes (Save group)
 * - autoSelection (cost-select) — MCP + Costa group highlight
 * - preview (search-preview) — Search row inspect
 */

import { getExpressIdsFromFragmentIdMap, countFragmentIdMap } from "./ifcElementQuery";
import {
  clearPaintChannelAsync,
  getLastPaintStyle,
  getLiveSelection,
  getPaintChannelMap,
  paintChannel,
} from "./viewerSelection";

export type FragmentIdMap = Record<string, Set<number>>;

export type CostaViewerIdBag = {
  count: number;
  ids: number[];
};

export type CostaGroupAddModeState = {
  activeId: string | null;
  pendingAddIds: number[];
};

export type CostaViewerSelectionState = {
  ok: boolean;
  error?: string;
  /** 3D click/lasso — highlighter.selection.select */
  liveBag: CostaViewerIdBag;
  /** Element Search checkboxes — persists across queries */
  searchCatalog: CostaViewerIdBag;
  /** MCP / group automation — cost-select paint channel */
  autoSelection: CostaViewerIdBag;
  /** Search row preview — search-preview channel */
  preview: CostaViewerIdBag;
  /** Manual paint — select channel (may mirror liveBag) */
  manualPaint: CostaViewerIdBag;
  groupAddMode: CostaGroupAddModeState;
  treeScope: CostaViewerIdBag | null;
  lastPaintChannel: string | null;
  /** Union used by Save group (live + search catalog) */
  effectiveForSaveGroup: CostaViewerIdBag;
  notes: string[];
};

export type CostaResetViewerVisualOptions = {
  /** Hider.set(true) — default true */
  hider?: boolean;
  /** clearLiveSelectionAsync — live bag + all paint channels */
  liveSelection?: boolean;
  /** resetTreeVisualScopeRef — Model Tree scope */
  treeScope?: boolean;
  /** Clear Element Search checkbox catalog */
  searchCatalog?: boolean;
  /** Clear search filter fields + hit list (keeps catalog unless searchCatalog) */
  searchFilters?: boolean;
  /** exitGroupAddMode */
  groupAddMode?: boolean;
  /** clearPaintChannel cost-select + search-preview only (no live bag) */
  autoAndPreviewPaint?: boolean;
};

declare global {
  interface Window {
    __costaGetViewerSelectionState?: () => CostaViewerSelectionState;
    __costaResetViewerVisualState?: (
      opts?: CostaResetViewerVisualOptions
    ) => Promise<void>;
    __costaSetGhostMode?: (enabled: boolean, selectedFragmentIds?: Set<string>) => void;
    __costaGetTreeScopeIds?: () => number[] | null;
    __costaSearchSelectionIds?: () => number[];
    __costaExitGroupAddMode?: () => Promise<void>;
    __costaHiderIsolate?: (map: Record<string, Set<number>>) => void;
  }
}

function bag(ids: number[]): CostaViewerIdBag {
  const unique = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n)))];
  return { count: unique.length, ids: unique };
}

function mergeBags(...parts: number[][]): CostaViewerIdBag {
  const merged: number[] = [];
  for (const p of parts) merged.push(...p);
  return bag(merged);
}

/** Read full viewer selection state for MCP (window hooks + facade). */
export function buildCostaViewerSelectionState(): CostaViewerSelectionState {
  const notes: string[] = [];

  if (typeof window === "undefined") {
    return {
      ok: false,
      error: "Not in browser context.",
      liveBag: bag([]),
      searchCatalog: bag([]),
      autoSelection: bag([]),
      preview: bag([]),
      manualPaint: bag([]),
      groupAddMode: { activeId: null, pendingAddIds: [] },
      treeScope: null,
      lastPaintChannel: null,
      effectiveForSaveGroup: bag([]),
      notes,
    };
  }

  const liveBag = bag(getExpressIdsFromFragmentIdMap(getLiveSelection()));
  const searchCatalog = bag(window.__costaSearchSelectionIds?.() ?? []);
  const autoSelection = bag(
    getExpressIdsFromFragmentIdMap(getPaintChannelMap("cost-select"))
  );
  const preview = bag(getExpressIdsFromFragmentIdMap(getPaintChannelMap("search-preview")));
  const manualPaint = bag(getExpressIdsFromFragmentIdMap(getPaintChannelMap("select")));

  const groupMode = (window as any).__costaGroupMode?.() as
    | CostaGroupAddModeState
    | undefined;
  const groupAddMode: CostaGroupAddModeState = {
    activeId: groupMode?.activeId ?? null,
    pendingAddIds: (groupMode?.pendingAddIds ?? []).map(Number),
  };

  const treeIds = window.__costaGetTreeScopeIds?.() ?? null;
  const treeScope = treeIds && treeIds.length > 0 ? bag(treeIds) : null;

  const effectiveForSaveGroup = mergeBags(liveBag.ids, searchCatalog.ids);

  if (searchCatalog.count > 0) {
    notes.push(
      "searchCatalog is not included in Element Search query scope (only treeScope + 3D pick)."
    );
  }
  if (autoSelection.count > 0) {
    notes.push("autoSelection = cost-select channel (MCP / group highlight).");
  }
  if (groupAddMode.activeId) {
    notes.push("groupAddMode active — 3D clicks accumulate pendingAddIds for Update.");
  }

  return {
    ok: true,
    liveBag,
    searchCatalog,
    autoSelection,
    preview,
    manualPaint,
    groupAddMode,
    treeScope,
    lastPaintChannel: getLastPaintStyle(),
    effectiveForSaveGroup,
    notes,
  };
}

/**
 * MCP / Costa group highlight — cost-select channel, does NOT write the live bag
 * (avoids narrowing Element Search scope).
 */
export async function applyMcpAutoSelectionVisual(
  selection: FragmentIdMap,
  visualMode: "ghost" | "isolate" | "none" = "ghost"
): Promise<void> {
  if (countFragmentIdMap(selection) === 0) return;

  if (visualMode === "isolate") {
    const exitAdd = (window as any).__costaExitGroupAddMode as (() => Promise<void>) | undefined;
    if (exitAdd) await exitAdd();

    const hiderApply = (window as any).__costaHiderIsolate as
      | ((map: FragmentIdMap) => void)
      | undefined;
    if (hiderApply) {
      hiderApply(selection);
    }
    await clearPaintChannelAsync("cost-select");
    window.__costaSetGhostMode?.(false);
    return;
  }

  paintChannel("cost-select", selection);
  if (visualMode === "ghost") {
    window.__costaSetGhostMode?.(true, new Set(Object.keys(selection)));
  } else {
    window.__costaSetGhostMode?.(false);
  }
}

/** @deprecated Use buildCostaViewerSelectionState — kept for older bridge call sites. */
export function getViewerSelectionSnapshotLegacy(): {
  ok: boolean;
  error?: string;
  count: number;
  ids: number[];
  fragmentIdMap: Record<string, number[]>;
} {
  const state = buildCostaViewerSelectionState();
  const ids = state.effectiveForSaveGroup.ids;
  const fragmentIdMap: Record<string, number[]> = {};
  for (const [frag, set] of Object.entries(getLiveSelection())) {
    fragmentIdMap[frag] = [...set].map(Number);
  }
  if (!state.ok) {
    return { ok: false, error: state.error, count: 0, ids: [], fragmentIdMap: {} };
  }
  return {
    ok: true,
    count: ids.length,
    ids,
    fragmentIdMap,
  };
}
