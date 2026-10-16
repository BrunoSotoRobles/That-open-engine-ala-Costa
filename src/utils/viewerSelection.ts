/**
 * CostaBIM layer-A selection facade (That Open 2.4).
 *
 * Product channels (paint style):
 * - `select`         — MANUAL (3D click, lasso)
 * - `search-preview` — PREVIEW (Element Search row, Model Tree)
 * - `cost-select`    — AUTO (Groups, MCP, basket→live, cost highlight event)
 *
 * Live ID bag:
 * - `highlighter.selection.select` always holds the current live FragmentIdMap
 *   so Property / Edit / Isolate toolbar / Save group can read one place.
 * - That bag is NOT the paint channel. After preview/auto, `selection.select`
 *   still has IDs; paint comes from highlightByID(channelStyle).
 *
 * Safety (empirical v2.4): never call highlighter.clear() / highlightByID(style, {}).
 * Reversibility: window.__costaSelectionV2 = false disables anchor merge.
 */

import {
  cloneFragmentIdMap,
  countFragmentIdMap,
  mergeFragmentIdMaps,
} from "./ifcElementQuery";

export type FragmentIdMap = Record<string, Set<number>>;

export type LiveSelectionSource = "pick" | "criteria" | "preview";

export type SelectionPaintStyle = "select" | "search-preview" | "cost-select" | string;

export interface SetLiveSelectionOptions {
  source: LiveSelectionSource;
  /** Highlighter paint style; defaults by source. */
  style?: SelectionPaintStyle;
  /**
   * When true and V2 is on, merge current live into the new map before write
   * (anchor ⊆ new live). Opt-in — used by MCP A2, not by box/Groups/preview.
   */
  mergeAnchor?: boolean;
}

type HighlighterLike = {
  selection: { select: FragmentIdMap; [style: string]: FragmentIdMap };
  enabled?: boolean;
  highlightByID?: (
    style: string,
    map: FragmentIdMap,
    removePrevious?: boolean,
    zoomToSelection?: boolean
  ) => unknown;
  /** Named clear restores fragment colors; bare clear() is unsafe in 2.4. */
  clear?: (name?: string, filter?: FragmentIdMap) => void;
  events?: {
    select?: {
      onHighlight?: { trigger: (map: FragmentIdMap) => void };
      onClear?: { trigger: (map?: FragmentIdMap) => void };
    };
  };
};

type GhostPainter = (enabled: boolean, selectedFragmentIds?: Set<string>) => void;

const DEFAULT_STYLE: Record<LiveSelectionSource, SelectionPaintStyle> = {
  pick: "select",
  criteria: "cost-select",
  preview: "search-preview",
};

const CHANNEL_ROLE: Record<string, string> = {
  select: "MANUAL (clic / lazo)",
  "search-preview": "PREVIEW (Search / Tree)",
  "cost-select": "AUTO (Groups / MCP / cesta→live)",
};

let highlighterRef: HighlighterLike | null = null;
let ghostPainter: GhostPainter | null = null;
let setExternalFlag: ((value: boolean) => void) | null = null;
/** Last style passed to highlightByID (paint channel). */
let lastPaintStyle: SelectionPaintStyle | null = null;

declare global {
  interface Window {
    __costaSelectionV2?: boolean;
    __costaLastPaintStyle?: string | null;
    costaSelectionAudit?: () => Record<string, unknown>;
    applyViewerSelection?: (
      styleName: string,
      selection: FragmentIdMap,
      clearPrevious?: boolean
    ) => void;
    clearViewerSelection?: () => void;
  }
}

/** Default on. Set window.__costaSelectionV2 = false to disable V2 behaviours. */
export function isSelectionV2Enabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.__costaSelectionV2 !== false;
}

export function isFragmentIdMapEmpty(
  selection: FragmentIdMap | undefined | null
): boolean {
  if (!selection) return true;
  const keys = Object.keys(selection);
  if (keys.length === 0) return true;
  return keys.every((key) => {
    const ids = selection[key];
    return !ids || ids.size === 0;
  });
}

export function registerHighlighter(highlighter: HighlighterLike | null): void {
  highlighterRef = highlighter;
}

export function registerGhostPainter(painter: GhostPainter | null): void {
  ghostPainter = painter;
}

/** Marks programmatic writes so native onHighlight can skip custom-style cleanup. */
export function registerExternalSelectionFlag(
  setter: ((value: boolean) => void) | null
): void {
  setExternalFlag = setter;
}

export function getLiveSelection(): FragmentIdMap {
  const select = highlighterRef?.selection?.select;
  if (!select) return {};
  return cloneFragmentIdMap(select);
}

export function getLastPaintStyle(): SelectionPaintStyle | null {
  return lastPaintStyle;
}

/** Native 3D click path (Highlighter), not the facade. */
export function noteNativeSelectPaint(): void {
  lastPaintStyle = "select";
  if (typeof window !== "undefined") {
    window.__costaLastPaintStyle = "select";
  }
}

export function resolveSourceFromStyle(styleName: string): LiveSelectionSource {
  if (styleName === "search-preview") return "preview";
  if (styleName === "select") return "pick";
  return "criteria";
}

export function mergeAnchorInto(
  criteriaMap: FragmentIdMap,
  anchor?: FragmentIdMap
): FragmentIdMap {
  const base = anchor ?? getLiveSelection();
  if (isFragmentIdMapEmpty(base)) return cloneFragmentIdMap(criteriaMap);
  return mergeFragmentIdMaps(base, criteriaMap);
}

function applyGhostForMap(selection: FragmentIdMap): void {
  if (!ghostPainter) return;
  if (isFragmentIdMapEmpty(selection)) {
    ghostPainter(false);
  } else {
    ghostPainter(true, new Set(Object.keys(selection)));
  }
}

const PAINT_CHANNELS = ["select", "search-preview", "cost-select"] as const;

function nudgeViewerRender(): void {
  if (typeof window === "undefined") return;
  try {
    const world = (window as { worldRef?: { renderer?: { three?: { render?: () => void } } } })
      .worldRef;
    world?.renderer?.three?.render?.();
  } catch {
    /* noop */
  }
}

/**
 * Restore mesh colors for other paint styles without bare highlighter.clear().
 *
 * `selection.select` is the live ID bag, not a disposable paint map. The lime
 * snapshot must be taken before the caller overwrites that slot. After That Open
 * finishes clear(), restore `liveBag` unless a newer native click already replaced it.
 */
function clearSiblingPaintChannels(
  highlighter: HighlighterLike,
  keepStyle: string,
  liveBag: FragmentIdMap,
  selectPaintSnapshot?: FragmentIdMap,
  preserveStyles: readonly string[] = []
): void {
  for (const style of PAINT_CHANNELS) {
    if (style === keepStyle) continue;
    if (preserveStyles.includes(style)) continue;
    const isLiveBagSlot = style === "select";
    const original = highlighter.selection?.[style];
    const snapshot = isLiveBagSlot
      ? cloneFragmentIdMap(selectPaintSnapshot ?? original ?? {})
      : cloneFragmentIdMap(original ?? {});
    if (countFragmentIdMap(snapshot) === 0) {
      if (!isLiveBagSlot && highlighter.selection[style]) {
        highlighter.selection[style] = {};
      }
      continue;
    }
    void Promise.resolve(highlighter.clear?.(style, snapshot))
      .catch(() => {
        /* noop */
      })
      .finally(() => {
        if (isLiveBagSlot) {
          const current = highlighter.selection.select;
          if (
            current &&
            current !== original &&
            countFragmentIdMap(current) > 0
          ) {
            return;
          }
          highlighter.selection.select = cloneFragmentIdMap(liveBag);
          return;
        }
        if (highlighter.selection?.[style] === original) {
          highlighter.selection[style] = {};
        }
      });
  }
}

function countMap(map: FragmentIdMap | undefined | null): number {
  return countFragmentIdMap(map ?? {});
}

/** Read a paint-channel map (not the live bag at selection.select). */
export function getPaintChannelMap(styleName: string): FragmentIdMap {
  const map = highlighterRef?.selection?.[styleName];
  if (!map) return {};
  return cloneFragmentIdMap(map);
}

/**
 * Clear one Highlighter paint channel (mesh tint + style map).
 * Awaits That Open updateColors(); pass snapshot so IDs are not lost if map is emptied early.
 * Does not touch the live bag, ghost, or Hider — use clearLiveSelection for full reset.
 */
export async function clearPaintChannelAsync(styleName: string): Promise<void> {
  const highlighter = highlighterRef;
  if (!highlighter) return;

  const original = highlighter.selection?.[styleName];
  const snapshot = getPaintChannelMap(styleName);
  if (countFragmentIdMap(snapshot) === 0) {
    if (highlighter.selection?.[styleName]) {
      highlighter.selection[styleName] = {};
    }
    return;
  }

  try {
    await Promise.resolve(highlighter.clear?.(styleName, snapshot));
  } catch {
    /* style missing / not set up yet */
  }

  // Same guard as clearSiblingPaintChannels: never clobber a newer write.
  if (highlighter.selection?.[styleName] === original) {
    highlighter.selection[styleName] = {};
  }
  if (lastPaintStyle === styleName) {
    lastPaintStyle = null;
    if (typeof window !== "undefined") {
      window.__costaLastPaintStyle = null;
    }
  }
  nudgeViewerRender();
}

/** Fire-and-forget wrapper around {@link clearPaintChannelAsync}. */
export function clearPaintChannel(styleName: string): void {
  void clearPaintChannelAsync(styleName);
}

/**
 * Safe write to live selection. Never calls bare highlighter.clear().
 * Paints with `style`; always updates live ID bag at selection.select.
 * Clears sibling paint channels so cost-select / preview tints cannot stack.
 */
export function setLiveSelection(
  map: FragmentIdMap,
  options: SetLiveSelectionOptions
): FragmentIdMap {
  const highlighter = highlighterRef;
  if (!highlighter) return {};

  let next = cloneFragmentIdMap(map);
  if (options.mergeAnchor === true && isSelectionV2Enabled()) {
    next = mergeAnchorInto(next);
  }

  const styleName = options.style ?? DEFAULT_STYLE[options.source];
  lastPaintStyle = styleName;
  if (typeof window !== "undefined") {
    window.__costaLastPaintStyle = styleName;
  }

  const selectPaintSnapshot = cloneFragmentIdMap(highlighter.selection?.select ?? {});
  highlighter.selection.select = next;
  clearSiblingPaintChannels(highlighter, styleName, next, selectPaintSnapshot);

  // removePrevious=true: replace style contents (same as a non-additive native commit)
  try {
    Promise.resolve(
      highlighter.highlightByID?.(styleName, next, true, false) as Promise<unknown>
    ).catch(() => {});
  } catch {
    /* noop */
  }

  // Re-assert after highlightByID in case it aliased onto the select slot.
  highlighter.selection.select = next;
  setExternalFlag?.(true);
  try {
    highlighter.events?.select?.onHighlight?.trigger(next);
  } catch {
    applyGhostForMap(next);
  }
  setExternalFlag?.(false);

  return next;
}

/**
 * Paint a Highlighter style without writing the live ID bag.
 * Costa groups use this: blue tint is not a Property / Element Search selection.
 */
export function paintChannel(styleName: string, map: FragmentIdMap): FragmentIdMap {
  const highlighter = highlighterRef;
  if (!highlighter) return {};

  const next = cloneFragmentIdMap(map);
  const live = cloneFragmentIdMap(highlighter.selection?.select ?? {});
  const selectPaintSnapshot = live;

  lastPaintStyle = styleName;
  if (typeof window !== "undefined") {
    window.__costaLastPaintStyle = styleName;
  }

  clearSiblingPaintChannels(highlighter, styleName, live, selectPaintSnapshot);

  try {
    Promise.resolve(
      highlighter.highlightByID?.(styleName, next, true, false) as Promise<unknown>
    ).catch(() => {});
  } catch {
    /* noop */
  }

  highlighter.selection.select = live;
  return next;
}

/**
 * Orange Search preview — does not clear the lime `select` channel or the live bag.
 */
export function paintPreviewChannel(map: FragmentIdMap): FragmentIdMap {
  const highlighter = highlighterRef;
  if (!highlighter) return {};

  const next = cloneFragmentIdMap(map);
  const live = cloneFragmentIdMap(highlighter.selection?.select ?? {});
  const selectPaintSnapshot = live;

  lastPaintStyle = "search-preview";
  if (typeof window !== "undefined") {
    window.__costaLastPaintStyle = "search-preview";
  }

  clearSiblingPaintChannels(highlighter, "search-preview", live, selectPaintSnapshot, [
    "select",
  ]);

  try {
    Promise.resolve(
      highlighter.highlightByID?.("search-preview", next, true, false) as Promise<unknown>
    ).catch(() => {});
  } catch {
    /* noop */
  }

  highlighter.selection.select = live;
  return next;
}

/**
 * Manual selection visual tail — same as native click / Shift batch after IDs exist:
 * highlightByID("select") then onHighlight → ghost.
 * Caller must ensure Highlighter.enabled === true so tint is applied before ghost snapshots it.
 */
export async function applyManualSelectVisual(
  map: FragmentIdMap
): Promise<FragmentIdMap> {
  const highlighter = highlighterRef;
  if (!highlighter || isFragmentIdMapEmpty(map)) return {};

  const next = cloneFragmentIdMap(map);
  lastPaintStyle = "select";
  if (typeof window !== "undefined") {
    window.__costaLastPaintStyle = "select";
  }

  highlighter.selection.select = next;
  clearSiblingPaintChannels(highlighter, "select", next);

  try {
    await Promise.resolve(
      highlighter.highlightByID?.("select", next, true, false) as Promise<unknown>
    );
  } catch {
    /* noop */
  }

  highlighter.selection.select = next;
  setExternalFlag?.(true);
  try {
    highlighter.events?.select?.onHighlight?.trigger(next);
  } catch {
    applyGhostForMap(next);
  }
  setExternalFlag?.(false);

  return next;
}

/**
 * Clear layer-A live selection + ghost + paint channels.
 * Uses named highlighter.clear(style) so fragment colors reset (emptying
 * selection[style] alone leaves mesh tints). Does not call bare clear().
 * Does not touch Hider or basket B.
 */
export async function clearLiveSelectionAsync(): Promise<void> {
  if (!isSelectionV2Enabled()) {
    ghostPainter?.(false);
    return;
  }

  const highlighter = highlighterRef;
  const empty: FragmentIdMap = {};

  if (highlighter) {
    for (const style of PAINT_CHANNELS) {
      const snapshot = cloneFragmentIdMap(highlighter.selection?.[style] ?? {});
      if (countFragmentIdMap(snapshot) > 0) {
        try {
          await Promise.resolve(highlighter.clear?.(style, snapshot));
        } catch {
          /* style missing / not set up yet */
        }
      }
      if (highlighter.selection[style]) {
        highlighter.selection[style] = {};
      }
    }
    highlighter.selection.select = empty;
    setExternalFlag?.(true);
    try {
      highlighter.events?.select?.onClear?.trigger(empty);
    } catch {
      /* noop */
    }
    setExternalFlag?.(false);
  }

  lastPaintStyle = null;
  if (typeof window !== "undefined") {
    window.__costaLastPaintStyle = null;
  }
  ghostPainter?.(false);
  nudgeViewerRender();
}

export function clearLiveSelection(): void {
  void clearLiveSelectionAsync();
}

/**
 * Bridge for window.applyViewerSelection / legacy call sites.
 * `select` → pick; `search-preview` → preview; else → criteria (cost-select / MCP).
 */
export function applyViewerSelectionBridge(
  styleName: string,
  selection: FragmentIdMap,
  _clearPrevious = true,
  opts?: { mergeAnchor?: boolean }
): FragmentIdMap {
  void _clearPrevious;
  return setLiveSelection(selection, {
    source: resolveSourceFromStyle(styleName),
    style: styleName,
    mergeAnchor: opts?.mergeAnchor === true,
  });
}

/** Console-friendly audit: paint channel vs live bag vs per-style maps. */
export function buildSelectionAudit(): Record<string, unknown> {
  const h = highlighterRef;
  const liveN = countMap(h?.selection?.select);
  const paint = lastPaintStyle;
  const styles = ["select", "search-preview", "cost-select"] as const;
  const channels: Record<string, { role: string; mapN: number }> = {};
  for (const s of styles) {
    channels[s] = {
      role: CHANNEL_ROLE[s] ?? s,
      mapN: countMap(h?.selection?.[s]),
    };
  }

  return {
    paintChannel: paint,
    paintRole: paint ? CHANNEL_ROLE[paint] ?? paint : null,
    liveBagN: liveN,
    note:
      "liveBagN = IDs for Property/Edit (always on selection.select). paintChannel = last highlightByID style. mapN may lag async highlightByID.",
    channels,
    okHint:
      paint === "select"
        ? "Expect MANUAL (clic/lazo)"
        : paint === "search-preview"
          ? "Expect PREVIEW (Search/Tree)"
          : paint === "cost-select"
            ? "Expect AUTO (Groups/MCP/cesta)"
            : "No paint yet",
  };
}

export function installViewerSelectionGlobals(): void {
  if (typeof window === "undefined") return;
  window.applyViewerSelection = (
    styleName: string,
    selection: FragmentIdMap,
    clearPrevious = true
  ) => {
    applyViewerSelectionBridge(styleName, selection, clearPrevious);
  };
  (window as any).applyViewerSelectionWithAnchor = (
    styleName: string,
    selection: FragmentIdMap
  ) => {
    applyViewerSelectionBridge(styleName, selection, true, { mergeAnchor: true });
  };
  window.clearViewerSelection = () => {
    clearLiveSelection();
  };
  (window as any).clearCostaPaintChannel = (styleName = "cost-select") =>
    clearPaintChannelAsync(styleName);
  window.costaSelectionAudit = () => {
    const report = buildSelectionAudit();
    console.log("%c[Costa selection audit]", "font-weight:bold;color:#42a5f5");
    console.log(report);
    return report;
  };
}

export function uninstallViewerSelectionGlobals(): void {
  if (typeof window === "undefined") return;
  delete window.applyViewerSelection;
  delete window.clearViewerSelection;
  delete (window as any).clearCostaPaintChannel;
  delete (window as any).applyViewerSelectionWithAnchor;
  delete window.costaSelectionAudit;
  delete window.__costaLastPaintStyle;
}

export { countFragmentIdMap, cloneFragmentIdMap, mergeFragmentIdMaps };
