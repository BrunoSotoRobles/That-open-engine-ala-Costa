/**
 * Screen-rectangle (lasso/box) selection for That Open Fragments (v2.4).
 *
 * Uses a ray grid inside the drag rect + closest hit per ray (visible surface only).
 * Optional allowList (Model Tree visualize scope) restricts eligible express IDs.
 */

import * as THREE from "three";

export type FragmentIdMap = Record<string, Set<number>>;

export interface ScreenRectNdc {
  /** Inclusive min/max in NDC (-1..1), y up. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface BoxSelectOptions {
  /** Model Tree visualize scope — only these express IDs are eligible. */
  allowList?: ReadonlySet<number> | null;
  /** Cap ray samples (default 2400). */
  maxRays?: number;
}

type FragMesh = THREE.Mesh & {
  isInstancedMesh?: boolean;
  fragment?: { getItemID: (instanceId: number) => number | null };
  userData?: { indexFragmentMap?: Map<number, FragmentIdMap> };
};

type FragItem = {
  id: string | number;
  ids: Iterable<number>;
  mesh?: FragMesh | null;
};

type FragmentModelLike = {
  items: Iterable<FragItem>;
  getFragmentMap?: (ids: number[]) => FragmentIdMap;
};

const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

/** Grid dimensions for ray samples inside an NDC rect (testable). */
export function computeRayGridDimensions(
  rect: ScreenRectNdc,
  maxRays = 2400
): { cols: number; rows: number; total: number } {
  const ndcW = Math.max(rect.maxX - rect.minX, 0.002);
  const ndcH = Math.max(rect.maxY - rect.minY, 0.002);
  const aspect = ndcW / ndcH;
  let cols = Math.ceil(Math.sqrt(maxRays * aspect));
  let rows = Math.ceil(maxRays / cols);
  cols = Math.min(64, Math.max(6, cols));
  rows = Math.min(64, Math.max(6, rows));
  while (cols * rows > maxRays && cols > 6) {
    cols -= 1;
    rows = Math.ceil(maxRays / cols);
  }
  return { cols, rows, total: cols * rows };
}

export function screenPointsToNdcRect(
  startClient: { x: number; y: number },
  endClient: { x: number; y: number },
  canvasRect: DOMRect
): ScreenRectNdc | null {
  const w = canvasRect.width;
  const h = canvasRect.height;
  if (w <= 0 || h <= 0) return null;

  const toNdc = (clientX: number, clientY: number) => {
    const x = ((clientX - canvasRect.left) / w) * 2 - 1;
    const y = -(((clientY - canvasRect.top) / h) * 2 - 1);
    return { x, y };
  };

  const a = toNdc(startClient.x, startClient.y);
  const b = toNdc(endClient.x, endClient.y);
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);

  if (Math.abs(maxX - minX) < 0.002 && Math.abs(maxY - minY) < 0.002) return null;

  return { minX, maxX, minY, maxY };
}

function fragmentTouchesAllowList(fragment: FragItem, allowList: ReadonlySet<number>): boolean {
  for (const raw of fragment.ids) {
    if (allowList.has(Number(raw))) return true;
  }
  return false;
}

function collectRaycastMeshes(
  fragmentModel: FragmentModelLike,
  allowList: ReadonlySet<number> | null | undefined
): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  const scope = allowList && allowList.size > 0 ? allowList : null;

  for (const fragment of fragmentModel.items) {
    const mesh = fragment.mesh;
    if (!mesh || mesh.visible === false) continue;
    if (scope && !fragmentTouchesAllowList(fragment, scope)) continue;
    meshes.push(mesh);
  }
  return meshes;
}

/** Map a raycast hit to IFC express ID (That Open instanced + indexFragmentMap paths). */
export function resolveExpressIdFromRaycastHit(hit: THREE.Intersection): number | null {
  const obj = hit.object as FragMesh;

  if (hit.instanceId !== undefined && obj.fragment?.getItemID) {
    const eid = obj.fragment.getItemID(hit.instanceId);
    if (eid != null && Number.isFinite(Number(eid))) return Number(eid);
  }

  const idxMap = obj.userData?.indexFragmentMap;
  if (idxMap && hit.faceIndex !== undefined) {
    const fm = idxMap.get(hit.faceIndex);
    if (fm) {
      for (const key of Object.keys(fm)) {
        const ids = fm[key] as Set<number> | number[] | undefined;
        if (ids instanceof Set) {
          const first = ids.values().next().value;
          if (first != null) return Number(first);
        } else if (Array.isArray(ids) && ids.length > 0) {
          return Number(ids[0]);
        }
      }
    }
  }

  return null;
}

function buildMapFromExpressIds(
  fragmentModel: FragmentModelLike,
  expressIds: number[]
): FragmentIdMap {
  if (expressIds.length === 0) return {};
  if (typeof fragmentModel.getFragmentMap === "function") {
    return fragmentModel.getFragmentMap(expressIds);
  }
  const idSet = new Set(expressIds.map((n) => Number(n)));
  const out: FragmentIdMap = {};
  for (const fragment of fragmentModel.items) {
    const selected: number[] = [];
    for (const expressId of fragment.ids) {
      const idNum = Number(expressId);
      if (idSet.has(idNum)) selected.push(idNum);
    }
    if (selected.length > 0) {
      out[String(fragment.id)] = new Set(selected);
    }
  }
  return out;
}

/**
 * Select IFC express IDs visible inside the NDC rectangle (ray grid + depth).
 */
export function selectFragmentsInNdcRect(
  fragmentModel: FragmentModelLike | null | undefined,
  camera: THREE.Camera,
  rect: ScreenRectNdc,
  options: BoxSelectOptions = {}
): FragmentIdMap {
  if (!fragmentModel?.items) return {};

  const allowList = options.allowList ?? null;
  const maxRays = options.maxRays ?? 2400;
  const meshes = collectRaycastMeshes(fragmentModel, allowList);
  if (meshes.length === 0) return {};

  camera.updateMatrixWorld(true);
  if (
    "updateProjectionMatrix" in camera &&
    typeof (camera as THREE.PerspectiveCamera).updateProjectionMatrix === "function"
  ) {
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }

  const { cols, rows } = computeRayGridDimensions(rect, maxRays);
  const hits = new Set<number>();
  const scope = allowList && allowList.size > 0 ? allowList : null;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = rect.minX + ((col + 0.5) / cols) * (rect.maxX - rect.minX);
      const y = rect.minY + ((row + 0.5) / rows) * (rect.maxY - rect.minY);
      _ndc.set(x, y);
      _raycaster.setFromCamera(_ndc, camera);
      const intersections = _raycaster.intersectObjects(meshes, false);
      if (intersections.length === 0) continue;

      const eid = resolveExpressIdFromRaycastHit(intersections[0]);
      if (eid == null) continue;
      if (scope && !scope.has(eid)) continue;
      hits.add(eid);
    }
  }

  return buildMapFromExpressIds(fragmentModel, [...hits]);
}
