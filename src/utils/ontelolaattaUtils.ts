/**
 * Ontelolaatta Utilities
 *
 * Un IfcSlab nombrado Oxx modela UNA ontelolaatta (prisma unitario).
 * La línea de vano se dibuja en la esquina, a lo largo del borde del lado largo.
 * pieceCount es siempre 1 por slab; el conteo de array (kpl) queda para informes MCP futuros.
 */

import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

/** Ancho nominal estándar de ontelolaatta en metros (1200 mm). Solo para kpl. */
export const PIECE_WIDTH_M = 1.2;

const LINE_LIFT_M = 0.02;

/**
 * Regex para detectar código ontelolaatta Oxx en cualquier parte del nombre IFC.
 * Cubre variantes Revit: "O32", "Floor:O32:1232412", "Slab_O27M", etc.
 */
const ONTELO_REGEX = /(?:^|:|[\s_-])O(\d{2,3})([MK]{0,2})?(?::|$|[\s_-]|[^a-zA-Z0-9])/i;

/** Tabla fija: código numérico → espesor en mm (fuente: SFS / catálogos fabricantes FI) */
const THICKNESS_MAP: Record<number, number> = {
  15: 150,
  20: 200,
  27: 265,
  32: 320,
  37: 370,
  40: 400,
  50: 500,
};

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface OnteloType {
  code: string;
  baseNumber: number;
  thicknessMm: number | null;
  suffix: string;
}

/** Marco orientado (OBB) del slab en world space */
export interface OrientedFootprint {
  center: THREE.Vector3;
  /** Eje del lado largo (unitario, world) */
  longDir: THREE.Vector3;
  /** Eje del lado corto en planta (unitario, world) */
  shortDir: THREE.Vector3;
  /** Normal al plano del slab, hacia la cara superior (unitario, world) */
  normal: THREE.Vector3;
  extentLong: number;
  extentShort: number;
  wMax: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface FootprintEdges {
  fieldLength: number;
  fieldWidth: number;
  mesh: THREE.Object3D;
  oriented: OrientedFootprint;
  spanDir: { x: number; y: number };
  perpDir: { x: number; y: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Funciones públicas
// ─────────────────────────────────────────────────────────────────────────────

export function isIfcSlabType(typeLabel: string): boolean {
  const normalized = String(typeLabel ?? "").trim().toLowerCase().replace(/^ifc/, "");
  return normalized === "slab" || normalized === "slabstandardcase";
}

export function detectOnteloType(name: string): OnteloType | null {
  if (!name) return null;
  const trimmed = name.trim();
  const match = trimmed.match(ONTELO_REGEX);
  if (!match) return null;

  const baseNumber = parseInt(match[1], 10);
  const suffix = (match[2] ?? "").toUpperCase();
  const code = `O${match[1].toUpperCase()}${suffix}`;
  const thicknessMm = THICKNESS_MAP[baseNumber] ?? null;

  return { code, baseNumber, thicknessMm, suffix };
}

export function computeFootprintEdges(
  model: FRAGS.FragmentsGroup,
  elementId: number
): FootprintEdges | null {
  try {
    const worldVertices = collectElementWorldVertices(model, elementId);
    if (worldVertices.length < 3) return null;

    const oriented = computeOrientedFootprint(worldVertices);
    if (!oriented) return null;

    let mesh: THREE.Object3D | null = null;
    for (const fragment of model.items) {
      if (!fragmentContainsItem(fragment, elementId)) continue;
      mesh = fragment.mesh ?? null;
      if (mesh) break;
    }
    if (!mesh) return null;

    const fieldLength = oriented.extentLong;
    const fieldWidth = PIECE_WIDTH_M;

    mesh.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const localLong = oriented.longDir.clone().transformDirection(inv);
    localLong.z = 0;
    if (localLong.lengthSq() < 1e-8) localLong.set(1, 0, 0);
    localLong.normalize();
    const spanDir = { x: localLong.x, y: localLong.y };
    const perpDir = flipSpanDir(spanDir);

    return {
      fieldLength,
      fieldWidth,
      mesh,
      oriented,
      spanDir,
      perpDir,
    };
  } catch (err) {
    console.warn("[ontelolaattaUtils] computeFootprintEdges error:", err);
  }
  return null;
}

/**
 * Longitud del vano fiable: OBB + línea 3D visible.
 * - lineAlongLong=false → vano = eje corto (extentShort); la línea mide ese eje
 * - lineAlongLong=true  → vano = eje largo (extentLong); se usa lineDist si OBB infla
 */
export function resolveFieldLength(
  edges: FootprintEdges,
  lineAlongLong: boolean,
  p1: THREE.Vector3,
  p2: THREE.Vector3
): number {
  const lineDist = p1.distanceTo(p2);
  const { extentLong, extentShort } = edges.oriented;

  if (!lineAlongLong) {
    // La línea va a lo largo del eje corto → vano = extentShort
    return lineDist > 0.5 ? lineDist : extentShort;
  }

  // La línea va a lo largo del eje largo → protección contra OBB inflada
  if (lineDist > 1 && extentLong > lineDist * 1.35) return lineDist;
  if (lineDist > 1 && extentLong > 25 && extentShort < 3 && lineDist < extentLong * 0.5) {
    return lineDist;
  }
  return extentLong;
}

/**
 * Ancho total perpendicular al vano (cuántos slabs de 1.2 m caben en fila).
 * - lineAlongLong=false → vano está en el eje corto → perpendicular = eje largo
 * - lineAlongLong=true  → vano está en el eje largo → perpendicular = eje corto
 */
export function resolvePerpWidth(
  edges: FootprintEdges,
  lineAlongLong: boolean
): number {
  return lineAlongLong ? edges.oriented.extentShort : edges.oriented.extentLong;
}

export function flipSpanDir(dir: { x: number; y: number }): { x: number; y: number } {
  return { x: -dir.y, y: dir.x };
}

/**
 * Puntos de la línea en la esquina del slab, sobre el borde indicado.
 * Usa el OBB orientado (no el AABB world) para alinear con los bordes reales.
 */
export function computeSpanLinePoints(
  edges: FootprintEdges,
  lineAlongLong: boolean
): { p1: THREE.Vector3; p2: THREE.Vector3 } {
  const { center, longDir, shortDir, normal, uMin, uMax, vMin, vMax, wMax } =
    edges.oriented;

  const lift = wMax + LINE_LIFT_M;
  const p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3();

  if (lineAlongLong) {
    p1.copy(center).addScaledVector(longDir, uMin).addScaledVector(shortDir, vMin).addScaledVector(normal, lift);
    p2.copy(center).addScaledVector(longDir, uMax).addScaledVector(shortDir, vMin).addScaledVector(normal, lift);
  } else {
    p1.copy(center).addScaledVector(longDir, uMin).addScaledVector(shortDir, vMin).addScaledVector(normal, lift);
    p2.copy(center).addScaledVector(longDir, uMin).addScaledVector(shortDir, vMax).addScaledVector(normal, lift);
  }

  return { p1, p2 };
}

/**
 * Número de ontelolaattas (kpl).
 * perpWidth = ancho total del campo perpendicular al vano (= extentLong cuando lineAlongLong=false).
 * Cada pieza ocupa PIECE_WIDTH_M = 1.2 m.
 */
export function computePieceCount(perpWidth?: number): number {
  if (perpWidth != null && perpWidth > 0) {
    return Math.ceil(perpWidth / PIECE_WIDTH_M);
  }
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometría interna
// ─────────────────────────────────────────────────────────────────────────────

function collectElementWorldVertices(
  model: FRAGS.FragmentsGroup,
  elementId: number
): THREE.Vector3[] {
  const id = Number(elementId);
  if (!Number.isFinite(id)) return [];

  for (const fragment of model.items) {
    if (!fragmentContainsItem(fragment, id)) continue;
    const verts = collectVerticesFromFragment(fragment, id);
    if (verts.length >= 3) return verts;
  }

  const modelAny = model as FRAGS.FragmentsGroup & {
    getItemVertices?: (itemId: number) => THREE.Vector3[];
  };
  if (typeof modelAny.getItemVertices === "function") {
    const raw = modelAny.getItemVertices(id) ?? [];
    if (raw.length >= 3) {
      for (const fragment of model.items) {
        if (!fragmentContainsItem(fragment, id) || !fragment.mesh) continue;
        fragment.mesh.updateMatrixWorld(true);
        const mw = fragment.mesh.matrixWorld;
        return raw.map((v) => v.clone().applyMatrix4(mw));
      }
      return raw.map((v) => v.clone());
    }
  }

  return [];
}

function collectVerticesFromFragment(
  fragment: FRAGS.FragmentsGroup["items"][number],
  elementId: number
): THREE.Vector3[] {
  const mesh = fragment.mesh;
  if (!mesh?.geometry) return [];

  const instances = getItemInstances(fragment, elementId);
  if (!instances?.size) return [];

  const localVerts = getLocalPrototypeVertices(fragment);
  if (localVerts.length < 3) return [];

  mesh.updateMatrixWorld(true);
  const result: THREE.Vector3[] = [];
  const tmp = new THREE.Vector3();
  const worldMatrix = new THREE.Matrix4();
  const instMatrix = new THREE.Matrix4();

  for (const instId of instances) {
    mesh.getMatrixAt(instId, instMatrix);
    worldMatrix.multiplyMatrices(mesh.matrixWorld, instMatrix);
        for (const local of localVerts) {
          result.push(tmp.copy(local).applyMatrix4(worldMatrix).clone());
        }
  }

  return result;
}

function fragmentContainsItem(
  fragment: FRAGS.FragmentsGroup["items"][number],
  elementId: number
): boolean {
  const id = Number(elementId);
  if (fragment.ids.has(id)) return true;
  for (const itemId of fragment.ids) {
    if (Number(itemId) === id) return true;
  }
  return getItemInstances(fragment, id) != null;
}

function getItemInstances(
  fragment: FRAGS.FragmentsGroup["items"][number],
  elementId: number
): Set<number> | null {
  const id = Number(elementId);
  const direct = fragment.getInstancesIDs(id);
  if (direct?.size) return direct;
  const asInt = fragment.getInstancesIDs(Math.trunc(id));
  if (asInt?.size) return asInt;
  for (const itemId of fragment.ids) {
    if (Number(itemId) === id) {
      return fragment.getInstancesIDs(itemId) ?? null;
    }
  }
  return null;
}

/** Vértices únicos del prototipo instanciado; si falla, esquinas del bbox local. */
function getLocalPrototypeVertices(
  fragment: FRAGS.FragmentsGroup["items"][number]
): THREE.Vector3[] {
  const fromUnique = fragment.uniqueVertices;
  if (fromUnique.length >= 3) return fromUnique;

  const geo = fragment.mesh?.geometry;
  if (!geo) return [];
  if (!geo.boundingBox) geo.computeBoundingBox();
  if (!geo.boundingBox || geo.boundingBox.isEmpty()) return [];

  return box3Corners(geo.boundingBox);
}

function box3Corners(box: THREE.Box3): THREE.Vector3[] {
  const { min, max } = box;
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
}

function computeOrientedFootprint(vertices: THREE.Vector3[]): OrientedFootprint | null {
  const center = new THREE.Vector3();
  for (const p of vertices) center.add(p);
  center.divideScalar(vertices.length);

  let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
  for (const p of vertices) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    c00 += dx * dx;
    c01 += dx * dy;
    c02 += dx * dz;
    c11 += dy * dy;
    c12 += dy * dz;
    c22 += dz * dz;
  }
  const invN = 1 / vertices.length;
  c00 *= invN; c01 *= invN; c02 *= invN;
  c11 *= invN; c12 *= invN; c22 *= invN;

  const { values, vectors } = symmetricEigen3(c00, c01, c02, c11, c12, c22);
  const order = [0, 1, 2].sort((a, b) => values[a] - values[b]);

  const normal = vectors[order[0]].clone().normalize();
  const shortDir = vectors[order[1]].clone().normalize();
  const longDir = vectors[order[2]].clone().normalize();

  if (longDir.clone().cross(shortDir).dot(normal) < 0) shortDir.negate();

  let uMin = Infinity, uMax = -Infinity;
  let vMin = Infinity, vMax = -Infinity;
  let wMin = Infinity, wMax = -Infinity;

  for (const p of vertices) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dz = p.z - center.z;
    const u = dx * longDir.x + dy * longDir.y + dz * longDir.z;
    const v = dx * shortDir.x + dy * shortDir.y + dz * shortDir.z;
    const w = dx * normal.x + dy * normal.y + dz * normal.z;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
    if (w < wMin) wMin = w;
    if (w > wMax) wMax = w;
  }

  if (!isFinite(uMin) || uMax - uMin < 1e-4) return null;

  return {
    center,
    longDir,
    shortDir,
    normal,
    extentLong: uMax - uMin,
    extentShort: vMax - vMin,
    wMax,
    uMin,
    uMax,
    vMin,
    vMax,
  };
}

/** Descomposición propia 3×3 simétrica (Jacobi) */
function symmetricEigen3(
  a00: number, a01: number, a02: number,
  a11: number, a12: number,
  a22: number
): { values: [number, number, number]; vectors: [THREE.Vector3, THREE.Vector3, THREE.Vector3] } {
  const a = [
    [a00, a01, a02],
    [a01, a11, a12],
    [a02, a12, a22],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < 32; iter++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { max = Math.abs(a[0][2]); p = 0; q = 2; }
    if (Math.abs(a[1][2]) > max) { max = Math.abs(a[1][2]); p = 1; q = 2; }
    if (max < 1e-14) break;

    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    const app2 = c * c * app - 2 * s * c * apq + s * s * aqq;
    const aqq2 = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][p] = app2;
    a[q][q] = aqq2;
    a[p][q] = a[q][p] = 0;

    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue;
      const arp = a[r][p];
      const arq = a[r][q];
      a[r][p] = a[p][r] = c * arp - s * arq;
      a[r][q] = a[q][r] = s * arp + c * arq;
    }

    for (let r = 0; r < 3; r++) {
      const vr = v[r][p];
      const vq = v[r][q];
      v[r][p] = c * vr - s * vq;
      v[r][q] = s * vr + c * vq;
    }
  }

  return {
    values: [a[0][0], a[1][1], a[2][2]],
    vectors: [
      new THREE.Vector3(v[0][0], v[1][0], v[2][0]),
      new THREE.Vector3(v[0][1], v[1][1], v[2][1]),
      new THREE.Vector3(v[0][2], v[1][2], v[2][2]),
    ],
  };
}
