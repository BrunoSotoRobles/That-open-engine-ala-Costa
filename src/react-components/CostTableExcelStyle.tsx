import * as React from "react";
import { createPortal } from "react-dom";
import type { Language } from "../stores/CostStore";
import type { BaseCostElement, LitteraEntry } from "../types/cost";
import { getTranslation } from "../locales/costAnalysis";
import { expandTaloCode, isValidTalo2000Code } from "../constants/talo2000";
import {
  normalizeRevitName,
  getUnitsForIFCType,
  calculateBaseQuantitiesByUnitForElements,
  buildGroupedData,
  pickAssemblyGroupLead,
  assemblyHostCount,
  groupMaaraAreaM2,
  groupMaaraVolumeM3,
  groupMaaraLengthM,
} from "../utils/costTableGrouping";
import { contributesToMaara } from "../utils/layerAssemblyPolicy";
import { suggestTaloAssignments } from "../services/TaloSuggestionService";
import { suggestLitteraAssignments } from "../services/LitteraSuggestionService";
import { useLitteraDict } from "../hooks/useLitteraDict";
import { useCostStore } from "../stores/CostStore";
import {
  isConfirmedOntelolaattaElement,
  litteraCodesForConfirmedOntelolaatta,
} from "../utils/ontelolaattaLitteraPackage";

const HEADER_BG = "#4472C4";
const HEADER_TEXT = "#ffffff";
/** Same as Excel: group row fill */
const GROUP_ROW_BG = "#DCE6F1";
/** Tamaño y estilo de fuente unificado para celdas e inputs de la tabla (igual que CSS 10px) */
const TABLE_FONT_SIZE = 10;
const GROUP_ROW_TEXT = "#0d1b2a";
const DETAIL_ROW_BG = "var(--surface-2)";
const DETAIL_ROW_TEXT = "var(--text-1)";
const BORDER = "1px solid var(--border)";

/** TALO: 4 segmentos numéricos en formato x.x.x.x (p. ej. 1.2.3.4) */
function isValidTaloFormat(code: string): boolean {
  const trimmed = code.trim();
  return /^\d+\.\d+\.\d+\.\d+$/.test(trimmed);
}

/** Littera: 6 dígitos; acepta x.x.x.x.x.x o 350010. Devuelve solo dígitos (máx. 6). */
function normalizeLitteraCode(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

function isValidLitteraFormat(input: string): boolean {
  return normalizeLitteraCode(input).length === 6;
}

function isLitteraCodeInDict(normalized: string, dict: LitteraEntry[]): boolean {
  const n = normalized.replace(/\D/g, "");
  return dict.some(
    (e) => e.littera.replace(/\D/g, "") === n || e.littera === n
  );
}

type CostType = keyof BaseCostElement["costs"];

interface CostTableExcelStyleProps {
  language: Language;
  /** Datos efectivos que debe mostrar la tabla (costData + editedElements, etc.) */
  data: BaseCostElement[];
  /** Callback opcional para editar costes agregados por grupo */
  onEdit?: (elementId: number, costType: CostType, value: number) => void;
  /** Aplica un código TALO a un grupo de elementos (por id) */
  onApplySuggestionGroup: (elementIds: number[], taloCode: string) => void;
  /** Elimina un código Littera de un elemento */
  onRemoveLitteraCode: (elementId: number, litteraCode: string) => void;
  /** Actualiza la cantidad de un código Littera para un elemento */
  onUpdateLitteraCodeQuantity: (
    elementId: number,
    litteraCode: string,
    quantity: number
  ) => void;
  /** Añade un código Littera a un elemento */
  onAddLitteraCode: (
    elementId: number,
    litteraCode: string,
    litteraName: string,
    litteraCategory: string | null,
    unit: string
  ) => void;
  /** Elimina elementos del listado por IDs (tabla, Excel, cálculos) */
  onRemoveElements?: (ids: number[]) => void;
}

export function CostTableExcelStyle({
  language,
  data,
  onEdit,
  onApplySuggestionGroup,
  onRemoveLitteraCode,
  onUpdateLitteraCodeQuantity,
  onAddLitteraCode,
  onRemoveElements,
}: CostTableExcelStyleProps) {
  const costData = data ?? [];
  const canRemove = Boolean(onRemoveElements);

  const [collapsedTypes, setCollapsedTypes] = React.useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(new Set());
  const [addLitteraByGroup, setAddLitteraByGroup] = React.useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());

  const { elementsByType } = React.useMemo(
    () => buildGroupedData(costData),
    [costData]
  );

  const ontelolaattaMcpByGlobalId = useCostStore((s) => s.ontelolaattaMcp.byGlobalId);

  const { litteraDict, hasData: hasLitteraDict } = useLitteraDict();

  // Shared dropdown state for TALO y Littera (solo un grupo abierto a la vez)
  const [openTaloGroup, setOpenTaloGroup] = React.useState<string | null>(null);
  const [taloSuggestions, setTaloSuggestions] = React.useState<
    { taloCode: string; unit: string; rtName?: string }[]
  >([]);
  const [taloDropdownRect, setTaloDropdownRect] = React.useState<
    { left: number; top: number; bottom: number; width: number } | null
  >(null);
  const [taloDropdownContext, setTaloDropdownContext] = React.useState<{
    groupId: string;
    elements: BaseCostElement[];
  } | null>(null);
  const [openLitteraGroup, setOpenLitteraGroup] = React.useState<string | null>(null);
  const [litteraSuggestions, setLitteraSuggestions] = React.useState<
    { litteraCode: string; litteraName: string; unit: string; category?: string | null; confidence?: number }[]
  >([]);

  const allUnits = React.useMemo(() => {
    const set = new Set<string>();
    costData.forEach((el) => getUnitsForIFCType(el.type).forEach((u) => set.add(u)));
    return Array.from(set).sort();
  }, [costData]);

  // Cerrar dropdown de TALO al hacer scroll / resize / click fuera
  React.useEffect(() => {
    if (!openTaloGroup) return;
    const handleClose = () => {
      setOpenTaloGroup(null);
      setTaloSuggestions([]);
      setTaloDropdownRect(null);
      setTaloDropdownContext(null);
    };
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    window.addEventListener("mousedown", handleClose);
    return () => {
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
      window.removeEventListener("mousedown", handleClose);
    };
  }, [openTaloGroup]);

  // Solo colapsar en carga inicial (de 0 a tener datos). No colapsar al editar para no romper el flujo.
  const hasInitializedRef = React.useRef(false);
  React.useEffect(() => {
    if (costData.length === 0) {
      hasInitializedRef.current = false;
      return;
    }
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const allTypes = new Set(elementsByType.keys());
      const allGroups = new Set<string>();
      elementsByType.forEach((groupMap, ifcType) => {
        groupMap.forEach((_, groupKey) => allGroups.add(`${ifcType}|${groupKey}`));
      });
      setCollapsedTypes(allTypes);
      setCollapsedGroups(allGroups);
    }
  }, [costData.length, elementsByType]);

  const toggleType = (ifcType: string) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(ifcType)) next.delete(ifcType);
      else next.add(ifcType);
      return next;
    });
  };

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelection = (ids: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => prev.has(id));
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const isAllSelected = (ids: number[]) => ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const isSomeSelected = (ids: number[]) => ids.some((id) => selectedIds.has(id));

  const handleDeleteSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const msg = getTranslation(["actions", "deleteSelectedConfirm"], language).replace("{count}", String(ids.length));
    if (window.confirm(msg)) {
      onRemoveElements?.(ids);
      setSelectedIds(new Set());
    }
  };

  if (costData.length === 0) {
    return (
      <div style={{ padding: "2rem", color: "var(--text-2)", textAlign: "center" }}>
        {getTranslation(["noDataMessage"], language) || "No cost data. Load data from IFC or sample."}
      </div>
    );
  }

  // Same columns and order as Excel: 19 standard + unit_XXX
  const unitColumnLabels: { [u: string]: string } = {
    M2: "M2 (m²)", BRM2: "BRM2 (m²)", NM2: "NM2 (m²)",
    M3: "M3 (m³)", RM3: "RM3 (m³)", NM3: "NM3 (m³)",
    JM: "JM (m)", M: "M (m)", KG: "KG (kg)", KPL: "KPL (pcs)", ERÄ: "ERÄ (lot)", AS: "AS (m²)",
  };
  const standardColumns: { key: string; label: string; width: string; align?: "left" | "right" }[] = [
    ...(canRemove ? [{ key: "select", label: "", width: "32px" }] : []),
    { key: "ifcType", label: "IFC Type", width: "90px" },
    { key: "name", label: "Name", width: "140px" },
    { key: "globalId", label: "GUID", width: "120px" },
    { key: "taloCode", label: "TALO Code", width: "68px" },
    { key: "taloName", label: "TALO Name", width: "115px" },
    // Slightly wider Littera Code column so 6-digit codes are always fully visible
    { key: "litteraCode", label: "Littera Code", width: "84px" },
    { key: "litteraName", label: "Littera Name", width: "130px" },
    { key: "litteraCategory", label: "Littera Category", width: "92px" },
    { key: "unit", label: "Unit", width: "44px", align: "right" },
    { key: "quantity", label: "Quantity", width: "60px", align: "right" },
    { key: "relevanceScore", label: "Relevance Score", width: "72px", align: "right" },
    { key: "area", label: "Area (m²)", width: "62px", align: "right" },
    { key: "volume", label: "Volume (m³)", width: "66px", align: "right" },
    { key: "length", label: "Length (m)", width: "62px", align: "right" },
    { key: "materialCost", label: "Material Cost", width: "74px", align: "right" },
    { key: "laborCost", label: "Labor Cost", width: "74px", align: "right" },
    { key: "subcontractCost", label: "Subcontract Cost", width: "74px", align: "right" },
    { key: "totalCost", label: "Total Cost", width: "76px", align: "right" },
  ];
  const unitColumns = allUnits.map((u) => ({
    key: `unit_${u}`,
    label: unitColumnLabels[u] ?? u,
    width: "54px" as const,
    align: "right" as const,
  }));
  const columns = [...standardColumns, ...unitColumns];
  const totalCostColIndex = 17 + (canRemove ? 1 : 0); // 0-based index of Total Cost (shifted when select column present)

  const headerScrollRef = React.useRef<HTMLDivElement>(null);
  const bodyScrollRef = React.useRef<HTMLDivElement>(null);
  const onBodyScroll = React.useCallback(() => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (body && header) header.scrollLeft = body.scrollLeft;
  }, []);

  const tableStyle: React.CSSProperties = {
    width: "100%",
    minWidth: "1100px",
    tableLayout: "fixed",
    borderCollapse: "collapse",
    color: "var(--text-1)",
  };
  const thCellStyle: React.CSSProperties = {
    width: "auto",
    padding: "6px 6px",
    textAlign: "left",
    backgroundColor: HEADER_BG,
    color: HEADER_TEXT,
    fontWeight: 600,
    border: BORDER,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    boxSizing: "border-box",
  };

  return (
    <div
      className="cost-table-excel-style"
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        border: BORDER,
        borderRadius: "6px",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {canRemove && selectedIds.size > 0 && (
        <div style={{ padding: "6px 8px", borderBottom: BORDER, display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={handleDeleteSelected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "4px 10px",
              fontSize: TABLE_FONT_SIZE,
              background: "var(--error, #c62828)",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
            title={getTranslation(["actions", "deleteSelectedTitle"], language)}
          >
            <span className="material-icons-round" style={{ fontSize: 14 }}>delete</span>
            {getTranslation(["actions", "deleteSelected"], language)} ({selectedIds.size})
          </button>
        </div>
      )}
      {/* Encabezado fijo: siempre visible, scroll horizontal sincronizado con el body */}
      <div
        ref={headerScrollRef}
        className="cost-table-excel-header"
        style={{ overflowX: "auto", overflowY: "hidden", flexShrink: 0 }}
      >
        <table style={tableStyle}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  title={col.label}
                  style={{
                    ...thCellStyle,
                    width: col.width,
                    textAlign: (col.align ?? "left") as "left" | "right",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      {/* Body: único área con scroll vertical (y horizontal); encabezados siguen visibles arriba */}
      <div
        ref={bodyScrollRef}
        className="cost-table-excel-body"
        onScroll={onBodyScroll}
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
      >
        <table style={tableStyle}>
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
          </colgroup>
        <tbody>
          {Array.from(elementsByType.entries()).map(([ifcType, elementGroups]) => {
            const typeCollapsed = collapsedTypes.has(ifcType);
            const typeElementCount = Array.from(elementGroups.values()).reduce((s, arr) => s + arr.length, 0);
            const typeTotal = Array.from(elementGroups.values()).reduce((s, arr) => s + arr.reduce((t, el) => t + el.costs.total, 0), 0);
            const typeLitteraCount = Array.from(elementGroups.values()).reduce((sum, elements) => {
              const set = new Set<string>();
              elements.forEach((el) => (el.litteraCodes || []).forEach((lc) => set.add(lc.litteraCode)));
              return sum + set.size;
            }, 0);

            const typeElementIds = Array.from(elementGroups.values()).flatMap((arr) => arr.map((el) => el.id));
            return (
              <React.Fragment key={ifcType}>
                {/* Level 0: IFC Type row – same as Excel (one cell per column) */}
                <tr style={{ backgroundColor: HEADER_BG, color: HEADER_TEXT, fontWeight: 600 }}>
                  {canRemove && (
                    <td style={{ padding: "4px", border: BORDER, color: HEADER_TEXT, verticalAlign: "middle" }}>
                      <input
                        type="checkbox"
                        checked={isAllSelected(typeElementIds)}
                        onChange={() => toggleSelection(typeElementIds)}
                        title={getTranslation(["actions", "select"], language)}
                      />
                    </td>
                  )}
                  <td style={{ padding: "6px 8px", border: BORDER, color: HEADER_TEXT }} title={ifcType}>
                    <button type="button" onClick={() => toggleType(ifcType)} style={{ marginRight: "8px", background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, lineHeight: 1 }} aria-label={typeCollapsed ? "Expand" : "Collapse"}>
                      {typeCollapsed ? "▶" : "▼"}
                    </button>
                    {ifcType}
                  </td>
                  <td style={{ padding: "6px 8px", border: BORDER, color: HEADER_TEXT }} title={`${elementGroups.size} group(s), ${typeElementCount} element(s), ${typeLitteraCount} Littera code(s)`}>
                    {elementGroups.size} group{elementGroups.size !== 1 ? "s" : ""}, {typeElementCount} element{typeElementCount !== 1 ? "s" : ""}, {typeLitteraCount} Littera code{typeLitteraCount !== 1 ? "s" : ""}
                  </td>
                  {Array.from({ length: totalCostColIndex - 2 }, (_, i) => (
                    <td key={`empty-${i}`} style={{ padding: "6px 8px", border: BORDER, color: HEADER_TEXT }} />
                  ))}
                  <td style={{ padding: "6px 8px", border: BORDER, color: HEADER_TEXT, textAlign: "right" }} title={typeTotal.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>
                    {typeTotal.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}
                  </td>
                  {allUnits.map((u) => (
                    <td key={`u-${u}`} style={{ padding: "6px 8px", border: BORDER, color: HEADER_TEXT }} />
                  ))}
                </tr>

                {!typeCollapsed &&
                  Array.from(elementGroups.entries()).map(([groupKey, elements]) => {
                    const first = pickAssemblyGroupLead(elements);
                    const groupId = `${ifcType}|${groupKey}`;
                    const normalizedName = normalizeRevitName(first.name);
                    const displayName = first.name !== normalizedName ? normalizedName : first.name;
                    const groupCollapsed = collapsedGroups.has(`${ifcType}|${groupKey}`);
                    const groupTotal = elements.reduce((s, el) => s + el.costs.total, 0);
                    const groupMaterial = elements.reduce((s, el) => s + el.costs.material, 0);
                    const groupLabor = elements.reduce((s, el) => s + el.costs.labor, 0);
                    const groupSubcontract = elements.reduce((s, el) => s + el.costs.subcontract, 0);
                    const hostCount = assemblyHostCount(elements);
                    const variantCount = hostCount > 0 ? hostCount : elements.length;
                    const variantText = variantCount > 1 ? ` (${variantCount} variants)` : "";

                    // Aggregated Littera from all elements in group: use per-Littera costs (lc.costs), not element-level repartition
                    const litteraMap = new Map<
                      string,
                      { name: string; category?: string; unit: string; quantity: number; relevanceScore?: number; material: number; labor: number; subcontract: number; total: number }
                    >();
                    elements.forEach((el) => {
                      if (!contributesToMaara(el.extraProperties)) return;
                      const confirmedOntelo = isConfirmedOntelolaattaElement(
                        el,
                        ontelolaattaMcpByGlobalId
                      );
                      litteraCodesForConfirmedOntelolaatta(el.litteraCodes, confirmedOntelo).forEach(
                        (lc) => {
                        const k = lc.litteraCode;
                        if (!litteraMap.has(k)) {
                          litteraMap.set(k, {
                            name: lc.litteraName || "",
                            category: lc.litteraCategory,
                            unit: lc.unit || "",
                            quantity: 0,
                            relevanceScore: lc.relevanceScore,
                            material: 0,
                            labor: 0,
                            subcontract: 0,
                            total: 0,
                          });
                        }
                        const agg = litteraMap.get(k)!;
                        const c = lc.costs ?? {};
                        agg.quantity += lc.quantity ?? 0;
                        agg.material += c.material ?? 0;
                        agg.labor += c.labor ?? 0;
                        agg.subcontract += c.subcontract ?? 0;
                        agg.total += c.total ?? ((c.material ?? 0) + (c.labor ?? 0) + (c.subcontract ?? 0));
                      });
                    });
                    const litteraRows = Array.from(litteraMap.entries());
                    const groupArea = groupMaaraAreaM2(elements);
                    const groupVolume = groupMaaraVolumeM3(elements);
                    const groupLength = groupMaaraLengthM(elements);
                    const unitsForType = getUnitsForIFCType(ifcType);
                    const groupQuantitiesByUnit = calculateBaseQuantitiesByUnitForElements(elements, ifcType);

                    const groupElementIds = elements.map((el) => el.id);
                    return (
                      <React.Fragment key={`${ifcType}|${groupKey}`}>
                        {/* Level 1: Element group row – same as Excel (Name, TALO, area/vol/len, costs, unit_XXX) */}
                        <tr style={{ backgroundColor: GROUP_ROW_BG, fontWeight: 600, color: GROUP_ROW_TEXT }}>
                          {canRemove && (
                            <td style={{ padding: "4px", border: BORDER, color: GROUP_ROW_TEXT, verticalAlign: "middle" }}>
                              <input
                                type="checkbox"
                                checked={isAllSelected(groupElementIds)}
                                onChange={() => toggleSelection(groupElementIds)}
                                title={getTranslation(["actions", "select"], language)}
                              />
                            </td>
                          )}
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} title={`${displayName}${variantText}`}>
                            <button type="button" onClick={() => toggleGroup(`${ifcType}|${groupKey}`)} style={{ marginRight: "6px", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, color: "inherit" }}>
                              {groupCollapsed ? "▶" : "▼"}
                            </button>
                            {displayName}{variantText}
                          </td>
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "2px", border: BORDER, color: GROUP_ROW_TEXT }} title={first.taloCode || undefined}>
                            <div style={{ position: "relative" }}>
                              <input
                                type="text"
                                defaultValue={first.taloCode || ""}
                                style={{
                                  width: "100%",
                                  maxWidth: "64px",
                                  padding: "4px 6px",
                                  boxSizing: "border-box",
                                  background: GROUP_ROW_BG,
                                  border: "1px solid var(--border)",
                                  borderRadius: "4px",
                                  color: GROUP_ROW_TEXT,
                                  fontFamily: "inherit",
                                  fontSize: TABLE_FONT_SIZE,
                                  fontWeight: "inherit",
                                }}
                                onFocus={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const base = suggestTaloAssignments(first, 8);
                                  setTaloSuggestions(
                                    base.map((s) => ({
                                      taloCode: s.taloCode,
                                      unit: String(s.unit),
                                      rtName: s.rtName,
                                    }))
                                  );
                                  setTaloDropdownRect({
                                    left: rect.left,
                                    top: rect.top,
                                    bottom: rect.bottom,
                                    width: rect.width,
                                  });
                                  setTaloDropdownContext({ groupId, elements });
                                  setOpenTaloGroup(groupId);
                                }}
                                onChange={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const raw = (e.target.value || "").trim();
                                  const base = suggestTaloAssignments(first, 12);
                                  const filtered = raw
                                    ? base.filter((s) =>
                                        s.taloCode.toLowerCase().includes(raw.toLowerCase())
                                      )
                                    : base;
                                  setTaloSuggestions(
                                    filtered.map((s) => ({
                                      taloCode: s.taloCode,
                                      unit: String(s.unit),
                                      rtName: s.rtName,
                                    }))
                                  );
                                  setTaloDropdownRect({
                                    left: rect.left,
                                    top: rect.top,
                                    bottom: rect.bottom,
                                    width: rect.width,
                                  });
                                  setTaloDropdownContext({ groupId, elements });
                                  setOpenTaloGroup(groupId);
                                }}
                                onBlur={(e) => {
                                  const raw = (e.target.value || "").trim();
                                  if (!raw) {
                                    setTimeout(() => setOpenTaloGroup((c) => (c === groupId ? null : c)), 150);
                                    return;
                                  }
                                  const expanded = expandTaloCode(raw) || raw;
                                  if (!isValidTaloFormat(expanded)) {
                                    alert("TALO code must be 4 segments in format x.x.x.x (e.g. 1.2.3.4).");
                                    setTimeout(() => setOpenTaloGroup((c) => (c === groupId ? null : c)), 150);
                                    return;
                                  }
                                  if (!isValidTalo2000Code(expanded)) {
                                    alert("Code not found in Hankenimikkeistö (TALO catalog).");
                                    setTimeout(() => setOpenTaloGroup((c) => (c === groupId ? null : c)), 150);
                                    return;
                                  }
                                  const ids = elements.map((el) => el.id);
                                  if (ids.length) onApplySuggestionGroup(ids, expanded);
                                  setTimeout(() => setOpenTaloGroup((c) => (c === groupId ? null : c)), 150);
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} title={first.taloName || undefined}>{first.taloName || ""}</td>
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} />
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupArea ? String(groupArea.toLocaleString("fi-FI", { minimumFractionDigits: 2 })) : undefined}>{groupArea ? groupArea.toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : ""}</td>
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupVolume ? String(groupVolume.toLocaleString("fi-FI", { minimumFractionDigits: 2 })) : undefined}>{groupVolume ? groupVolume.toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : ""}</td>
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupLength ? String(groupLength.toLocaleString("fi-FI", { minimumFractionDigits: 2 })) : undefined}>{groupLength ? groupLength.toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : ""}</td>
                          {onEdit ? (
                            <>
                              <td style={{ padding: "2px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }}>
                                <input key={`${groupKey}-material-${groupMaterial}-${groupLabor}-${groupSubcontract}`} type="text" defaultValue={groupMaterial.toFixed(2)} style={{ width: "100%", maxWidth: "72px", padding: "4px 6px", boxSizing: "border-box", textAlign: "right", background: GROUP_ROW_BG, border: "1px solid var(--border)", borderRadius: "4px", color: GROUP_ROW_TEXT, fontFamily: "inherit", fontSize: TABLE_FONT_SIZE, fontWeight: "inherit" }} title={groupMaterial.toLocaleString("fi-FI", { minimumFractionDigits: 2 })} onBlur={(e) => { const v = parseFloat(e.target.value) || 0; const perEl = elements.length ? v / elements.length : 0; elements.forEach((el) => onEdit(el.id, "material", perEl)); }} />
                              </td>
                              <td style={{ padding: "2px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }}>
                                <input key={`${groupKey}-labor-${groupMaterial}-${groupLabor}-${groupSubcontract}`} type="text" defaultValue={groupLabor.toFixed(2)} style={{ width: "100%", maxWidth: "72px", padding: "4px 6px", boxSizing: "border-box", textAlign: "right", background: GROUP_ROW_BG, border: "1px solid var(--border)", borderRadius: "4px", color: GROUP_ROW_TEXT, fontFamily: "inherit", fontSize: TABLE_FONT_SIZE, fontWeight: "inherit" }} title={groupLabor.toLocaleString("fi-FI", { minimumFractionDigits: 2 })} onBlur={(e) => { const v = parseFloat(e.target.value) || 0; const perEl = elements.length ? v / elements.length : 0; elements.forEach((el) => onEdit(el.id, "labor", perEl)); }} />
                              </td>
                              <td style={{ padding: "2px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }}>
                                <input key={`${groupKey}-subcontract-${groupMaterial}-${groupLabor}-${groupSubcontract}`} type="text" defaultValue={groupSubcontract.toFixed(2)} style={{ width: "100%", maxWidth: "72px", padding: "4px 6px", boxSizing: "border-box", textAlign: "right", background: GROUP_ROW_BG, border: "1px solid var(--border)", borderRadius: "4px", color: GROUP_ROW_TEXT, fontFamily: "inherit", fontSize: TABLE_FONT_SIZE, fontWeight: "inherit" }} title={groupSubcontract.toLocaleString("fi-FI", { minimumFractionDigits: 2 })} onBlur={(e) => { const v = parseFloat(e.target.value) || 0; const perEl = elements.length ? v / elements.length : 0; elements.forEach((el) => onEdit(el.id, "subcontract", perEl)); }} />
                              </td>
                            </>
                          ) : (
                            <>
                              <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupMaterial.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{groupMaterial.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                              <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupLabor.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{groupLabor.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                              <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupSubcontract.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{groupSubcontract.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                            </>
                          )}
                          <td style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={groupTotal.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{groupTotal.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                          {allUnits.map((u) => {
                            const val = unitsForType.includes(u) && groupQuantitiesByUnit[u] !== "" ? (typeof groupQuantitiesByUnit[u] === "number" ? (groupQuantitiesByUnit[u] as number).toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : String(groupQuantitiesByUnit[u])) : "";
                            return (
                              <td key={u} style={{ padding: "6px 8px", border: BORDER, textAlign: "right", color: GROUP_ROW_TEXT }} title={val || undefined}>
                                {val}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Level 2: Littera detail rows – same as Excel (area/vol/len = group; no unit_XXX); quitar y editar cantidad */}
                        {!groupCollapsed &&
                          (litteraRows.length > 0
                            ? litteraRows.map(([code, agg]) => {
                                const elementsWithCode = elements.filter((el) => (el.litteraCodes || []).some((lc) => lc.litteraCode === code));
                                // Considerar que un código Littera viene del IFC solo si en algún elemento del grupo
                                // existe con source === 'ifc'. Esto es independiente de la unidad o del relevanceScore.
                                const isIfcLittera = elementsWithCode.some((el) =>
                                  (el.litteraCodes || []).some(
                                    (lc: any) =>
                                      lc.litteraCode === code &&
                                      lc.source === "ifc"
                                  )
                                );
                                const tooltipText = isIfcLittera
                                  ? getTranslation(
                                      ["littera", "ifcSourceTooltip"],
                                      language
                                    )
                                  : getTranslation(
                                      ["littera", "suggestionTooltip"],
                                      language
                                    );
                                return (
                                <tr key={code} style={{ backgroundColor: DETAIL_ROW_BG, color: DETAIL_ROW_TEXT }}>
                                  {canRemove && <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />}
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT, fontSize: TABLE_FONT_SIZE, fontFamily: "inherit", verticalAlign: "middle" }}>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", minWidth: 0, fontSize: TABLE_FONT_SIZE, fontFamily: "inherit" }}>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          elementsWithCode.forEach((el) =>
                                            onRemoveLitteraCode(el.id, code)
                                          )
                                        }
                                        style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", padding: 0, fontSize: TABLE_FONT_SIZE, lineHeight: 1, background: "var(--error, #c62828)", color: "#fff", border: "none", borderRadius: "2px", cursor: "pointer" }}
                                        title="Remove this Littera code from all elements in group"
                                      >
                                        ✕
                                      </button>
                                      <span
                                        style={{ fontSize: TABLE_FONT_SIZE, fontFamily: "inherit" }}
                                        title={tooltipText}
                                      >
                                        {code}
                                      </span>
                                    </span>
                                  </td>
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} title={agg.name}>{agg.name}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} title={agg.category ?? undefined}>{agg.category ?? ""}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={agg.unit}>{agg.unit}</td>
                                  <td style={{ padding: "2px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }}>
                                    <input
                                      type="text"
                                      defaultValue={agg.quantity.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}
                                      style={{ width: "100%", maxWidth: "56px", padding: "2px 4px", boxSizing: "border-box", textAlign: "right", background: DETAIL_ROW_BG, border: "1px solid var(--border)", borderRadius: "4px", color: DETAIL_ROW_TEXT, fontFamily: "inherit", fontSize: TABLE_FONT_SIZE }}
                                      onBlur={(e) => {
                                        const v =
                                          parseFloat(
                                            (e.target.value || "").replace(",", ".")
                                          ) || 0;
                                        const n = elementsWithCode.length;
                                        if (n > 0) {
                                          const perEl = v / n;
                                          elementsWithCode.forEach((el) =>
                                            onUpdateLitteraCodeQuantity(
                                              el.id,
                                              code,
                                              perEl
                                            )
                                          );
                                        }
                                      }}
                                    />
                                  </td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={agg.relevanceScore != null ? String(agg.relevanceScore) : undefined}>{agg.relevanceScore != null ? agg.relevanceScore : ""}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={groupArea ? String(groupArea.toLocaleString("fi-FI", { minimumFractionDigits: 2 })) : undefined}>{groupArea ? groupArea.toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : ""}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={groupVolume ? String(groupVolume.toLocaleString("fi-FI", { minimumFractionDigits: 2 })) : undefined}>{groupVolume ? groupVolume.toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : ""}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={groupLength ? String(groupLength.toLocaleString("fi-FI", { minimumFractionDigits: 2 })) : undefined}>{groupLength ? groupLength.toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : ""}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={agg.material.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{agg.material.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={agg.labor.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{agg.labor.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={agg.subcontract.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{agg.subcontract.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                                  <td style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={agg.total.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}>{agg.total.toLocaleString("fi-FI", { minimumFractionDigits: 2 })}</td>
                                  {allUnits.map((u) => (
                                    <td key={u} style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                  ))}
                                </tr>
                                );
                              })
                            : (
                                <tr style={{ backgroundColor: DETAIL_ROW_BG }}>
                                  <td colSpan={columns.length} style={{ padding: "4px 8px", border: BORDER, fontStyle: "italic", color: "var(--text-3)" }}>
                                    (No Littera codes)
                                  </td>
                                </tr>
                              ))}

                        {/* Add Littera row: input + button (con sugerencias) para añadir código a todos los elementos del grupo */}
                        {!groupCollapsed && (
                          <tr style={{ backgroundColor: "var(--surface-2)", borderTop: "1px dashed var(--border)" }}>
                            <td colSpan={canRemove ? 6 : 5} style={{ padding: "4px 8px", border: BORDER }} />
                            <td style={{ padding: "4px 8px", border: BORDER }} colSpan={2}>
                              <div style={{ position: "relative", display: "flex", alignItems: "center", gap: "4px" }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const raw = (addLitteraByGroup[groupId] ?? "").trim();
                                    if (!raw) return;
                                    const normalized = normalizeLitteraCode(raw);
                                    if (!isValidLitteraFormat(raw)) {
                                      alert("Littera code must be 6 digits (format x.x.x.x.x.x or e.g. 350010).");
                                      return;
                                    }
                                    if (!hasLitteraDict || !isLitteraCodeInDict(normalized, litteraDict)) {
                                      alert("Code not found in Littera dictionary.");
                                      return;
                                    }
                                    const dictEntry = litteraDict.find(
                                      (e) =>
                                        e.littera.replace(/\D/g, "") ===
                                          normalized || e.littera === normalized
                                    );
                                    const code = dictEntry?.littera ?? normalized;
                                    const name = dictEntry?.description ?? code;
                                    const unit = dictEntry?.unit ?? "M2";
                                    const category = dictEntry?.category ?? null;
                                    elements.forEach((el) =>
                                      onAddLitteraCode(
                                        el.id,
                                        code,
                                        name,
                                        category,
                                        unit
                                      )
                                    );
                                    setAddLitteraByGroup((prev) => ({
                                      ...prev,
                                      [groupId]: "",
                                    }));
                                    setOpenLitteraGroup(null);
                                  }}
                                  style={{
                                    flexShrink: 0,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: "24px",
                                    height: "24px",
                                    padding: 0,
                                    fontSize: TABLE_FONT_SIZE,
                                    lineHeight: 1,
                                    background: "#2e7d32",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "2px",
                                    cursor: "pointer",
                                  }}
                                  title="Add Littera code"
                                >
                                  <span className="material-icons-round" style={{ fontSize: TABLE_FONT_SIZE }}>check</span>
                                </button>
                                <input
                                  type="text"
                                  placeholder="Littera code"
                                  value={addLitteraByGroup[groupId] ?? ""}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    setAddLitteraByGroup((prev) => ({
                                      ...prev,
                                      [groupId]: value,
                                    }));
                                    if (!hasLitteraDict) return;
                                    const base = suggestLitteraAssignments(first, litteraDict, 12);
                                    const v = value.trim().toLowerCase();
                                    const filtered = v
                                      ? base.filter(
                                          (s) =>
                                            s.litteraCode.toLowerCase().includes(v) ||
                                            s.litteraName.toLowerCase().includes(v)
                                        )
                                      : base;
                                    setLitteraSuggestions(
                                      filtered.map((s) => ({
                                        litteraCode: s.litteraCode,
                                        litteraName: s.litteraName,
                                        unit: s.unit,
                                        category: s.category,
                                        confidence: s.confidence,
                                      }))
                                    );
                                    setOpenLitteraGroup(groupId);
                                  }}
                                  style={{
                                    width: "100%",
                                    maxWidth: "140px",
                                    height: "24px",
                                    padding: "2px 6px",
                                    boxSizing: "border-box",
                                    background: DETAIL_ROW_BG,
                                    border: "1px solid var(--border)",
                                    borderRadius: "2px",
                                    color: DETAIL_ROW_TEXT,
                                    fontFamily: "inherit",
                                    fontSize: TABLE_FONT_SIZE,
                                  }}
                                  onFocus={() => {
                                    if (!hasLitteraDict) return;
                                    const base = suggestLitteraAssignments(first, litteraDict, 8);
                                    setLitteraSuggestions(
                                      base.map((s) => ({
                                        litteraCode: s.litteraCode,
                                        litteraName: s.litteraName,
                                        unit: s.unit,
                                        category: s.category,
                                        confidence: s.confidence,
                                      }))
                                    );
                                    setOpenLitteraGroup(groupId);
                                  }}
                                  onBlur={() => {
                                    setTimeout(() => {
                                      setOpenLitteraGroup((current) =>
                                        current === groupId ? null : current
                                      );
                                    }, 150);
                                  }}
                                />
                                {openLitteraGroup === groupId &&
                                  litteraSuggestions.length > 0 && (
                                    <div
                                      style={{
                                        position: "absolute",
                                        top: "100%",
                                        left: 0,
                                        marginTop: "2px",
                                        zIndex: 1000,
                                        minWidth: "220px",
                                        maxHeight: "240px",
                                        overflowY: "auto",
                                        background: "var(--surface-1)",
                                        border: "1px solid var(--border)",
                                        borderRadius: "4px",
                                        boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                                      }}
                                    >
                                      {litteraSuggestions.map((s) => (
                                        <button
                                          key={`${s.litteraCode}-${s.unit}`}
                                          type="button"
                                          onMouseDown={(ev) => {
                                            ev.preventDefault();
                                            elements.forEach((el) =>
                                              onAddLitteraCode(
                                                el.id,
                                                s.litteraCode,
                                                s.litteraName,
                                                s.category ?? null,
                                                s.unit
                                              )
                                            );
                                            setAddLitteraByGroup((prev) => ({
                                              ...prev,
                                              [groupId]: "",
                                            }));
                                            setOpenLitteraGroup(null);
                                          }}
                                          style={{
                                            display: "flex",
                                            width: "100%",
                                            padding: "4px 8px",
                                            border: "none",
                                            background: "transparent",
                                            textAlign: "left",
                                            cursor: "pointer",
                                            fontSize: "0.85em",
                                            color: DETAIL_ROW_TEXT,
                                          }}
                                          onMouseEnter={(ev) => {
                                            ev.currentTarget.style.backgroundColor =
                                              "#e3edf8";
                                          }}
                                          onMouseLeave={(ev) => {
                                            ev.currentTarget.style.backgroundColor =
                                              "transparent";
                                          }}
                                        >
                                          <span
                                            style={{
                                              fontWeight: 600,
                                              marginRight: "6px",
                                            }}
                                          >
                                            {s.litteraCode}
                                          </span>
                                          <span
                                            style={{
                                              flex: 1,
                                              overflow: "hidden",
                                              textOverflow: "ellipsis",
                                              whiteSpace: "nowrap",
                                            }}
                                            title={s.litteraName}
                                          >
                                            {s.litteraName}
                                          </span>
                                          <span
                                            style={{
                                              marginLeft: "6px",
                                              opacity: 0.7,
                                            }}
                                          >
                                            {s.unit}
                                          </span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                              </div>
                            </td>
                            <td colSpan={columns.length - 7} style={{ padding: "4px 8px", border: BORDER }} />
                          </tr>
                        )}

                        {/* Level 3: one row per GUID – same as Excel: only GUID + unit_XXX columns */}
                        {!groupCollapsed &&
                          elements.map((el, idx) => {
                            const singleQuantities = calculateBaseQuantitiesByUnitForElements([el], ifcType);
                            const guidVal = el.globalId ?? "";
                            return (
                              <tr key={el.globalId ?? `el-${el.id}-${idx}`} style={{ backgroundColor: DETAIL_ROW_BG, color: DETAIL_ROW_TEXT }}>
                                {canRemove && (
                                  <td style={{ padding: "4px", border: BORDER, color: DETAIL_ROW_TEXT, verticalAlign: "middle" }}>
                                    <input
                                      type="checkbox"
                                      checked={selectedIds.has(el.id)}
                                      onChange={() => toggleSelection([el.id])}
                                      title={getTranslation(["actions", "select"], language)}
                                    />
                                  </td>
                                )}
                                <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                <td style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                <td style={{ padding: "4px 8px", border: BORDER, wordBreak: "break-all", color: DETAIL_ROW_TEXT }} title={guidVal}>{guidVal}</td>
                                {Array.from({ length: 16 }, (_, i) => (
                                  <td key={i} style={{ padding: "4px 8px", border: BORDER, color: DETAIL_ROW_TEXT }} />
                                ))}
                                {allUnits.map((u) => {
                                  const val = unitsForType.includes(u) && singleQuantities[u] !== "" ? (typeof singleQuantities[u] === "number" ? (singleQuantities[u] as number).toLocaleString("fi-FI", { minimumFractionDigits: 2 }) : String(singleQuantities[u])) : "";
                                  return (
                                    <td key={u} style={{ padding: "4px 8px", border: BORDER, textAlign: "right", color: DETAIL_ROW_TEXT }} title={val || undefined}>
                                      {val}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                      </React.Fragment>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </tbody>
        </table>
      </div>
      {taloDropdownContext &&
        openTaloGroup === taloDropdownContext.groupId &&
        taloDropdownRect &&
        taloSuggestions.length > 0 &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: taloDropdownRect.bottom + 4,
              left: taloDropdownRect.left,
              minWidth: Math.max(160, taloDropdownRect.width),
              maxHeight: 260,
              overflowY: "auto",
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: "4px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              zIndex: 2000,
            }}
          >
            {taloSuggestions.map((s) => (
              <button
                key={s.taloCode}
                type="button"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  const expanded = expandTaloCode(s.taloCode) || s.taloCode;
                  const ids = taloDropdownContext.elements.map((el) => el.id);
                  if (ids.length) onApplySuggestionGroup(ids, expanded);
                  setOpenTaloGroup(null);
                  setTaloSuggestions([]);
                  setTaloDropdownRect(null);
                  setTaloDropdownContext(null);
                }}
                style={{
                  display: "flex",
                  width: "100%",
                  padding: "4px 8px",
                  border: "none",
                  background: "transparent",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: "0.85em",
                  color: GROUP_ROW_TEXT,
                }}
                onMouseEnter={(ev) => {
                  ev.currentTarget.style.backgroundColor = "#e3edf8";
                }}
                onMouseLeave={(ev) => {
                  ev.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span style={{ fontWeight: 600, marginRight: "6px" }}>
                  {s.taloCode}
                </span>
                <span style={{ opacity: 0.8 }}>
                  {s.rtName || s.unit}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
