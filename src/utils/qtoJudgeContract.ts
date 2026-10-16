/**
 * Judge contract — every IfcType CostaBIM publishes vs IFC Qto fields to compare.
 * Used by preserve policy, tests, and offline IfcOpenShell audit (mirror in Downloads).
 */

export type JudgeMetric =
  | "length"
  | "area_m2"
  | "volume_m3"
  | "width_height"
  | "count_kpl"
  | "weight_kg";

export type JudgeRule = {
  ifcTypePattern: string;
  metrics: JudgeMetric[];
  ifcFields: string[];
  costaFields: string[];
};

/** Full store coverage — not only beams and doors. */
export const QTO_JUDGE_RULES: JudgeRule[] = [
  {
    ifcTypePattern: "BEAM|COLUMN|MEMBER|PILE|PIPE|DUCT|CABLE|RAILING|STAIRFLIGHT|BUILDINGELEMENTPROXY",
    metrics: ["length", "volume_m3", "weight_kg"],
    ifcFields: ["Length", "CrossSectionArea", "GrossVolume", "NetVolume"],
    costaFields: ["Length", "Width", "Height", "PublishedQuantity", "JM (m)", "M3 (m³)", "KG (kg)"],
  },
  {
    ifcTypePattern: "DOOR|WINDOW",
    metrics: ["width_height", "area_m2", "count_kpl"],
    ifcFields: ["OverallWidth", "OverallHeight", "Width", "Height", "Area", "NetArea"],
    costaFields: ["Width", "Height", "Length", "PublishedQuantity", "M2 (m²)", "KPL (pcs)"],
  },
  {
    ifcTypePattern: "WALL",
    metrics: ["area_m2", "volume_m3"],
    ifcFields: ["NetSideArea", "GrossSideArea", "NetArea", "GrossArea", "NetVolume"],
    costaFields: ["PublishedQuantity", "M2 (m²)", "M3 (m³)", "Length", "Height"],
  },
  {
    ifcTypePattern: "SLAB|ROOF|PLATE|COVERING|FOOTING|FOUNDATION",
    metrics: ["area_m2", "volume_m3"],
    ifcFields: ["NetArea", "GrossArea", "NetVolume", "GrossVolume", "Width", "Length"],
    costaFields: ["PublishedQuantity", "M2 (m²)", "M3 (m³)", "NetArea", "GrossArea"],
  },
  {
    ifcTypePattern: "STAIR|CURTAINWALL|FURNITURE|FLOWTERMINAL|SANITARY",
    metrics: ["area_m2", "volume_m3", "count_kpl", "length"],
    ifcFields: ["NetArea", "GrossVolume", "Length", "Count"],
    costaFields: ["PublishedQuantity", "M2 (m²)", "M3 (m³)", "JM (m)", "KPL (pcs)"],
  },
];

export function judgeRuleForIfcType(ifcType: string): JudgeRule | undefined {
  const t = ifcType.toUpperCase();
  return QTO_JUDGE_RULES.find((r) =>
    r.ifcTypePattern.split("|").some((p) => t.includes(p))
  );
}

export function allMeasuredIfcFamilies(): string[] {
  return [
    "IfcBeam",
    "IfcColumn",
    "IfcMember",
    "IfcWallStandardCase",
    "IfcWall",
    "IfcSlab",
    "IfcRoof",
    "IfcPlate",
    "IfcCovering",
    "IfcDoor",
    "IfcWindow",
    "IfcRailing",
    "IfcStair",
    "IfcStairFlight",
    "IfcCurtainWall",
    "IfcBuildingElementProxy",
    "IfcFooting",
    "IfcPipeSegment",
    "IfcDuctSegment",
    "IfcCableSegment",
  ];
}
