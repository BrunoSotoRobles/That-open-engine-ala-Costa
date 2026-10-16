import * as React from "react";
import * as OBC from "@thatopen/components";
import * as OBCF from "@thatopen/components-front";
import * as BUI from "@thatopen/ui";
import * as CUI from "@thatopen/ui-obc";
import { FragmentsGroup } from "@thatopen/fragments";
import { TodoCreator } from "../bim_components/TodoCreator";
import { SimpleQTO } from "../bim_components/SimpleQTO";
import { MaterialQTO } from "../bim_components/Materials";
import { LCACalculator } from "../bim_components/LCA";
import * as THREE from "three";
import { render } from 'lit-html';
import { useLCAStore } from '../stores/LCAStore';
import { MaterialsPage } from './MaterialsPage';
import { ZoomExtendUtil } from "../bim_components/ZoomExtend";
import jsPDF from 'jspdf';
import { Disposable, Resizeable } from "@thatopen/components";
import * as WEBIFC from "web-ifc";
import * as FRAGS from "@thatopen/fragments";
import { CostCalculator } from "../bim_components/Cost";
import { useCostStore } from '../stores/CostStore';
import { getCostBridgeUiText } from '../locales/costBridgeUi';
import { ElementData, IFCQuantityValue } from '../types/cost';
import { IFC } from '../bim_components/Cost';
import { BaseCostElement } from '../types/cost';
import { getTalo2000Quantity } from '../constants/talo2000';
import { isMeasurementExcluded } from '../utils/measurementExclusions';
import { MaterialCostsTableData } from '../types/cost/elements';
import { exposeIFCQuantityServiceToConsole } from '../utils/exposeIFCQuantityService';
import { CrossValidator } from "../services/CrossValidator";
import { ValidationElement } from "../services/CrossValidator";
import { processPendingMcpIfcLoad, setupMCPWebSocket } from "../bim_components/setup";
import {
  screenPointsToNdcRect,
  selectFragmentsInNdcRect,
} from "../utils/boxSelection";
import {
  activateCostaGroupsBucketForModel,
  downloadCostaGroupsPortableFile,
  enrichNamedGroupsWithGlobalIds,
  getCostaGroupsDocument,
  getCostaGroupsPortableDocument,
  importCostaGroupsDocument,
  listNamedGroups,
  rebindNamedGroupMaps,
  removeNamedGroup,
  saveNamedGroup,
  updateNamedGroup,
} from "../utils/costaGroups";
import {
  ensurePanelList,
  renderPanelEmpty,
  renderPanelRow,
  renderPanelSummary,
  type CostaPanelRowAction,
} from "../utils/costaPanelList";
import {
  buildFragmentIdMapForIds,
  buildFragmentIdMapFromRows,
  cloneFragmentIdMap,
  collectIfcTypesFromModel,
  countFragmentIdMap,
  getExpressIdsFromFragmentIdMap,
  mergeFragmentIdMaps,
  queryIfcElements,
  type IfcElementQueryRow,
} from "../utils/ifcElementQuery";
import {
  buildIfcModelTree,
  fragmentMapForExpressIds,
  type IfcModelTreeNode,
} from "../utils/ifcModelTree";
import {
  buildCostaViewerSelectionState,
  type CostaResetViewerVisualOptions,
} from "../utils/costaViewerStateMcp";
import {
  applyManualSelectVisual,
  applyViewerSelectionBridge,
  clearLiveSelectionAsync,
  clearPaintChannelAsync,
  getLiveSelection,
  getPaintChannelMap,
  installViewerSelectionGlobals,
  isFragmentIdMapEmpty,
  noteNativeSelectPaint,
  paintChannel,
  paintPreviewChannel,
  registerExternalSelectionFlag,
  registerGhostPainter,
  registerHighlighter,
  uninstallViewerSelectionGlobals,
} from "../utils/viewerSelection";
import {
  detectOnteloType,
  isIfcSlabType,
  computeFootprintEdges,
  computeSpanLinePoints,
  computePieceCount,
  resolveFieldLength,
  resolvePerpWidth,
  PIECE_WIDTH_M,
  type OnteloType,
} from "../utils/ontelolaattaUtils";

interface Props {
  components: OBC.Components;
  isExpanded?: boolean;
  ifcFilePath?: string;
}

interface TableRow {
  property: string;
  value: string;
  isHeader?: boolean;
}


interface CostRow extends MaterialCostsTableData {
}

export function IFCViewer(props: Props) {
  const setLCAData = useLCAStore(state => state.setLCAData);
  const setProjectInfo = useLCAStore(state => state.setProjectInfo);
  let fragmentModel: FragmentsGroup | undefined;
  /** Model Tree visualize scope (isolate). Shared by Search + lasso. */
  let mwVisualScopeIds: Set<number> | null = null;
  const components: OBC.Components = props.components;
  const worldRef = React.useRef<OBC.World>();
  /** Mapa de líneas activas de LengthMeasurement por expressId (herramienta Ontelolaatta). */
  const onteloLinesRef = React.useRef<Map<number, any>>(new Map());
  const zoomUtilRef = React.useRef<ZoomExtendUtil>();
  const isExternalSelectionRef = React.useRef(false);
  /** Area / lasso selection mode (PoC). Ref kept in sync for pointer handlers in setViewer. */
  const boxSelectEnabledRef = React.useRef(false);
  const [boxSelectEnabled, setBoxSelectEnabled] = React.useState(false);
  const loadingOverlayRef = React.useRef<HTMLDivElement | undefined>(undefined);
  /** Costa group add-mode: active row id + express ids picked in 3D awaiting Update. */
  const groupModeRef = React.useRef<{ activeId: string | null; pendingAddIds: number[] }>({
    activeId: null,
    pendingAddIds: [],
  });
  /** Show All also drops Model Tree visual scope so Search matches what is on screen. */
  const resetTreeVisualScopeRef = React.useRef<(() => void) | null>(null);
  /** Express IDs checked in Element Search — source of truth for Save group. */
  const searchSelectionIdsRef = React.useRef<number[]>([]);

  /** Click pick ON when Area Select OFF; OFF when lazo mode ON. */
  const syncHighlighterWithBoxMode = React.useCallback(() => {
    try {
      const hl = components.get(OBCF.Highlighter) as { enabled?: boolean } | undefined;
      if (hl) hl.enabled = !boxSelectEnabledRef.current;
    } catch {
      /* noop */
    }
  }, [components]);

  const setBoxSelectEnabledSynced = React.useCallback(
    (next: boolean) => {
      boxSelectEnabledRef.current = next;
      setBoxSelectEnabled(next);
      syncHighlighterWithBoxMode();
    },
    [syncHighlighterWithBoxMode]
  );

  React.useEffect(() => {
    boxSelectEnabledRef.current = boxSelectEnabled;
    const btn = document.getElementById("box-select-toggle-btn") as HTMLElement | null;
    if (btn) {
      btn.style.outline = "";
      if (boxSelectEnabled) btn.setAttribute("active", "");
      else btn.removeAttribute("active");
      btn.setAttribute("aria-pressed", boxSelectEnabled ? "true" : "false");
      btn.setAttribute(
        "tooltip-title",
        boxSelectEnabled
          ? "Area Select ON (Esc to exit)"
          : "Area Select"
      );
    }
    syncHighlighterWithBoxMode();
  }, [boxSelectEnabled, syncHighlighterWithBoxMode]);
  const cullingStateRef = React.useRef<{ enabled: boolean; culler: any | null }>({
    enabled: true,
    culler: null
  });
  const modelPerfRef = React.useRef<{ bytes: number; isLarge: boolean; suspiciousStreak: number }>({
    bytes: 0,
    isLarge: false,
    suspiciousStreak: 0
  });
  type GhostTrackableMaterial = THREE.Material & {
    color?: THREE.Color;
    lodColor?: THREE.Color;
    userData: Record<string, unknown>;
  };
  const ghostStateRef = React.useRef<{
    enabled: boolean;
    originalMaterials: Map<GhostTrackableMaterial, { color: number; transparent: boolean; opacity: number; usesLodColor: boolean }>;
    selectedFragmentOriginals: Map<string, THREE.Material | THREE.Material[]>;
  }>({
    enabled: false,
    originalMaterials: new Map(),
    selectedFragmentOriginals: new Map()
  });

  const { setCostData } = useCostStore();

  const LARGE_MODEL_THRESHOLD_BYTES = 120 * 1024 * 1024; // 120MB
  const isSelectionEmpty = isFragmentIdMapEmpty;

  const setGhostModeEnabled = (enabled: boolean, selectedFragmentIds?: Set<string>) => {
    const ghostState = ghostStateRef.current;
    if (!fragmentModel) return;

    // --- Restore previous ghost state first (idempotent) ---
    if (ghostState.selectedFragmentOriginals.size > 0) {
      for (const item of fragmentModel.items) {
        const saved = ghostState.selectedFragmentOriginals.get(String(item.id));
        if (saved !== undefined) {
          item.mesh.material = saved as THREE.Material & THREE.Material[];
        }
      }
      ghostState.selectedFragmentOriginals.clear();
    }
    for (const [material, data] of ghostState.originalMaterials) {
      material.transparent = data.transparent;
      material.opacity = data.opacity;
      if (!data.usesLodColor && "color" in material && material.color) {
        material.color.setHex(data.color);
      } else if ("lodColor" in material && material.lodColor) {
        material.lodColor.setHex(data.color);
      }
      material.needsUpdate = true;
    }
    ghostState.originalMaterials.clear();
    ghostState.enabled = false;

    if (!enabled) return;

    // --- Apply ghost: make shared material(s) transparent ---
    const allMaterials = new Set<GhostTrackableMaterial>();
    for (const item of fragmentModel.items) {
      const meshMat = item.mesh.material;
      if (Array.isArray(meshMat)) {
        for (const m of meshMat) allMaterials.add(m as GhostTrackableMaterial);
      } else if (meshMat) {
        allMaterials.add(meshMat as GhostTrackableMaterial);
      }
    }
    for (const material of allMaterials) {
      if (material.userData?.customId) continue;
      let color = 0xffffff;
      let usesLodColor = false;
      if ("color" in material && material.color) {
        color = material.color.getHex();
      } else if ("lodColor" in material && material.lodColor) {
        color = material.lodColor.getHex();
        usesLodColor = true;
      }
      ghostState.originalMaterials.set(material, {
        color, transparent: material.transparent, opacity: material.opacity, usesLodColor
      });
      material.transparent = true;
      material.opacity = 0.08;
      if ("color" in material && material.color) material.color.setColorName("white");
      else if ("lodColor" in material && material.lodColor) material.lodColor.setColorName("white");
      material.needsUpdate = true;
    }

    // --- Clone material for selected fragments so they stay solid ---
    if (selectedFragmentIds && selectedFragmentIds.size > 0) {
      for (const item of fragmentModel.items) {
        const fragId = String(item.id);
        if (!selectedFragmentIds.has(fragId)) continue;

        const sharedMat = item.mesh.material;
        ghostState.selectedFragmentOriginals.set(fragId, sharedMat);

        const cloneSolid = (mat: THREE.Material): THREE.Material => {
          const orig = ghostState.originalMaterials.get(mat as GhostTrackableMaterial);
          const clone = mat.clone() as GhostTrackableMaterial;
          if (orig) {
            clone.transparent = orig.transparent;
            clone.opacity = orig.opacity;
            if (!orig.usesLodColor && "color" in clone && clone.color) clone.color.setHex(orig.color);
            else if ("lodColor" in clone && clone.lodColor) clone.lodColor.setHex(orig.color);
          }
          clone.needsUpdate = true;
          return clone;
        };

        if (Array.isArray(sharedMat)) {
          item.mesh.material = sharedMat.map(m => cloneSolid(m)) as THREE.Material[];
        } else {
          item.mesh.material = [cloneSolid(sharedMat)] as THREE.Material[];
        }
      }
    }

    ghostState.enabled = true;
  };

  /** Layer-A writes go through viewerSelection facade (safe Highlighter path + ghost). */
  const applySelectionWithStyle = (
    styleName: string,
    selection: Record<string, Set<number>>,
    clearPrevious = true
  ) => {
    applyViewerSelectionBridge(styleName, selection, clearPrevious);
  };

  const applyPerformanceProfileForModel = (bytes: number) => {
    const isLarge = bytes >= LARGE_MODEL_THRESHOLD_BYTES;
    modelPerfRef.current = {
      bytes,
      isLarge,
      suspiciousStreak: 0
    };

    // En modelos grandes, el postprocesado penaliza bastante FPS.
    // Se desactiva automáticamente para priorizar navegación fluida.
    try {
      const world = worldRef.current;
      const rendererAny = world?.renderer as any;
      if (rendererAny?.postproduction) {
        rendererAny.postproduction.enabled = !isLarge;
      }
    } catch {
      // noop
    }
  };

  const setViewer = () => {
    // El usuario no debe configurar esto. Se gestiona automáticamente:
    // iniciamos con culling y si detectamos ocultación incorrecta,
    // hacemos fallback interno a render completo.
    let cullingEnabled = true;
    let lastAuditAt = 0;
    let auditRuns = 0;
    let pendingAuditTimer: number | null = null;
    const MAX_AUDIT_RUNS = 8;
    const MIN_AUDIT_INTERVAL_MS = 1200;
    const worlds = components.get(OBC.Worlds)
    
    const world = worlds.create<
      OBC.SimpleScene,
      OBC.OrthoPerspectiveCamera,
      OBCF.PostproductionRenderer
    >()
    worldRef.current = world;
    // Exponemos el world para que herramientas MCP puedan forzar refresh del renderer.
    (window as any).worldRef = world;
    (window as any).__COSTA_CULLING_ENABLED__ = cullingEnabled;

    const sceneComponent = new OBC.SimpleScene(components)
    world.scene = sceneComponent
    world.scene.setup()

    const viewerContainer = document.getElementById("viewer-container") as HTMLElement
    const rendererComponent = new OBCF.PostproductionRenderer(components, viewerContainer)
    world.renderer = rendererComponent

    const cameraComponent = new OBC.OrthoPerspectiveCamera(components)
    world.camera = cameraComponent
    
    components.init()

    world.renderer.postproduction.enabled = true
    world.camera.controls.setLookAt(3, 3, 3, 0, 0, 0)
    world.camera.updateAspect()

    const viewportGrid = viewerContainer.querySelector<BUI.Grid>("bim-grid[floating]")!

    const fragments = components.get(OBC.FragmentsManager)
    const indexer = components.get(OBC.IfcRelationsIndexer)
    const classifier = components.get(OBC.Classifier)
    classifier.list.CustomSelections = {}

    const ifcLoader = components.get(OBC.IfcLoader)
    ifcLoader.setup()

    // Interceptar eventos del IfcLoader para mostrar overlay
    // Escuchar cuando comienza la carga de IFC
    if (ifcLoader.onIfcStartedLoading) {
      ifcLoader.onIfcStartedLoading.add(() => {
        // Crear overlay con spinner
        if (!loadingOverlayRef.current || !document.body.contains(loadingOverlayRef.current)) {
          loadingOverlayRef.current = document.createElement('div');
          loadingOverlayRef.current.className = 'loading-container';
          loadingOverlayRef.current.id = 'ifc-loading-overlay-global';
          loadingOverlayRef.current.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            background: transparent;
            padding: 0;
            pointer-events: none;
          `;
          loadingOverlayRef.current.innerHTML = `
            <div class="spinner"></div>
            <p style="color: white; margin-top: 20px; margin-bottom: 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">Loading IFC file...</p>
          `;
          document.body.appendChild(loadingOverlayRef.current);
        }
      });
    }

    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ifc'
    
    input.addEventListener('change', async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return
      await handleFileLoad(file);
    })

    const cullers = components.get(OBC.Cullers)
    const culler = cullers.create(world)
    cullingStateRef.current = { enabled: cullingEnabled, culler }

    const forceAllVisibleAndDisableCulling = () => {
      if (!fragmentModel) return;
      cullingEnabled = false;
      cullingStateRef.current.enabled = false;
      (window as any).__COSTA_CULLING_ENABLED__ = false;
      for (const item of fragmentModel.items) {
        item.mesh.visible = true;
      }
      try {
        world.renderer?.update?.();
        world.renderer?.postproduction?.update?.();
      } catch {
        // noop
      }
    };

    const runCullingAudit = () => {
      if (!fragmentModel || !cullingStateRef.current.enabled) return;
      if (auditRuns >= MAX_AUDIT_RUNS) return;
      const now = Date.now();
      if (now - lastAuditAt < MIN_AUDIT_INTERVAL_MS) return;

      lastAuditAt = now;
      auditRuns += 1;

      const total = fragmentModel.items.length;
      if (total === 0) return;

      let invisible = 0;
      let totalHiddenItems = 0;
      for (const item of fragmentModel.items) {
        if (item.mesh?.visible === false) invisible += 1;
        const hidden = item.hiddenItems as any;
        if (hidden?.size) totalHiddenItems += hidden.size;
      }

      const isLargeModel = modelPerfRef.current.isLarge || total > 2500;
      const invisibleRatio = total > 0 ? invisible / total : 0;
      // Caso crítico: casi todo invisible sin ocultaciones explícitas por usuario.
      // Aquí no esperamos reintentos: hacemos fallback inmediato.
      if (invisibleRatio >= 0.85 && totalHiddenItems === 0) {
        forceAllVisibleAndDisableCulling();
        return;
      }
      // En modelos grandes evitamos fallback temprano porque rompe rendimiento.
      // Pedimos más evidencia antes de desactivar culling.
      const suspiciousThreshold = isLargeModel
        ? Math.max(400, Math.floor(total * 0.55))
        : Math.max(50, Math.floor(total * 0.30));
      const requiredStreak = isLargeModel ? 3 : 1;

      if (invisible > suspiciousThreshold) {
        modelPerfRef.current.suspiciousStreak += 1;
      } else {
        modelPerfRef.current.suspiciousStreak = 0;
      }

      if (modelPerfRef.current.suspiciousStreak >= requiredStreak) {
        forceAllVisibleAndDisableCulling();
      }
    };

    const scheduleCullingAudit = (delayMs: number) => {
      if (!cullingStateRef.current.enabled) return;
      if (pendingAuditTimer !== null) {
        window.clearTimeout(pendingAuditTimer);
      }
      pendingAuditTimer = window.setTimeout(() => {
        pendingAuditTimer = null;
        runCullingAudit();
      }, delayMs);
    };

    const fragmentsManager = components.get(OBC.FragmentsManager)
    const startTime = performance.now()
    
    fragmentsManager.onFragmentsLoaded.add(async (model: FragmentsGroup) => {
      // Remover overlay cuando el modelo se carga completamente
      if (loadingOverlayRef.current && document.body.contains(loadingOverlayRef.current)) {
        document.body.removeChild(loadingOverlayRef.current);
        loadingOverlayRef.current = undefined;
      }
      
      world.scene.three.add(model)
      
      if (model.hasProperties) {
        await processModel(model)
      }

      for (const fragment of model.items) {
        // Normalizar visibilidad al cargar para evitar fragmentos invisibles por estados previos.
        fragment.mesh.visible = true
        world.meshes.add(fragment.mesh)
        if (culler) culler.add(fragment.mesh)
      }
      if (culler) culler.needsUpdate = true

      // Mantener la referencia tipada del modelo cargado
      fragmentModel = model as FragmentsGroup
      // Referencia global para acceso desde el panel de búsqueda
      (window as any).fragmentModelRef = model
      // Keep Costa groups (RAM/localStorage); processModel rebinds FragmentIdMaps.
      mwVisualScopeIds = null;

      // Primera auditoría corta tras carga completa del modelo.
      scheduleCullingAudit(350);
      // Segunda auditoría para casos en que el culler se estabiliza tarde.
      scheduleCullingAudit(1400);
    })

    const highlighter = components.get(OBCF.Highlighter);
    highlighter.setup({ world });
    highlighter.zoomToSelection = false;
    // Habilitar selección múltiple nativa del Highlighter.
    // Con Shift-click se añade a la selección en vez de reemplazarla.
    highlighter.multiple = "shiftKey";

    // Instanciar LengthMeasurement para la herramienta Ontelolaatta.
    // enabled=false evita interacción por ratón; visible=true muestra líneas programáticas.
    const measurer = components.get(OBCF.LengthMeasurement);
    measurer.world = world;
    measurer.enabled = false;
    measurer.visible = true;
    measurer.color = new THREE.Color(0x42a5f5);
    OBCF.SimpleDimensionLine.units = "m";
    OBCF.SimpleDimensionLine.rounding = 2;
    (window as any).onteloMeasurerRef = measurer;

    // Agregar estilos Highlighter usados por capa A
    highlighter.add("cost-select", new THREE.Color(0x2196F3));
    /** Preview row in search panel (orange highlight only; does not change live selection). */
    highlighter.add("search-preview", new THREE.Color(0xff9800));

    registerHighlighter(highlighter as any);
    registerGhostPainter(setGhostModeEnabled);
    registerExternalSelectionFlag((v) => {
      isExternalSelectionRef.current = v;
    });
    installViewerSelectionGlobals();

    // No llamar highlighter.clear / highlightByID(style, {}): destruyen events[style] en That Open 2.4.
    // Los estilos custom se reemplazan con la próxima selección.

    highlighter.events.select.onHighlight.add((fragmentIdMap) => {
      if (!isExternalSelectionRef.current) {
        noteNativeSelectPaint();
        const groupMode = groupModeRef.current;
        if (groupMode.activeId !== null) {
          const clicked = getExpressIdsFromFragmentIdMap(fragmentIdMap).map(Number);
          groupMode.pendingAddIds = [...new Set([...groupMode.pendingAddIds, ...clicked])];
        }
      }
      if (isSelectionEmpty(fragmentIdMap)) {
        setGhostModeEnabled(false);
      } else {
        setGhostModeEnabled(true, new Set(Object.keys(fragmentIdMap)));
      }
    });
    highlighter.events.select.onClear.add(() => {
      setGhostModeEnabled(false);
    });
    
    // Referencias globales (facade also installs applyViewerSelection / clearViewerSelection)
    (window as any).highlighterRef = highlighter;

    // --- Area / box selection (lasso) ---
    const boxOverlay = document.createElement("div");
    boxOverlay.className = "box-select-rect";
    boxOverlay.style.display = "none";
    if (getComputedStyle(viewerContainer).position === "static") {
      viewerContainer.style.position = "relative";
    }
    viewerContainer.appendChild(boxOverlay);

    let boxDragging = false;
    let boxStartX = 0;
    let boxStartY = 0;
    let boxControlsWereEnabled = true;

    const getThreeCamera = (): THREE.Camera | null => {
      const camComp = world.camera as { three?: THREE.Camera; controls?: { enabled: boolean } };
      return camComp?.three ?? null;
    };

    const setCameraControlsEnabled = (enabled: boolean) => {
      const controls = (world.camera as { controls?: { enabled: boolean } })?.controls;
      if (!controls) return;
      controls.enabled = enabled;
    };

    const onBoxPointerDown = (e: PointerEvent) => {
      if (!boxSelectEnabledRef.current) return;
      if (e.button !== 0) return;
      const model = (window as any).fragmentModelRef ?? fragmentModel;
      if (!model) return;
      // Ignore drags that start on UI chrome inside the viewer (panels/toolbar).
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("bim-toolbar, bim-panel, bim-button, input, select, textarea, a")) return;

      boxDragging = true;
      boxStartX = e.clientX;
      boxStartY = e.clientY;
      try {
        viewerContainer.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }

      const controls = (world.camera as { controls?: { enabled: boolean } })?.controls;
      boxControlsWereEnabled = controls ? controls.enabled !== false : true;
      setCameraControlsEnabled(false);
      try {
        (highlighter as { enabled?: boolean }).enabled = false;
      } catch {
        /* noop */
      }

      const rect = viewerContainer.getBoundingClientRect();
      boxOverlay.style.display = "block";
      boxOverlay.style.left = `${e.clientX - rect.left}px`;
      boxOverlay.style.top = `${e.clientY - rect.top}px`;
      boxOverlay.style.width = "0px";
      boxOverlay.style.height = "0px";
      e.preventDefault();
      e.stopPropagation();
    };

    const onBoxPointerMove = (e: PointerEvent) => {
      if (!boxDragging) return;
      const rect = viewerContainer.getBoundingClientRect();
      const x1 = Math.min(boxStartX, e.clientX) - rect.left;
      const y1 = Math.min(boxStartY, e.clientY) - rect.top;
      const x2 = Math.max(boxStartX, e.clientX) - rect.left;
      const y2 = Math.max(boxStartY, e.clientY) - rect.top;
      boxOverlay.style.left = `${x1}px`;
      boxOverlay.style.top = `${y1}px`;
      boxOverlay.style.width = `${x2 - x1}px`;
      boxOverlay.style.height = `${y2 - y1}px`;
      e.preventDefault();
    };

    const onBoxPointerUp = (e: PointerEvent) => {
      if (!boxDragging) return;
      boxDragging = false;
      boxOverlay.style.display = "none";
      try {
        viewerContainer.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      setCameraControlsEnabled(boxControlsWereEnabled);

      const finishBoxGesture = () => {
        syncHighlighterWithBoxMode();
      };

      const model = (window as any).fragmentModelRef ?? fragmentModel;
      const camera = getThreeCamera();
      if (!model || !camera) {
        finishBoxGesture();
        return;
      }

      const canvasRect = viewerContainer.getBoundingClientRect();
      const ndcRect = screenPointsToNdcRect(
        { x: boxStartX, y: boxStartY },
        { x: e.clientX, y: e.clientY },
        canvasRect
      );
      if (!ndcRect) {
        finishBoxGesture();
        return;
      }

      let selection = selectFragmentsInNdcRect(model, camera, ndcRect, {
        allowList: mwVisualScopeIds,
      });
      if (e.shiftKey) {
        const current = highlighter.selection.select as Record<string, Set<number>>;
        selection = mergeFragmentIdMaps(current ?? {}, selection);
      }

      const n = countFragmentIdMap(selection);
      const scopeNote =
        mwVisualScopeIds && mwVisualScopeIds.size > 0
          ? ` (tree scope ${mwVisualScopeIds.size})`
          : "";
      console.log(`[BoxSelect] ${n} element(s) selected${scopeNote}`);
      if (n > 0) {
        // Same visual tail as Shift batch: enable Highlighter → select tint → onHighlight/ghost.
        // (Box mode leaves enabled=false; without re-enable, tint never runs and ghost keeps IFC colors.)
        const hl = highlighter as { enabled?: boolean };
        hl.enabled = true;
        void applyManualSelectVisual(selection).finally(() => {
          syncHighlighterWithBoxMode();
        });
      } else {
        finishBoxGesture();
      }
      e.preventDefault();
      e.stopPropagation();
    };

    const onBoxKeyDown = (e: KeyboardEvent) => {
      if (!boxSelectEnabledRef.current) return;
      if (e.key === "Escape") {
        setBoxSelectEnabledSynced(false);
        boxDragging = false;
        boxOverlay.style.display = "none";
        setCameraControlsEnabled(true);
      }
    };

    viewerContainer.addEventListener("pointerdown", onBoxPointerDown);
    viewerContainer.addEventListener("pointermove", onBoxPointerMove);
    viewerContainer.addEventListener("pointerup", onBoxPointerUp);
    window.addEventListener("keydown", onBoxKeyDown);
    (window as any).__costaBoxSelectCleanup = () => {
      viewerContainer.removeEventListener("pointerdown", onBoxPointerDown);
      viewerContainer.removeEventListener("pointermove", onBoxPointerMove);
      viewerContainer.removeEventListener("pointerup", onBoxPointerUp);
      window.removeEventListener("keydown", onBoxKeyDown);
      boxOverlay.remove();
    };

    viewerContainer.addEventListener("resize", () => {
      rendererComponent.resize()
      cameraComponent.updateAspect()
    })

    world.camera.controls.addEventListener("controlend", () => {
      if (cullingStateRef.current.enabled && culler) culler.needsUpdate = true
      // Auditoría ligera post-navegación (throttled + debounce).
      scheduleCullingAudit(250);
    })

    const todoCreator = components.get(TodoCreator)
    todoCreator.world = world
    todoCreator.setup()

    // Initialize ZoomExtendUtil
    zoomUtilRef.current = new ZoomExtendUtil(components);


  }

  const processModel = async (model: FragmentsGroup) => {
    const indexer = components.get(OBC.IfcRelationsIndexer)
    await indexer.process(model)

    const classifier = components.get(OBC.Classifier)
    await classifier.bySpatialStructure(model)
    classifier.byEntity(model)
    // Dedicated storey groups for the Groups panel (IfcBuildingStorey only).
    // web-ifc schema constant IFCBUILDINGSTOREY = 3124254112
    delete classifier.list.storeys
    await classifier.bySpatialStructure(model, {
      systemName: "storeys",
      isolate: new Set([3124254112]),
    })

    // Classifier storeys system (legacy; levels via Model Tree). Model Tree builds IFC hierarchy.
    try {
      const bucket = await activateCostaGroupsBucketForModel(model);
      const report = await rebindNamedGroupMaps(model);
      if (report.warnings.length > 0) {
        console.warn("[Costa groups] Partial rebind:", report.warnings);
      }
      const statusEl = document.getElementById("mw-groups-named-status");
      if (statusEl) {
        if (report.unresolvedMembers > 0) {
          statusEl.textContent = `Groups reloaded: ${report.resolvedMembers} ok, ${report.unresolvedMembers} GUID(s) missing in this IFC.`;
        } else if (bucket.switched) {
          statusEl.textContent = `IFC bucket ${bucket.fingerprint.slice(0, 12)}… · ${bucket.groupCount} group(s).`;
        }
      }
      (window as any).__costaRefreshMwGroupingFooter?.();
      (window as any).__costaRefreshClassificationsPanel?.();
    } catch {
      /* noop */
    }
  }
  
  const extractFragmentProperties = async (fragment: any): Promise<any> => {
    const properties: any = {};
    
    try {
      // Intentar acceder a las propiedades del fragmento
      if ((fragment as any).properties) {
        const fragmentProps = (fragment as any).properties;
        extractPropertiesRecursively(fragmentProps, properties);
      }
      
      // Buscar propiedades en el nombre del fragmento
      if (fragment.name) {
        extractPropertiesFromName(fragment.name, properties);
      }
      
      // Buscar propiedades en el tipo del fragmento
      if (fragment.type) {
        extractPropertiesFromType(fragment.type, properties);
      }
      
    } catch (error) {
      console.warn('[IFCViewer] Error extracting fragment properties:', error);
    }
    
    return properties;
  };

  const extractPropertiesRecursively = (obj: any, properties: any, depth = 0): void => {
    if (!obj || typeof obj !== 'object' || depth > 5) return;
    
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      
      // Buscar propiedades específicas de IFC
      if (lowerKey.includes('property') || lowerKey.includes('predial') || lowerKey.includes('cadastral')) {
        properties[key] = value;
      }
      
      // Buscar información de habitaciones
      if (lowerKey.includes('room') || lowerKey.includes('bedroom') || lowerKey.includes('bathroom')) {
        properties[key] = value;
      }
      
      // Buscar información técnica
      if (lowerKey.includes('system') || lowerKey.includes('technical') || lowerKey.includes('structural')) {
        properties[key] = value;
      }
      
      // Buscar información de permisos
      if (lowerKey.includes('permit') || lowerKey.includes('license') || lowerKey.includes('authorization')) {
        properties[key] = value;
      }
      
      // Buscar información de área
      if (lowerKey.includes('area') || lowerKey.includes('surface') || lowerKey.includes('volume')) {
        properties[key] = value;
      }
      
      // Recursión para objetos anidados
      if (value && typeof value === 'object') {
        extractPropertiesRecursively(value, properties, depth + 1);
      }
    }
  };

  const extractPropertiesFromName = (name: string, properties: any): void => {
    const lowerName = name.toLowerCase();
    
    // Extraer información de habitaciones del nombre
    const roomMatch = lowerName.match(/(\d+)\s*(room|bedroom|bathroom)/);
    if (roomMatch) {
      const count = parseInt(roomMatch[1]);
      const type = roomMatch[2];
      properties[type] = count;
    }
    
    // Extraer información de área del nombre
    const areaMatch = lowerName.match(/(\d+(?:\.\d+)?)\s*(m2|m²|sqm)/);
    if (areaMatch) {
      properties.area = parseFloat(areaMatch[1]);
    }
    
    // Extraer información de pisos del nombre
    const floorMatch = lowerName.match(/(\d+)\s*(floor|story|level)/);
    if (floorMatch) {
      properties.floors = parseInt(floorMatch[1]);
    }
  };

  const extractPropertiesFromType = (type: string, properties: any): void => {
    const lowerType = type.toLowerCase();
    
    // Mapear tipos IFC a información específica
    if (lowerType.includes('ifcwall')) {
      properties.structuralSystem = 'Wall System';
    } else if (lowerType.includes('ifcslab')) {
      properties.structuralSystem = 'Slab System';
    } else if (lowerType.includes('ifcbeam')) {
      properties.structuralSystem = 'Beam System';
    } else if (lowerType.includes('ifccolumn')) {
      properties.structuralSystem = 'Column System';
    } else if (lowerType.includes('ifcspace')) {
      properties.roomType = 'Space';
    } else if (lowerType.includes('ifcroom')) {
      properties.roomType = 'Room';
    }
  };

  const mergeBuildingInfo = (buildingInfo: any, properties: any): void => {
    // Fusionar información de propiedades con la información base del edificio
    for (const [key, value] of Object.entries(properties)) {
      const lowerKey = key.toLowerCase();
      
      // Mapear propiedades específicas
      if (lowerKey.includes('property') && typeof value === 'string') {
        buildingInfo.cadastralInfo.propertyId = value;
      } else if (lowerKey.includes('area') && typeof value === 'number') {
        buildingInfo.cadastralInfo.buildingArea = value;
      } else if (lowerKey.includes('room') && typeof value === 'number') {
        buildingInfo.buildingDetails.totalRooms = value;
      } else if (lowerKey.includes('bedroom') && typeof value === 'number') {
        buildingInfo.buildingDetails.bedrooms = value;
      } else if (lowerKey.includes('bathroom') && typeof value === 'number') {
        buildingInfo.buildingDetails.bathrooms = value;
      } else if (lowerKey.includes('system') && typeof value === 'string') {
        // Mapear sistemas técnicos
        if (lowerKey.includes('heating')) {
          buildingInfo.technicalInfo.heatingSystem = value;
        } else if (lowerKey.includes('cooling')) {
          buildingInfo.technicalInfo.coolingSystem = value;
        } else if (lowerKey.includes('ventilation')) {
          buildingInfo.technicalInfo.ventilationSystem = value;
        }
      }
    }
  };

  const calculateModelBoundingBox = (model: FragmentsGroup): any => {
    try {
      // Calcular bounding box del modelo usando la API correcta de OBC
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let hasValidGeometry = false;
      
      // Usar el método correcto para acceder a la geometría
      for (const fragment of model.items) {
        try {
          // Intentar diferentes formas de acceder a la geometría
          let positions: Float32Array | null = null;
          
          // Método 1: Usar getAttribute si está disponible
          if ((fragment as any).getAttribute) {
            positions = (fragment as any).getAttribute('position') as Float32Array;
          }
          
          // Método 2: Usar la propiedad geometry si existe
          if (!positions && (fragment as any).geometry) {
            const geometry = (fragment as any).geometry;
            if (geometry.attributes && geometry.attributes.position) {
              positions = geometry.attributes.position.array;
            }
          }
          
          // Método 3: Usar la propiedad mesh si existe
          if (!positions && (fragment as any).mesh) {
            const mesh = (fragment as any).mesh;
            if (mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position) {
              positions = mesh.geometry.attributes.position.array;
            }
          }
          
          if (positions && positions.length > 0) {
            hasValidGeometry = true;
            for (let i = 0; i < positions.length; i += 3) {
              const x = positions[i];
              const y = positions[i + 1];
              const z = positions[i + 2];
              
              if (isFinite(x) && isFinite(y) && isFinite(z)) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                minZ = Math.min(minZ, z);
                maxZ = Math.max(maxZ, z);
              }
            }
          }
        } catch (error) {
          console.warn('[IFCViewer] Error processing fragment geometry:', error);
          continue;
        }
      }
      
      // Si no se encontró geometría válida, usar valores por defecto
      if (!hasValidGeometry || !isFinite(minX) || !isFinite(maxX)) {
        console.warn('[IFCViewer] No valid geometry found, using default dimensions');
        return {
          width: 10,  // 10 metros por defecto
          length: 10,
          height: 3,
          surface: 100,  // 100 m²
          volume: 300    // 300 m³
        };
      }
      
      const width = Math.abs(maxX - minX);
      const length = Math.abs(maxY - minY);
      const height = Math.abs(maxZ - minZ);
      const surface = width * length;
      const volume = width * length * height;
      
      
      
      return { width, length, height, surface, volume };
    } catch (error) {
      console.error('[IFCViewer] Error calculating bounding box:', error);
      // Retornar valores por defecto en caso de error
      return {
        width: 10,
        length: 10,
        height: 3,
        surface: 100,
        volume: 300
      };
    }
  };

  // Función helper para forzar actualización del renderer y culler
  const forceRendererUpdate = (delay: number = 50) => {
    if (!worldRef.current) return;

    const { enabled, culler } = cullingStateRef.current;
    if (enabled && culler) {
      culler.needsUpdate = true
    }

    // Forzar actualización después de un delay para asegurar que los cambios se hayan aplicado
    setTimeout(() => {
      if (worldRef.current && enabled && culler) {
        culler.needsUpdate = true
      }
    }, delay)
  }

  const onToggleVisibility = () => {
    // Visibility only — does not change live selection or ghost.
    const highlighter = components.get(OBCF.Highlighter)
    const fragments = components.get(OBC.FragmentsManager)

    const selection = highlighter.selection.select
    if (Object.keys(selection).length === 0) return;
    
    for (const fragmentID in selection) {  
      const fragment = fragments.list.get(fragmentID)
      const expressIDs = selection[fragmentID]
      for (const id of expressIDs) {
        if (!fragment) continue
        const isHidden = fragment.hiddenItems.has(id)
        if (isHidden) {
          fragment.setVisibility(true, [id])
        } else {
          fragment.setVisibility(false, [id])
        }
      }
    }
    
    // Forzar actualización del renderer después de cambiar visibilidad
    forceRendererUpdate(50)
  }

  /** Isolate ≠ clear selection. Hides non-selected meshes; live + ghost stay. */
  const onIsolate = () => {
    const highlighter = components.get(OBCF.Highlighter)
    const hider = components.get(OBC.Hider)
    const selection = highlighter.selection.select
    
    if (!selection || Object.keys(selection).length === 0) {
      return;
    }
    
    hider.isolate(selection)
    forceRendererUpdate(50)
  };

  /** Feedback line under the Costa groups list. Call after refreshMwGroupingFooter. */
  const setGroupsStatus = (message: string) => {
    const el = document.getElementById("mw-groups-named-status");
    if (el) el.textContent = message;
  };

  /** Model/Selection reads live bag + tree scope; keep the on-screen hints in sync. */
  const syncModelSelectionHints = () => {
    (window as any).__costaUpdateMwSearchScopeHint?.();
    (window as any).__costaUpdateMwLiveSelectionHint?.();
  };

  const refreshGroupsList = () => {
    (window as any).__costaRefreshMwGroupingFooter?.();
  };

  /**
   * Drops tint, ghost and the live bag, then resyncs Search / Property hints.
   * Does not touch the Hider.
   */
  const clearSelectionStateAndResync = (): Promise<void> =>
    clearLiveSelectionAsync().then(() => {
      forceRendererUpdate(50);
      syncModelSelectionHints();
    });

  /** Full reset of what a group left behind, visibility included. */
  const clearGroupVisualState = () => {
    components.get(OBC.Hider).set(true);
    void clearSelectionStateAndResync().then(() => refreshGroupsList());
    forceRendererUpdate(50);
  };

  /**
   * Leaves Costa group add-mode: clicks/lasso go back to plain selection + Property panel.
   * Does not touch the Hider, so an active Isolate survives closing the panel.
   */
  const exitGroupAddMode = (): Promise<void> => {
    const groupMode = groupModeRef.current;
    if (groupMode.activeId === null) return Promise.resolve();
    groupMode.activeId = null;
    groupMode.pendingAddIds = [];
    refreshGroupsList();
    return clearSelectionStateAndResync().then(() => {
      (window as any).__costaReapplySearchSelection?.();
    });
  };

  /**
   * Restores Hider visibility and the Model Tree visual allow-list.
   * Does not touch live click/lasso selection — that is a separate bag.
   */
  const onShowAll = () => {
    components.get(OBC.Hider).set(true);
    resetTreeVisualScopeRef.current?.();
    forceRendererUpdate(50);
    syncModelSelectionHints();
  };

  const onZoomExtend = async () => {
    if (!fragmentModel || !zoomUtilRef.current || !worldRef.current) {
      return;
    }
    
    try {
      await zoomUtilRef.current.zoomToModel(fragmentModel, worldRef.current);
      
      // Forzar actualización del renderer después del zoom
      forceRendererUpdate(100)
    } catch (error) {
      // Error silencioso - el zoom puede fallar si no hay modelo cargado
    }
  }

  const getSnapshot = () => {
    const world = worldRef.current;
    if (!world || !world.renderer) return null;
    
    const renderer = (world.renderer as OBCF.PostproductionRenderer).three;
    if (!renderer) return null;
    
    return renderer.domElement.toDataURL();
  };

  const setupUI = () => {
    const viewerContainer = document.getElementById("viewer-container") as HTMLElement
    if (!viewerContainer) return

    // Asegurar que el contenedor tenga position relative para el posicionamiento absoluto de la toolbar
    viewerContainer.style.position = 'relative';

    // Store validation results
    let validationPass: Record<string, Set<number>> = {};
    let validationFail: Record<string, Set<number>> = {};

    const floatingGrid = BUI.Component.create<BUI.Grid>(() => {
      // Ajustar padding según el modo full screen
      // Padding inferior normal ya que la toolbar está fuera del grid
      const padding = props.isExpanded ? "20px 20px 20px 20px" : "20px 20px 20px 20px";
      return BUI.html`
        <bim-grid floating style="padding: ${padding};"></bim-grid>
      `
    })

    /** IfcPropertySingleValue inside an IfcPropertySet named costa_* (or Pset_Costa*). */
    type CostaDraftProperty = {
      localId: string;
      psetName: string;
      propertyName: string;
      value: string;
      originalValue: string;
      isNew: boolean;
    };

    type PropertyEditDraftEntry = {
      expressId: number;
      globalId: string;
      typeLabel: string;
      /** IfcRoot.Name */
      originalName: string;
      /** IfcRoot.Description */
      originalDescription: string;
      name: string;
      description: string;
      /** IfcPropertySet properties (Costa namespace) */
      costaProperties: CostaDraftProperty[];
      originalCostaProperties: CostaDraftProperty[];
      dirty: boolean;
    };

    const COSTA_PSET_PREFIX = "costa_";

    const propertyDraftStore: {
      activeTab: "view" | "edit";
      drafts: Record<number, PropertyEditDraftEntry>;
      currentFragmentIdMap: Record<string, Set<number>>;
      /** Staging form for new IfcPropertySingleValue (not yet added to selection). */
      newCostaPsetSuffix: string;
      newCostaPropertyName: string;
      newCostaPropertyValue: string;
    } = {
      activeTab: "view",
      drafts: {},
      currentFragmentIdMap: {},
      newCostaPsetSuffix: "",
      newCostaPropertyName: "",
      newCostaPropertyValue: "",
    };

    (window as any).costaPropertyDraftStore = propertyDraftStore;
    /** Session groups doc (name + expressIds) — MCP tools. */
    (window as any).costaGroupsGetDocument = () => getCostaGroupsDocument();
    /** Portable v2 doc (GlobalId members). */
    (window as any).costaGroupsGetPortableDocument = () => getCostaGroupsPortableDocument();

    /** Save Costa group from live selection (3D) and/or Element Search checkboxes. */
    const resolveGroupSaveMap = (): Record<string, Set<number>> => {
      const model =
        fragmentModel ?? ((window as any).fragmentModelRef as FragmentsGroup | undefined);
      const searchIds = searchSelectionIdsRef.current;
      const searchMap =
        searchIds.length > 0 && model
          ? buildFragmentIdMapForIds(model, searchIds)
          : {};
      const live = getLiveSelection();
      if (countFragmentIdMap(searchMap) === 0) return live;
      if (countFragmentIdMap(live) === 0) return searchMap;
      return mergeFragmentIdMaps(live, searchMap);
    };

    const getEditFragmentIdMap = (): Record<string, Set<number>> =>
      propertyDraftStore.currentFragmentIdMap;

    const escapePropertyHtml = (unsafe: string) =>
      unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    const getSelectionExpressIds = (fragmentIdMap: Record<string, Set<number>>): number[] => {
      const ids: number[] = [];
      for (const fragmentId of Object.keys(fragmentIdMap)) {
        for (const expressId of fragmentIdMap[fragmentId]) {
          ids.push(Number(expressId));
        }
      }
      return ids;
    };

    const makeCostaDraftLocalId = () =>
      `costa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const normalizeCostaPsetSuffix = (suffix: string): string =>
      suffix.trim().replace(/^costa_/i, "").replace(/\s+/g, "_");

    const buildCostaPsetName = (suffix: string): string => {
      const normalized = normalizeCostaPsetSuffix(suffix);
      return normalized ? `${COSTA_PSET_PREFIX}${normalized}` : COSTA_PSET_PREFIX.slice(0, -1);
    };

    const isCostaIfcPsetName = (psetName: string): boolean => {
      const lower = psetName.toLowerCase();
      return lower.startsWith(COSTA_PSET_PREFIX) || lower.startsWith("pset_costa");
    };

    const cloneCostaProperties = (props: CostaDraftProperty[]): CostaDraftProperty[] =>
      props.map((p) => ({ ...p }));

    const costaPropertiesEqual = (a: CostaDraftProperty[], b: CostaDraftProperty[]): boolean => {
      if (a.length !== b.length) return false;
      const sortKey = (p: CostaDraftProperty) => `${p.psetName}\0${p.propertyName}\0${p.value}`;
      const sa = [...a].map(sortKey).sort();
      const sb = [...b].map(sortKey).sort();
      return sa.every((key, i) => key === sb[i]);
    };

    const recomputePropertyDraftDirty = (entry: PropertyEditDraftEntry) => {
      entry.dirty =
        entry.name !== entry.originalName ||
        entry.description !== entry.originalDescription ||
        !costaPropertiesEqual(entry.costaProperties, entry.originalCostaProperties);
    };

    const loadCostaPropertiesFromIfc = async (expressId: number): Promise<CostaDraftProperty[]> => {
      if (!fragmentModel) return [];
      const indexer = components.get(OBC.IfcRelationsIndexer);
      const propertyRelations = indexer.getEntityRelations(fragmentModel, expressId, "IsDefinedBy");
      if (!propertyRelations) return [];

      const result: CostaDraftProperty[] = [];
      for (const relId of propertyRelations) {
        const relation = await fragmentModel.getProperties(relId);
        if (!relation?.HasProperties || relation.Quantities) continue;
        const psetName = String(relation.Name?.value ?? "").trim();
        if (!psetName || !isCostaIfcPsetName(psetName)) continue;
        for (const propRef of relation.HasProperties) {
          try {
            const property = await fragmentModel.getProperties(propRef.value);
            if (!property) continue;
            const propertyName = String(property.Name?.value ?? "").trim();
            if (!propertyName) continue;
            const raw = property.NominalValue?.value;
            const value =
              raw === undefined || raw === null ? "" : typeof raw === "string" || typeof raw === "number" ? String(raw) : String(raw);
            result.push({
              localId: makeCostaDraftLocalId(),
              psetName,
              propertyName,
              value,
              originalValue: value,
              isNew: false,
            });
          } catch {
            continue;
          }
        }
      }
      return result;
    };

    const countDirtyPropertyDrafts = (): number =>
      Object.values(propertyDraftStore.drafts).filter((entry) => entry.dirty).length;

    /** Panel host; assigned when elementPropertyPanel is created (may be in shadow DOM). */
    let propertyPanelRoot: HTMLElement | null = null;

    const queryInPropertyPanel = (selector: string): HTMLElement | null => {
      const roots: (ParentNode | null | undefined)[] = [
        propertyPanelRoot,
        propertyPanelRoot?.shadowRoot,
        document,
      ];
      for (const root of roots) {
        if (!root) continue;
        const hit = root.querySelector(selector) as HTMLElement | null;
        if (hit) return hit;
      }
      return null;
    };

    /** bim-table edit rows use a light cell background; theme contrast vars are light-on-dark. */
    const PROPERTY_EDIT_TREE_COLORS = {
      section: "#1565c0",
      hint: "#757575",
      element: "#212121",
      elementMeta: "#616161",
      label: "#424242",
    } as const;

    /** Global CSS does not pierce bim-panel shadow; inject readable colors there. */
    const injectPropertyPanelShadowStyles = () => {
      const shadow = propertyPanelRoot?.shadowRoot;
      if (!shadow || shadow.querySelector("#costa-property-panel-shadow-css")) return;
      const style = document.createElement("style");
      style.id = "costa-property-panel-shadow-css";
      style.textContent = `
        .property-panel-tab {
          color: var(--bim-ui_main-contrast-80, #9e9e9e) !important;
        }
        .property-panel-tab[data-active] {
          color: var(--bim-ui_accent, #42a5f5) !important;
          background: rgba(66, 165, 245, 0.14) !important;
          font-weight: 600;
        }
        .property-edit-ifc-hint,
        .property-edit-section-desc {
          color: var(--bim-ui_main-contrast-70, #b0b0b0) !important;
        }
        .property-edit-ifc-hint code,
        .property-edit-section-desc code {
          color: var(--bim-ui_accent, #64b5f6) !important;
        }
        .ontelo-type-label {
          display: block;
          font-weight: 600;
          font-size: 11px;
          color: var(--bim-ui_main-contrast-100, #e0e0e0) !important;
          margin-bottom: 4px;
        }
        .ontelo-summary-label {
          display: block;
          font-size: 11px;
          line-height: 1.4;
          color: var(--bim-ui_main-contrast-80, #b0b0b0) !important;
          margin-bottom: 8px;
        }
        .ontelo-status-label {
          display: block;
          font-size: 10px;
          color: var(--bim-ui_main-contrast-70, #9e9e9e) !important;
          margin-top: 4px;
        }
        .ontelo-actions-row {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
      `;
      shadow.appendChild(style);
    };

    const injectPropertyEditTreeShadowStyles = (table: HTMLElement) => {
      const shadow = table.shadowRoot;
      if (!shadow) return;
      let style = shadow.querySelector("#costa-property-edit-tree-css") as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = "costa-property-edit-tree-css";
        shadow.appendChild(style);
      }
      const c = PROPERTY_EDIT_TREE_COLORS;
      style.textContent = `
        bim-table-cell,
        bim-table-group {
          color: ${c.label} !important;
          font-size: 11px !important;
          line-height: 1.35 !important;
        }
        .property-edit-tree-section {
          color: ${c.section} !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
        }
        .property-edit-tree-hint {
          color: ${c.hint} !important;
          font-size: 10px !important;
          font-style: italic !important;
          line-height: 1.35 !important;
        }
        .property-edit-tree-element {
          color: ${c.element} !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          line-height: 1.35 !important;
        }
        .property-edit-tree-element-meta {
          color: ${c.elementMeta} !important;
          font-size: 10px !important;
          font-weight: 400 !important;
        }
        bim-text-input.property-edit-tree-input {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          font-size: 11px !important;
          --bim-label--c-font-size: 11px;
        }
        bim-table-cell[column="rowKind"],
        bim-table-cell[column="expressId"],
        bim-table-cell[column="Entity"],
        bim-table-cell[column="editKind"],
        bim-table-cell[column="localId"],
        bim-table-cell[column="entity"] {
          display: none !important;
        }
      `;
    };

    const setPropertyPanelTab = (tab: "view" | "edit") => {
      injectPropertyPanelShadowStyles();
      propertyDraftStore.activeTab = tab;
      const viewSection = queryInPropertyPanel("#property-view-section");
      const editSection = queryInPropertyPanel("#property-edit-section");
      const viewBtn = queryInPropertyPanel("#property-tab-view-btn");
      const editBtn = queryInPropertyPanel("#property-tab-edit-btn");
      if (viewSection) viewSection.style.display = tab === "view" ? "" : "none";
      if (editSection) editSection.style.display = tab === "edit" ? "" : "none";
      if (viewBtn) {
        viewBtn.toggleAttribute("data-active", tab === "view");
        viewBtn.setAttribute("aria-selected", tab === "view" ? "true" : "false");
      }
      if (editBtn) {
        editBtn.toggleAttribute("data-active", tab === "edit");
        editBtn.setAttribute("aria-selected", tab === "edit" ? "true" : "false");
      }
      if (tab === "edit") {
        void syncPropertyDraftsFromSelection(propertyDraftStore.currentFragmentIdMap).then(() => {
          updatePropertyEditContent();
        });
      }
    };

    (window as any).costaSetPropertyPanelTab = setPropertyPanelTab;

    const updatePropertyEditStatus = () => {
      const statusEl = queryInPropertyPanel("#property-edit-status");
      const editTabBtn = queryInPropertyPanel("#property-tab-edit-btn");
      const selectedCount = getSelectionExpressIds(getEditFragmentIdMap()).length;
      const dirtyCount = countDirtyPropertyDrafts();
      if (editTabBtn) {
        editTabBtn.textContent =
          dirtyCount > 0 ? `Edit properties (${dirtyCount})` : "Edit properties";
      }
      if (!statusEl) return;
      if (selectedCount === 0) {
        statusEl.textContent = "No selection. Select elements in the viewer to edit.";
        return;
      }
      statusEl.textContent =
        dirtyCount > 0
          ? `${selectedCount} element(s) selected · ${dirtyCount} unsaved change(s) (stored locally)`
          : `${selectedCount} element(s) selected · changes are stored locally until you discard them`;
    };

    type PropertyEditRowKind = "element-header" | "section" | "pset" | "hint";
    type PropertyEditTreeRow = {
      Name?: string;
      Value?: string;
    };
    type PropertyEditRowMeta = {
      rowKind?: PropertyEditRowKind;
      editKind?: "name" | "description" | "costa";
      expressId?: number;
      localId?: string;
      entity?: string;
    };
    const PROPERTY_EDIT_ROW_META = Symbol("propertyEditRowMeta");

    const editTreeRow = (
      name: string,
      meta: PropertyEditRowMeta = {},
      value?: string
    ): PropertyEditTreeRow => {
      const row: PropertyEditTreeRow = { Name: name };
      if (value !== undefined) row.Value = value;
      Object.defineProperty(row, PROPERTY_EDIT_ROW_META, {
        value: meta,
        enumerable: false,
      });
      return row;
    };

    const getEditRowMeta = (row: PropertyEditTreeRow): PropertyEditRowMeta =>
      (Reflect.get(row, PROPERTY_EDIT_ROW_META) as PropertyEditRowMeta | undefined) ?? {};

    const PROPERTY_EDIT_TABLE_COLUMNS = [
      { name: "Name", width: "minmax(4.5rem, 28%)" },
      { name: "Value", width: "minmax(14rem, 1fr)" },
    ] as const;

    let propertyEditTreeInitialized = false;

    const handlePropertyEditTreeInput = (e: Event) => {
      const input = e.target as BUI.TextInput;
      if (!input?.classList?.contains("property-edit-tree-input")) return;
      const editKind = input.getAttribute("data-edit-kind") as "name" | "description" | "costa" | null;
      const expressId = Number(input.getAttribute("data-express-id"));
      if (!editKind || Number.isNaN(expressId)) return;
      const entry = propertyDraftStore.drafts[expressId];
      if (!entry) return;
      const value = input.value ?? "";
      if (editKind === "name") entry.name = value;
      else if (editKind === "description") entry.description = value;
      else if (editKind === "costa") {
        const localId = input.getAttribute("data-local-id");
        const prop = entry.costaProperties.find((p) => p.localId === localId);
        if (prop) prop.value = value;
      }
      recomputePropertyDraftDirty(entry);
      updatePropertyEditStatus();
    };

    const buildPropertyEditTreeData = (selectedIds: number[]): Array<{ data: PropertyEditTreeRow; children?: unknown[] }> => {
      const roots: Array<{ data: PropertyEditTreeRow; children?: unknown[] }> = [];
      for (const expressId of selectedIds) {
        const entry = propertyDraftStore.drafts[expressId];
        if (!entry) {
          roots.push({
            data: editTreeRow(`Element ${expressId}`, { rowKind: "hint", expressId }),
            children: [{ data: editTreeRow("Loading properties…", { rowKind: "hint" }) }],
          });
          continue;
        }

        const psetGroups = new Map<string, CostaDraftProperty[]>();
        for (const prop of entry.costaProperties) {
          const list = psetGroups.get(prop.psetName) ?? [];
          list.push(prop);
          psetGroups.set(prop.psetName, list);
        }

        const costaChildren: Array<{ data: PropertyEditTreeRow; children?: unknown[] }> = [
          { data: editTreeRow("Costa Property Sets (IfcPropertySet)", { rowKind: "section" }) },
        ];
        if (psetGroups.size === 0) {
          costaChildren.push({
            data: editTreeRow("(no Costa properties — use toolbar below to add)", { rowKind: "hint" }),
          });
        } else {
          for (const [psetName, props] of psetGroups) {
            costaChildren.push({
              data: editTreeRow(psetName, { rowKind: "pset" }),
              children: props.map((p) => ({
                data: editTreeRow(p.propertyName, {
                  editKind: "costa",
                  expressId,
                  localId: p.localId,
                }, p.value),
              })),
            });
          }
        }

        const headerLabel =
          selectedIds.length > 1
            ? `${entry.name || entry.originalName || "Unnamed"} (${entry.typeLabel})`
            : entry.name || entry.originalName || "Unnamed";

        roots.push({
          data: editTreeRow(headerLabel, {
            rowKind: "element-header",
            expressId,
            entity: entry.typeLabel,
          }),
          children: [
            { data: editTreeRow("IfcRoot — editable attributes", { rowKind: "section" }) },
            {
              data: editTreeRow("Name", { editKind: "name", expressId }, entry.name),
            },
            {
              data: editTreeRow("Description", { editKind: "description", expressId }, entry.description),
            },
            ...costaChildren,
          ],
        });
      }
      return roots;
    };

    const initPropertyEditTreeTable = () => {
      if (propertyEditTreeInitialized) return;
      const table = queryInPropertyPanel("#property-edit-tree") as BUI.Table & HTMLElement;
      if (!table) return;

      table.headersHidden = true;
      table.columns = [...PROPERTY_EDIT_TABLE_COLUMNS];

      injectPropertyEditTreeShadowStyles(table);

      table.dataTransform = {
        Name: (value: unknown, row: PropertyEditTreeRow) => {
          const meta = getEditRowMeta(row);
          const c = PROPERTY_EDIT_TREE_COLORS;
          if (meta.rowKind === "section" || meta.rowKind === "pset") {
            return BUI.html`<span class="property-edit-tree-section" style="color:${c.section}">${String(value ?? "")}</span>`;
          }
          if (meta.rowKind === "hint") {
            return BUI.html`<span class="property-edit-tree-hint" style="color:${c.hint}">${String(value ?? "")}</span>`;
          }
          if (meta.rowKind === "element-header") {
            const entity = meta.entity ? ` · ${meta.entity}` : "";
            return BUI.html`<span class="property-edit-tree-element" style="color:${c.element}"><span>${String(value ?? "")}</span><span class="property-edit-tree-element-meta" style="color:${c.elementMeta}">${entity}</span></span>`;
          }
          return BUI.html`<span style="color:${c.label}">${String(value ?? "")}</span>`;
        },
        Value: (value: unknown, row: PropertyEditTreeRow) => {
          const meta = getEditRowMeta(row);
          if (!meta.editKind) return value !== undefined && value !== null ? String(value) : "";
          const expressId = meta.expressId ?? "";
          const localId = meta.localId ?? "";
          return BUI.html`
            <bim-text-input
              class="property-edit-tree-input"
              data-edit-kind="${meta.editKind}"
              data-express-id="${expressId}"
              data-local-id="${localId}"
              value="${escapePropertyHtml(String(value ?? ""))}"
              @input=${handlePropertyEditTreeInput}
            ></bim-text-input>
          `;
        },
      };

      const hiddenEditTreeColumns = new Set([
        "rowKind",
        "expressId",
        "Entity",
        "editKind",
        "localId",
        "entity",
      ]);

      table.addEventListener("cellcreated", ((event: CustomEvent) => {
        const { cell, row } = event.detail as {
          cell: HTMLElement & { column?: string };
          row: { data: PropertyEditTreeRow };
        };
        const rowData = row.data;
        const meta = getEditRowMeta(rowData);
        if (cell.column && hiddenEditTreeColumns.has(cell.column)) {
          cell.style.display = "none";
          return;
        }
        if (cell.column === "Name" && !("Value" in rowData) && meta.rowKind !== "element-header") {
          cell.style.gridColumn = "1 / -1";
        }
        if (cell.column === "Value" && meta.editKind) {
          cell.style.minWidth = "0";
        }
      }) as EventListener);

      propertyEditTreeInitialized = true;
    };

    const wirePropertyEditToolbar = () => {
      const toolbar = queryInPropertyPanel("#property-edit-toolbar");
      if (!toolbar || toolbar.dataset.costaWired === "1") return;
      toolbar.dataset.costaWired = "1";

      const updatePsetPreview = () => {
        const preview = queryInPropertyPanel("#property-costa-pset-preview");
        if (preview) preview.textContent = buildCostaPsetName(propertyDraftStore.newCostaPsetSuffix);
      };

      queryInPropertyPanel("#property-costa-pset-suffix")?.addEventListener("input", (e) => {
        propertyDraftStore.newCostaPsetSuffix = ((e.target as BUI.TextInput).value ?? "").trim();
        updatePsetPreview();
      });
      queryInPropertyPanel("#property-costa-prop-name")?.addEventListener("input", (e) => {
        propertyDraftStore.newCostaPropertyName = ((e.target as BUI.TextInput).value ?? "").trim();
      });
      queryInPropertyPanel("#property-costa-prop-value")?.addEventListener("input", (e) => {
        propertyDraftStore.newCostaPropertyValue = (e.target as BUI.TextInput).value ?? "";
      });

      queryInPropertyPanel("#property-costa-add-btn")?.addEventListener("click", () => {
        const selectedIds = getSelectionExpressIds(getEditFragmentIdMap());
        const propertyName = propertyDraftStore.newCostaPropertyName.trim();
        const value = propertyDraftStore.newCostaPropertyValue;
        if (!propertyName || selectedIds.length === 0) return;
        const psetName = buildCostaPsetName(propertyDraftStore.newCostaPsetSuffix);
        for (const expressId of selectedIds) {
          const entry = propertyDraftStore.drafts[expressId];
          if (!entry) continue;
          const existing = entry.costaProperties.find(
            (p) => p.psetName === psetName && p.propertyName === propertyName
          );
          if (existing) existing.value = value;
          else {
            entry.costaProperties.push({
              localId: makeCostaDraftLocalId(),
              psetName,
              propertyName,
              value,
              originalValue: "",
              isNew: true,
            });
          }
          recomputePropertyDraftDirty(entry);
        }
        propertyDraftStore.newCostaPropertyName = "";
        propertyDraftStore.newCostaPropertyValue = "";
        updatePropertyEditContent();
      });

      queryInPropertyPanel("#property-discard-drafts-btn")?.addEventListener("click", () => {
        const selectedIds = getSelectionExpressIds(getEditFragmentIdMap());
        for (const expressId of selectedIds) {
          const entry = propertyDraftStore.drafts[expressId];
          if (!entry) continue;
          entry.name = entry.originalName;
          entry.description = entry.originalDescription;
          entry.costaProperties = cloneCostaProperties(entry.originalCostaProperties);
          recomputePropertyDraftDirty(entry);
        }
        propertyDraftStore.newCostaPsetSuffix = "";
        propertyDraftStore.newCostaPropertyName = "";
        propertyDraftStore.newCostaPropertyValue = "";
        updatePropertyEditContent();
      });

      updatePsetPreview();
    };

    // ─── Estado de cierre para el panel Ontelolaatta ────────────────────────
    let currentOnteloGlobalId: string | null = null;
    let currentOnteloExpressId: number | null = null;

    /**
     * Actualiza el DOM del bloque ontelolaatta.
     * @param spanLength  Longitud del vano (lo que mide la línea)
     * @param perpWidth   Ancho total perpendicular al vano (N piezas × 1.2 m)
     */
    const updateOnteloPanelDOM = (
      globalId: string,
      onteloType: OnteloType,
      spanLength: number,
      perpWidth: number,
      confirmed: boolean,
      summaryOverride?: string
    ) => {
      const pieceCount = computePieceCount(perpWidth);
      const thicknessStr = onteloType.thicknessMm
        ? `${onteloType.thicknessMm} mm`
        : "thickness not in catalogue";
      const totalM2 = (pieceCount * spanLength * PIECE_WIDTH_M).toFixed(1);

      const panelEl  = queryInPropertyPanel("#ontelo-panel");
      const typeEl   = queryInPropertyPanel("#ontelo-type");
      const sumEl    = queryInPropertyPanel("#ontelo-summary");
      const statusEl = queryInPropertyPanel("#ontelo-status");

      if (panelEl)  (panelEl as HTMLElement).style.display = "";
      if (typeEl)   typeEl.textContent = `${onteloType.code} — ${thicknessStr}`;
      if (sumEl)    sumEl.textContent  = summaryOverride ??
        `${pieceCount} kpl × ${spanLength.toFixed(2)} m × ${PIECE_WIDTH_M.toFixed(2)} m ≈ ${totalM2} m²`;
      if (statusEl) statusEl.textContent = confirmed ? "Confirmed" : "Pending confirmation";
    };

    const onteloStoreKey = (globalId: string, expressId: number) =>
      globalId.trim() || `express:${expressId}`;

    const ensureOnteloMeasurerReady = () => {
      const measurer = components.get(OBCF.LengthMeasurement);
      const world = worldRef.current;
      if (world && !measurer.world) measurer.world = world;
      measurer.visible = true;
      measurer.color = new THREE.Color(0x42a5f5);
      return measurer;
    };

    /**
     * Calcula la orientación del vano para el slab Oxx seleccionado, dibuja la línea
     * de LengthMeasurement y actualiza el panel de propiedades.
     * Reutiliza la entrada confirmada del store si existe.
     */
    const refreshOntelolaattaUI = (
      expressId: number,
      name: string,
      globalId: string
    ) => {
      const measurer = ensureOnteloMeasurerReady();
      const onteloLines = onteloLinesRef.current;

      // Eliminar línea previa para este expressId
      const prevLine = onteloLines.get(expressId);
      if (prevLine) {
        measurer.deleteMeasurement(prevLine).catch(() => {});
        onteloLines.delete(expressId);
      }

      currentOnteloExpressId = expressId;

      if (!fragmentModel) return;

      const onteloType = detectOnteloType(name);
      if (!onteloType) return;

      const storeKey = onteloStoreKey(globalId, expressId);
      currentOnteloGlobalId  = storeKey;
      const store       = useCostStore.getState();
      const existing    = store.ontelolaattaMcp.byGlobalId[storeKey];
      const edges       = computeFootprintEdges(fragmentModel, expressId);

      if (!edges) {
        console.warn("[ontelolaatta] No geometry for expressId", expressId);
        updateOnteloPanelDOM(
          storeKey,
          onteloType,
          0,
          0,
          existing?.confirmed ?? false,
          "— could not read slab geometry (line unavailable)"
        );
        return;
      }

      let { spanDir, perpDir } = edges;
      // Por defecto: línea a lo largo del eje CORTO = vano real del slab
      let lineAlongLong = false;

      const useStoredOrientation =
        existing &&
        (existing.confirmed || existing.source === "user-flipped");

      if (useStoredOrientation) {
        spanDir       = existing.spanDir;
        perpDir       = existing.perpDir;
        lineAlongLong = existing.lineAlongLong ?? false;
      } else {
        const autoLine = computeSpanLinePoints(edges, false);
        const autoPerpWidth = resolvePerpWidth(edges, false);
        store.setOntelolaattaOrientation(storeKey, {
          globalId: storeKey,
          expressId,
          onteloType:  onteloType.code,
          thicknessMm: onteloType.thicknessMm,
          spanDir,
          perpDir,
          fieldLength: resolveFieldLength(edges, false, autoLine.p1, autoLine.p2),
          fieldWidth:  autoPerpWidth,
          pieceWidth:  PIECE_WIDTH_M,
          pieceCount:  computePieceCount(autoPerpWidth),
          lineAlongLong: false,
          source:      "auto",
        });
      }

      const { p1, p2 } = computeSpanLinePoints(edges, lineAlongLong);
      const measuredLineLengthM = p1.distanceTo(p2);
      const resolvedFieldLength = resolveFieldLength(edges, lineAlongLong, p1, p2);
      const perpWidth = resolvePerpWidth(edges, lineAlongLong);

      if (useCostStore.getState().ontelolaattaMcp.byGlobalId[storeKey]) {
        store.updateOntelolaattaMeasurements(storeKey, {
          fieldLength: resolvedFieldLength,
          measuredLineLengthM,
        });
      }

      try {
        const prevLen = measurer.list.length;
        measurer.createOnPoints(p1, p2);
        if (measurer.list.length > prevLen) {
          const line = measurer.list[measurer.list.length - 1];
          line.visible = true;
          onteloLines.set(expressId, line);
        }
      } catch (err) {
        console.warn("[ontelolaatta] createOnPoints failed:", err);
      }

      const latestEntry = useCostStore.getState().ontelolaattaMcp.byGlobalId[storeKey];
      updateOnteloPanelDOM(
        storeKey,
        onteloType,
        resolvedFieldLength,
        perpWidth,
        latestEntry?.confirmed ?? false
      );
    };

    const updatePropertyEditContent = () => {
      const selectedIds = getSelectionExpressIds(getEditFragmentIdMap());
      updatePropertyEditStatus();

      initPropertyEditTreeTable();
      wirePropertyEditToolbar();

      const emptyEl = queryInPropertyPanel("#property-edit-empty");
      const toolbar = queryInPropertyPanel("#property-edit-toolbar");
      const table = queryInPropertyPanel("#property-edit-tree") as BUI.Table | null;

      if (selectedIds.length === 0) {
        if (emptyEl) emptyEl.style.display = "";
        if (toolbar) toolbar.style.display = "none";
        if (table) table.style.display = "none";
        return;
      }

      if (emptyEl) emptyEl.style.display = "none";
      if (toolbar) toolbar.style.display = "";
      if (table) {
        table.style.display = "";
        table.columns = [...PROPERTY_EDIT_TABLE_COLUMNS];
        injectPropertyEditTreeShadowStyles(table);
        (table as unknown as { data: unknown }).data = buildPropertyEditTreeData(selectedIds);
      }
    };

    const syncPropertyDraftsFromSelection = async (fragmentIdMap: Record<string, Set<number>>) => {
      if (!fragmentModel) return;
      const editIds = getSelectionExpressIds(fragmentIdMap);
      const highlightIds = getSelectionExpressIds(propertyDraftStore.currentFragmentIdMap);
      const idsToLoad = [...new Set([...editIds, ...highlightIds])];

      for (const expressId of idsToLoad) {
        if (propertyDraftStore.drafts[expressId]) continue;
        try {
          const element = await fragmentModel.getProperties(expressId);
          if (!element) continue;
          const typeLabel =
            Object.keys(WEBIFC).find((key) => (WEBIFC as any)[key] === element.type)?.replace(
              /^IFC/,
              "Ifc"
            ) || "Unknown";
          const name = String(element.Name?.value ?? "");
          const description = String(element.Description?.value ?? "");
          const globalIdRaw = element.GlobalId?.value;
          const globalId =
            globalIdRaw !== undefined && globalIdRaw !== null ? String(globalIdRaw).trim() : "";
          const costaFromIfc = await loadCostaPropertiesFromIfc(expressId);
          propertyDraftStore.drafts[expressId] = {
            expressId,
            globalId,
            typeLabel,
            originalName: name,
            originalDescription: description,
            name,
            description,
            costaProperties: cloneCostaProperties(costaFromIfc),
            originalCostaProperties: cloneCostaProperties(costaFromIfc),
            dirty: false,
          };
        } catch {
          // skip unreadable element
        }
      }

      // ── Detección Ontelolaatta ─────────────────────────────────────────────
      // Usa el highlight 3D actual (no la selección guardada de Edit/Search).
      const oxxIds =
        highlightIds.length > 0 ? highlightIds : editIds;
      let foundOxx = false;
      for (const expressId of oxxIds) {
        const draft = propertyDraftStore.drafts[expressId];
        if (!draft) continue;
        const onteloName = draft.name || draft.originalName || "";
        const onteloType = detectOnteloType(onteloName);
        if (onteloType) {
          refreshOntelolaattaUI(expressId, onteloName, draft.globalId);
          foundOxx = true;
          break;
        }
      }
      if (!foundOxx) {
        const panelEl = queryInPropertyPanel("#ontelo-panel");
        if (panelEl) (panelEl as HTMLElement).style.display = "none";
        currentOnteloGlobalId  = null;
        currentOnteloExpressId = null;
      }

      if (propertyDraftStore.activeTab === "edit") {
        updatePropertyEditContent();
      } else {
        updatePropertyEditStatus();
      }
    };

    const onOnteloFlipClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const gid = currentOnteloGlobalId;
      const eid = currentOnteloExpressId;
      if (!gid || eid == null) return;
      useCostStore.getState().flipOntelolaattaSpan(gid);
      const draft = propertyDraftStore.drafts[eid];
      if (draft) refreshOntelolaattaUI(eid, draft.name || draft.originalName, draft.globalId);
    };

    const onOnteloSaveClick = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const gid = currentOnteloGlobalId;
      if (!gid) return;
      useCostStore.getState().confirmOntelolaattaArray(gid);
      const statusEl = queryInPropertyPanel("#ontelo-status");
      if (statusEl) statusEl.textContent = "Confirmed";
    };

    /** Multi-select Property View: element count for header only. */
    const propertyViewMulti = { expressIds: [] as number[] };

    const expressIdArraysEqual = (a: number[], b: number[]): boolean =>
      a.length === b.length && a.every((v, i) => v === b[i]);

    const elementPropertyPanel = BUI.Component.create<BUI.Panel>(() => {
      const [propsTable, updatePropsTable] = CUI.tables.elementProperties({
        components,
        fragmentIdMap: {},
      });
      const highlighter = components.get(OBCF.Highlighter);
      const simpleQto = components.get(SimpleQTO);

      const updatePropertyMultiHeader = () => {
        const headerEl = queryInPropertyPanel("#property-multi-header");
        const summaryEl = queryInPropertyPanel("#property-multi-summary");
        const n = propertyViewMulti.expressIds.length;
        if (!headerEl || !summaryEl || n <= 1) {
          if (headerEl) headerEl.style.display = "none";
          return;
        }
        headerEl.style.display = "";
        summaryEl.textContent =
          n === 1 ? "1 element selected" : `${n} elements selected`;
      };

      const refreshPropertyViewTable = (
        fragmentIdMap: Record<string, Set<number>>,
        collapseAll = false
      ) => {
        propertyViewMulti.expressIds = getSelectionExpressIds(fragmentIdMap);
        updatePropertyMultiHeader();
        updatePropsTable({ fragmentIdMap });
        if (collapseAll && propertyViewMulti.expressIds.length > 1) {
          propsTable.expanded = false;
        }
      };

      const onSelectionHighlight = async (fragmentIdMap: Record<string, Set<number>>) => {
        if (!floatingGrid) return;
        // Keep Model / Selection open when interacting with the model.
        if (floatingGrid.layout !== "classifications") {
          floatingGrid.layout = "second";
        }
        updateClassificationsToolbarButton();
        updatePropertiesToolbarButton();
        propertyDraftStore.currentFragmentIdMap = fragmentIdMap;
        const newIds = getSelectionExpressIds(fragmentIdMap);
        const sameSet = expressIdArraysEqual(propertyViewMulti.expressIds, newIds);
        refreshPropertyViewTable(fragmentIdMap, !sameSet);
        const editMap = getEditFragmentIdMap();
        await syncPropertyDraftsFromSelection(editMap);
        updatePropertyMultiHeader();
        if (propertyDraftStore.activeTab === "edit") {
          updatePropertyEditContent();
        }
        updateMwLiveSelectionHint();
      };

      highlighter.events.select.onHighlight.add(onSelectionHighlight);

      highlighter.events.select.onClear.add(() => {
        propertyViewMulti.expressIds = [];
        updatePropertyMultiHeader();
        updatePropsTable({ fragmentIdMap: {} });
        propertyDraftStore.currentFragmentIdMap = {};
        if (!floatingGrid) return;
        if (floatingGrid.layout !== "classifications") {
          floatingGrid.layout = "main";
        }
        updateClassificationsToolbarButton();
        updatePropertiesToolbarButton();
        simpleQto.resetQuantities();
        if (propertyDraftStore.activeTab === "edit") {
          updatePropertyEditContent();
        }
        // Limpiar líneas Ontelolaatta y ocultar panel
        const measurer = components.get(OBCF.LengthMeasurement);
        const onteloLines = onteloLinesRef.current;
        for (const line of onteloLines.values()) {
          measurer.deleteMeasurement(line).catch(() => {});
        }
        onteloLines.clear();
        currentOnteloGlobalId  = null;
        currentOnteloExpressId = null;
        const panelEl = queryInPropertyPanel("#ontelo-panel");
        if (panelEl) (panelEl as HTMLElement).style.display = "none";
        updateMwLiveSelectionHint();
      });

      const search = (e: Event) => {
        const input = e.target as BUI.TextInput;
        propsTable.queryString = input.value ?? "";
      };

      // UX paused: tab bar + Edit section commented out; logic (propertyDraftStore, setPropertyPanelTab, …) stays for later.
      return BUI.html`
        <bim-panel>
          <!-- property-panel-tab-bar + Edit tab — restore with property-panel-dual wrapper when re-enabling
          <div class="property-panel-tab-bar" role="tablist">
            <button
              type="button"
              id="property-tab-view-btn"
              class="property-panel-tab"
              role="tab"
              aria-selected="true"
              data-active
              @click=${(e: Event) => {
                e.preventDefault();
                setPropertyPanelTab("view");
              }}
            >
              Property Information
            </button>
            <button
              type="button"
              id="property-tab-edit-btn"
              class="property-panel-tab"
              role="tab"
              aria-selected="false"
              @click=${(e: Event) => {
                e.preventDefault();
                setPropertyPanelTab("edit");
              }}
            >
              Edit properties
            </button>
          </div>
          -->
          <div id="property-view-section">
            <bim-panel-section
              name="property"
              label="Property Information"
              icon="solar:document-bold"
              fixed
              open
            >
              <div
                id="property-multi-header"
                class="property-multi-header"
                style="display: none;"
                role="status"
              >
                <div id="property-multi-summary" class="property-multi-summary"></div>
              </div>
              <bim-text-input @input=${search} placeholder="Search properties…"></bim-text-input>
              ${propsTable}
            </bim-panel-section>
            <!-- Hollow-core slab (ontelolaatta) – visible when an Oxx IfcSlab is selected -->
            <div id="ontelo-panel" class="ontelo-panel" style="display:none">
              <bim-panel-section
                name="ontelo"
                label="Hollow-core slab"
                icon="tabler:arrow-big-right-lines"
                fixed
                open
              >
                <bim-label class="ontelo-type-label" id="ontelo-type"></bim-label>
                <bim-label class="ontelo-summary-label" id="ontelo-summary"></bim-label>
                <div class="ontelo-actions-row">
                  <bim-button
                    label="Rotate 90°"
                    icon="tabler:rotate-clockwise"
                    @click=${onOnteloFlipClick}
                  ></bim-button>
                  <bim-button
                    label="Confirm direction"
                    icon="tabler:check"
                    @click=${onOnteloSaveClick}
                  ></bim-button>
                </div>
                <bim-label class="ontelo-status-label" id="ontelo-status"></bim-label>
              </bim-panel-section>
            </div>
          </div>
          <!-- property-edit-section — uncomment when re-enabling Edit tab
          <div id="property-edit-section" style="display: none;">
            <bim-panel-section
              name="edit"
              label="Edit properties"
              icon="tabler:edit"
              fixed
              open
            >
              <div id="property-edit-status" class="property-edit-status"></div>
              <div id="property-edit-content" class="property-edit-content">
                <div id="property-edit-empty" class="property-edit-empty">
                  Select elements in the viewer, then open this tab. The tree layout matches Property Information; editable rows show inputs.
                </div>
                <div id="property-edit-toolbar" class="property-edit-toolbar" style="display: none;">
                  <p class="property-edit-ifc-hint">
                    Add <strong>IfcPropertySingleValue</strong> under <code>${COSTA_PSET_PREFIX}…</code> (toolbar). Tree rows are editable only where allowed.
                  </p>
                  <div class="property-edit-toolbar-row">
                    <span class="property-edit-prefix-fixed">${COSTA_PSET_PREFIX}</span>
                    <bim-text-input id="property-costa-pset-suffix" placeholder="Pset suffix"></bim-text-input>
                    <bim-text-input id="property-costa-prop-name" placeholder="Property name"></bim-text-input>
                    <bim-text-input id="property-costa-prop-value" placeholder="Value"></bim-text-input>
                    <bim-button id="property-costa-add-btn" label="Add"></bim-button>
                  </div>
                  <p class="property-edit-section-desc">
                    Pset in IFC: <code id="property-costa-pset-preview">costa_</code>
                  </p>
                  <bim-button id="property-discard-drafts-btn" label="Discard all local changes" icon="tabler:trash"></bim-button>
                </div>
                <bim-table id="property-edit-tree" class="property-edit-tree" style="display: none;"></bim-table>
              </div>
            </bim-panel-section>
          </div>
          -->
        </bim-panel>
      `;
    });

    propertyPanelRoot = elementPropertyPanel;
    requestAnimationFrame(() => injectPropertyPanelShadowStyles());

    const onWorldsUpdate = () => {
      if (!floatingGrid) return
      floatingGrid.layout = "world"
    }

    const worldPanel = BUI.Component.create<BUI.Panel>(() => {
      const [worldsTable] = CUI.tables.worldsConfiguration({ components })
      
      const search = (e: Event) => {
        const input = e.target as BUI.TextInput
        worldsTable.queryString = input.value
      }
      
      return BUI.html `
        <bim-panel>
          <bim-panel-section
            name="world"
            label="Worlds"
            icon="tabler:brush"
            fixed
          >
            <bim-text-input @input=${search} placeholder="Search..."></bim-text-input>
            ${worldsTable}  
          </bim-panel-section>
        </bim-panel>
      `;
    })

    // Estado persistente del panel de cantidades — vive en setupUI (ejecuta una sola vez).
    let lastQtoResult: Record<string, Record<string, number>> | null = null;

    const formatQuantity = (name: string, value: any): string => {
      if (value === null || value === undefined || isNaN(Number(value))) return 'N/A';
      const num = Number(value);
      const n = name.toLowerCase();
      if (n.includes('volume')) return `${num.toFixed(2)} m³`;
      if (n.includes('area') || n.includes('surface')) return `${num.toFixed(2)} m²`;
      if (n.includes('length') || n.includes('width') || n.includes('height') ||
          n.includes('depth') || n.includes('thickness')) return `${num.toFixed(2)} m`;
      if (n.includes('weight') || n.includes('mass')) return `${num.toFixed(2)} kg`;
      return `${num.toFixed(2)}`;
    };

    const renderVolumePanelContent = (result: Record<string, Record<string, number>> | null) => {
      const volumeDiv = document.querySelector('#volume-data') as HTMLElement | null;
      if (!volumeDiv) return;

      if (!result || Object.keys(result).length === 0) {
        volumeDiv.innerHTML = `
          <bim-label>IFC Base Quantities</bim-label>
          <div style="margin-top:10px;font-size:8px;color:#888;font-family:Arial,sans-serif;">
            No quantity sets found for the selected element.
          </div>`;
        return;
      }

      const sets = Object.entries(result).filter(([, qs]) => Object.keys(qs).length > 0);
      if (sets.length === 0) {
        volumeDiv.innerHTML = `
          <bim-label>IFC Base Quantities</bim-label>
          <div style="margin-top:10px;font-size:8px;color:#888;font-family:Arial,sans-serif;">
            No quantity sets found for the selected element.
          </div>`;
        return;
      }

      let html = '<bim-label>IFC Base Quantities</bim-label><div style="margin-top:10px;font-family:Arial,sans-serif;">';
      sets.forEach(([setName, quantities]) => {
        html += `<div style="font-weight:bold;margin:15px 0 10px 0;font-size:8px;color:#888;">${setName}</div>`;
        Object.entries(quantities).forEach(([name, value]) => {
          html += `
            <div style="display:flex;justify-content:space-between;margin:5px 0 5px 40px;font-size:8px;color:#888;">
              <span>${name}</span>
              <span>${formatQuantity(name, value)}</span>
            </div>`;
        });
      });
      html += '</div>';
      volumeDiv.innerHTML = html;
    };

    // Registrar los listeners UNA sola vez aquí — fuera del factory de BUI para que no
    // se acumulen si el componente se re-renderiza internamente.
    {
      const highlighter = components.get(OBCF.Highlighter);
      const simpleQto   = components.get(SimpleQTO);

      simpleQto.onQuantitiesComputed.add((result) => {
        lastQtoResult = result as Record<string, Record<string, number>>;
        renderVolumePanelContent(lastQtoResult);
      });

      // No registramos onClear: los resultados persisten hasta que el usuario
      // pulse "Base Quantities" de nuevo, evitando limpiezas involuntarias.
      void highlighter; // referencia usada solo para typing; el highlighter actúa vía eventos propios
    }

    const volumePanel = BUI.Component.create<BUI.Panel>(() => {
      // Si el factory se vuelve a ejecutar (re-render interno de BUI), restaurar el último
      // resultado tras el ciclo de render actual sin registrar listeners adicionales.
      if (lastQtoResult !== null) {
        requestAnimationFrame(() => renderVolumePanelContent(lastQtoResult));
      }

      return BUI.html`
        <bim-panel>
          <bim-panel-section
            name="volume"
            label="Volume Information"
            icon="tabler:calculator-filled"
            fixed
            open
          >
            <div id="volume-data" style="margin: 10px 0;">
              <bim-label>IFC Base Quantities</bim-label>
              <div style="margin-top: 10px; color: #888; font-size: 8px; font-family: Arial, sans-serif;">
                Selecciona un elemento en el visor y pulsa "Base Quantities".
              </div>
            </div>
          </bim-panel-section>
        </bim-panel>
      `
    })

    const materialsPanel = BUI.Component.create<BUI.Panel>(() => {
      return BUI.html`
        <bim-panel>
          <bim-panel-section
            name="materials"
            label="Material Quantities"
            icon="tabler:ruler"
            fixed
            open
          >
            <div id="materials-data" style="margin: 10px 0;">
              <bim-label>Material Information</bim-label>
              <div style="margin-top: 10px;">
                <bim-list></bim-list>
              </div>
            </div>
          </bim-panel-section>
        </bim-panel>
      `
    })

    let searchResults: IfcElementQueryRow[] = [];
    let searchPreviewExpressId: number | null = null;
    let lastSearchTruncated = false;
    let searchHasRun = false;
    /** Checkbox selection from Element Search — persists across queries. */
    const searchSelectedCatalog = new Map<number, IfcElementQueryRow>();

    const syncSearchSelectionRef = () => {
      searchSelectionIdsRef.current = [...searchSelectedCatalog.keys()];
    };

    const applySearchCheckboxSelection = () => {
      if (!fragmentModel) return;
      syncSearchSelectionRef();
      const ids = searchSelectionIdsRef.current;
      if (ids.length === 0) {
        void clearPaintChannelAsync("select").then(() => {
          setGhostModeEnabled(false);
          syncModelSelectionHints();
        });
        return;
      }
      const map = buildFragmentIdMapForIds(fragmentModel, ids);
      if (countFragmentIdMap(map) === 0) return;

      try {
        const hl = components.get(OBCF.Highlighter) as { enabled?: boolean } | undefined;
        if (hl) hl.enabled = true;
      } catch {
        /* noop */
      }

      // Visual only — catalog is the source of truth for Save group.
      // Does not write the live bag, so the next Search is not scoped to checked rows.
      paintChannel("select", map);
      setGhostModeEnabled(true, new Set(Object.keys(map)));
      forceRendererUpdate(50);
      syncModelSelectionHints();
    };

    /** Drop Search lime/orange + ghost; keep checked catalog and Model Tree scope. */
    const suspendSearchSelectionVisual = () => {
      void clearPaintChannelAsync("select");
      void clearPaintChannelAsync("search-preview");
      setGhostModeEnabled(false);
      forceRendererUpdate(50);
      syncModelSelectionHints();
    };

    const toggleSearchRowChecked = (row: IfcElementQueryRow, checked: boolean) => {
      if (checked) {
        searchSelectedCatalog.set(row.expressId, row);
      } else {
        searchSelectedCatalog.delete(row.expressId);
        if (searchPreviewExpressId === row.expressId) {
          searchPreviewExpressId = null;
        }
      }
      applySearchCheckboxSelection();
    };

    /** Same as per-row checkbox, applied to the currently listed hit rows only. */
    const setSearchListedChecked = (rows: IfcElementQueryRow[], checked: boolean) => {
      for (const row of rows) {
        if (checked) {
          searchSelectedCatalog.set(row.expressId, row);
        } else {
          searchSelectedCatalog.delete(row.expressId);
          if (searchPreviewExpressId === row.expressId) {
            searchPreviewExpressId = null;
          }
        }
      }
      applySearchCheckboxSelection();
    };

    const previewSearchResult = (row: IfcElementQueryRow) => {
      searchPreviewExpressId = row.expressId;
      if (!fragmentModel) return;
      const map = buildFragmentIdMapForIds(fragmentModel, [row.expressId]);
      if (Object.keys(map).length === 0) return;
      paintPreviewChannel(map);
    };

    const renderSearchSelectedSection = (host: HTMLElement) => {
      const section = document.createElement("div");
      section.className = "mw-search-selected-section";

      const header = document.createElement("div");
      header.className = "mw-search-selected-header";
      const title = document.createElement("span");
      title.className = "mw-search-selected-title";
      title.textContent = `Selected (${searchSelectedCatalog.size})`;
      header.appendChild(title);

      if (searchSelectedCatalog.size > 0) {
        const clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "mw-search-selected-clear";
        clearBtn.textContent = "Clear selection";
        clearBtn.addEventListener("click", () => {
          searchSelectedCatalog.clear();
          searchPreviewExpressId = null;
          syncSearchSelectionRef();
          applySearchCheckboxSelection();
          renderSearchResults(lastSearchTruncated);
        });
        header.appendChild(clearBtn);
      }
      section.appendChild(header);

      if (searchSelectedCatalog.size === 0) {
        section.appendChild(
          renderPanelEmpty("Check rows above to build a selection for Properties / Groups.")
        );
        host.appendChild(section);
        return;
      }

      const list = document.createElement("div");
      ensurePanelList(list);
      const sorted = [...searchSelectedCatalog.values()].sort((a, b) =>
        (a.name || "").localeCompare(b.name || "")
      );
      for (const item of sorted) {
        const meta = `${item.type} · ID ${item.expressId}${
          item.globalId ? ` · ${item.globalId}` : ""
        }`;
        list.appendChild(
          renderPanelRow({
            title: item.name || "Unnamed",
            meta,
            checked: true,
            preview: searchPreviewExpressId === item.expressId,
            onCheckedChange: (checked) => {
              toggleSearchRowChecked(item, checked);
              renderSearchResults(lastSearchTruncated);
            },
            onActivate: () => {
              previewSearchResult(item);
              renderSearchResults(lastSearchTruncated);
            },
          })
        );
      }
      section.appendChild(list);
      host.appendChild(section);
    };

    const renderSearchResults = (truncated: boolean, scopeLabel?: string) => {
      const resultsContainer = document.getElementById("mw-search-results");
      if (!resultsContainer) return;
      resultsContainer.classList.add("search-results-host");
      resultsContainer.replaceChildren();

      const hitsHost = document.createElement("div");
      hitsHost.className = "mw-search-hits-section";

      if (scopeLabel) {
        hitsHost.appendChild(renderPanelSummary(`Scoped to: ${scopeLabel}`));
      }

      if (searchResults.length === 0) {
        hitsHost.appendChild(
          renderPanelEmpty(
            searchHasRun
              ? "No elements match the filters."
              : "Set filters and click Search."
          )
        );
      } else {
        const displayResults = searchResults.slice(0, 100);
        hitsHost.appendChild(
          renderPanelSummary(
            `Found ${searchResults.length} element${searchResults.length !== 1 ? "s" : ""}${
              truncated ? " (scan limit reached)" : ""
            }${searchResults.length > 100 ? " — showing first 100" : ""}. Checkbox = select · row click = preview (orange).`
          )
        );

        const allListedChecked =
          displayResults.length > 0 &&
          displayResults.every((r) => searchSelectedCatalog.has(r.expressId));

        const selectAllRow = document.createElement("label");
        selectAllRow.className = "mw-search-select-all";
        const selectAllCheck = document.createElement("input");
        selectAllCheck.type = "checkbox";
        selectAllCheck.className = "costa-panel-row-check";
        selectAllCheck.checked = allListedChecked;
        selectAllCheck.setAttribute("aria-label", "Select all");
        selectAllCheck.addEventListener("change", () => {
          setSearchListedChecked(displayResults, selectAllCheck.checked);
          renderSearchResults(truncated);
        });
        const selectAllLabel = document.createElement("span");
        selectAllLabel.textContent = "Select all";
        selectAllRow.appendChild(selectAllCheck);
        selectAllRow.appendChild(selectAllLabel);
        hitsHost.appendChild(selectAllRow);

        const list = document.createElement("div");
        ensurePanelList(list);
        for (const item of displayResults) {
          const meta = `${item.type} · ID ${item.expressId}${
            item.globalId ? ` · ${item.globalId}` : ""
          }`;
          const isChecked = searchSelectedCatalog.has(item.expressId);
          list.appendChild(
            renderPanelRow({
              title: item.name || "Unnamed",
              meta,
              checked: isChecked,
              preview: searchPreviewExpressId === item.expressId,
              onCheckedChange: (checked) => {
                toggleSearchRowChecked(item, checked);
                renderSearchResults(truncated);
              },
              onActivate: () => {
                previewSearchResult(item);
                renderSearchResults(truncated);
              },
            })
          );
        }
        hitsHost.appendChild(list);
      }

      resultsContainer.appendChild(hitsHost);
      renderSearchSelectedSection(resultsContainer);
    };

    const applyGroupSelection = (map: Record<string, Set<number>>) => {
      const cloned = cloneFragmentIdMap(map);
      paintChannel("cost-select", cloned);
      if (isFragmentIdMapEmpty(cloned)) {
        setGhostModeEnabled(false);
      } else {
        setGhostModeEnabled(true, new Set(Object.keys(cloned)));
      }
    };

    /**
     * Visibility only — no cost-select tint: the isolated group is the only thing
     * on screen, so the paint adds nothing and would outlive every clear path.
     * Exclusive with group add-mode: hidden elements cannot be picked.
     */
    const isolateGroupSelection = (map: Record<string, Set<number>>, groupName: string) => {
      const dropped = groupModeRef.current.pendingAddIds.length;
      groupModeRef.current.activeId = null;
      groupModeRef.current.pendingAddIds = [];
      refreshGroupsList();

      const hider = components.get(OBC.Hider);
      hider.set(true);
      hider.isolate(cloneFragmentIdMap(map));
      setGhostModeEnabled(false);
      forceRendererUpdate(50);

      const status =
        dropped > 0
          ? `Isolated "${groupName}" — ${dropped} picked element(s) discarded. Press Update before Isolate to keep them.`
          : `Isolated "${groupName}". Show All to exit.`;

      void clearSelectionStateAndResync().then(() => {
        setGroupsStatus(status);
      });
    };

    const ensureMwSearchIfcTypeOptions = async () => {
      const select = document.getElementById("mw-search-ifc-type") as HTMLSelectElement | null;
      if (!select || !fragmentModel || select.options.length > 1) return;
      const types = await collectIfcTypesFromModel(fragmentModel);
      for (const t of types) {
        const opt = document.createElement("option");
        opt.value = t;
        opt.textContent = t;
        select.appendChild(opt);
      }
    };

    /**
     * Search query scope: Model Tree visual filter, optionally ∩ 3D click/lasso.
     * Checked Search rows (catalog) do NOT narrow the next query — they live below
     * for Save group only.
     */
    const resolveMwSearchScope = (): {
      allowList: Set<number> | null;
      label: string;
    } => {
      const visual = mwVisualScopeIds;
      const inGroupAddMode = groupModeRef.current.activeId !== null;
      const catalogActive = searchSelectedCatalog.size > 0;

      if (inGroupAddMode) {
        if (visual) {
          return {
            allowList: visual,
            label: `Tree visible scope (${visual.size} id(s); group add-mode)`,
          };
        }
        return {
          allowList: null,
          label: "Whole model (group add-mode — clicks add to group, not Search)",
        };
      }

      let live: Set<number> | null = null;
      if (!catalogActive) {
        const liveIds = getExpressIdsFromFragmentIdMap(getLiveSelection());
        live = liveIds.length > 0 ? new Set(liveIds.map((n) => Number(n))) : null;
      }

      if (visual && live) {
        const inter = new Set<number>();
        for (const id of live) {
          if (visual.has(id)) inter.add(id);
        }
        return {
          allowList: inter,
          label: `Tree visible ∩ 3D selection (${inter.size} id(s); visible ${visual.size}, picked ${live.size})`,
        };
      }
      if (visual) {
        const suffix = catalogActive
          ? `; ${searchSelectedCatalog.size} checked below (not scoped)`
          : "";
        return {
          allowList: visual,
          label: `Tree visible scope (${visual.size} id(s)${suffix})`,
        };
      }
      if (live) {
        return {
          allowList: live,
          label: `3D click/lasso (${live.size} id(s))`,
        };
      }
      if (catalogActive) {
        return {
          allowList: null,
          label: `Whole model (${searchSelectedCatalog.size} checked below — not scoped)`,
        };
      }
      return { allowList: null, label: "Whole model" };
    };

    const updateMwSearchScopeHint = () => {
      const el = document.getElementById("mw-search-scope-hint");
      if (!el) return;
      const { label } = resolveMwSearchScope();
      el.textContent = `Search scope: ${label}`;
    };

    /** Shown in Model/Selection when liveBag has IDs but Property panel is not open. */
    const updateMwLiveSelectionHint = () => {
      const el = document.getElementById("mw-live-selection-hint");
      if (!el) return;
      const liveN = countFragmentIdMap(getLiveSelection());
      const searchN = searchSelectionIdsRef.current.length;
      const n = Math.max(liveN, searchN);
      const show =
        Boolean(floatingGrid) &&
        floatingGrid!.layout === "classifications" &&
        groupModeRef.current.activeId === null &&
        n > 0;
      if (!show) {
        el.style.display = "none";
        el.textContent = "";
        el.removeAttribute("data-count");
        return;
      }
      el.style.display = "";
      el.setAttribute("data-count", String(n));
      const label = n === 1 ? "1 element" : `${n} elements`;
      el.textContent = `${label} selected — open Properties (Inspect toolbar) to view IFC data.`;
    };

    // Reachable from component-level handlers (group activate / exit add-mode).
    (window as any).__costaUpdateMwSearchScopeHint = updateMwSearchScopeHint;
    (window as any).__costaUpdateMwLiveSelectionHint = updateMwLiveSelectionHint;

    (window as any).__costaReapplySearchSelection = () => {
      if (searchSelectedCatalog.size === 0) return;
      applySearchCheckboxSelection();
    };

    window.__costaSearchSelectionIds = () => searchSelectionIdsRef.current.slice();
    window.__costaGetTreeScopeIds = () =>
      mwVisualScopeIds && mwVisualScopeIds.size > 0 ? [...mwVisualScopeIds] : null;
    window.__costaSetGhostMode = setGhostModeEnabled;
    window.__costaExitGroupAddMode = exitGroupAddMode;
    window.__costaHiderIsolate = (map: Record<string, Set<number>>) => {
      components.get(OBC.Hider).set(true);
      components.get(OBC.Hider).isolate(cloneFragmentIdMap(map));
      forceRendererUpdate(50);
    };
    window.__costaGetViewerSelectionState = buildCostaViewerSelectionState;
    window.__costaResetViewerVisualState = async (opts?: CostaResetViewerVisualOptions) => {
      if (opts?.groupAddMode) await exitGroupAddMode();

      if (opts?.liveSelection) {
        await clearLiveSelectionAsync();
        setGhostModeEnabled(false);
      } else if (opts?.autoAndPreviewPaint) {
        await clearPaintChannelAsync("cost-select");
        await clearPaintChannelAsync("search-preview");
        setGhostModeEnabled(false);
      }

      if (opts?.searchCatalog) {
        searchSelectedCatalog.clear();
        syncSearchSelectionRef();
      }

      if (opts?.searchFilters) {
        const kw = document.getElementById("mw-search-keywords") as BUI.TextInput | null;
        const guid = document.getElementById("mw-search-guid") as BUI.TextInput | null;
        const typeSelect = document.getElementById("mw-search-ifc-type") as HTMLSelectElement | null;
        const pset = document.getElementById("mw-search-in-pset-names") as HTMLInputElement | null;
        if (kw) kw.value = "";
        if (guid) guid.value = "";
        if (typeSelect) typeSelect.value = "";
        if (pset) pset.checked = false;
        searchResults = [];
        searchHasRun = false;
        searchPreviewExpressId = null;
        renderSearchResults(false);
      }

      if (opts?.treeScope) resetTreeVisualScopeRef.current?.();

      if (opts?.hider) {
        components.get(OBC.Hider).set(true);
        forceRendererUpdate(50);
      }

      syncModelSelectionHints();
    };

    const runMwElementSearch = async () => {
      const keywordsInput = document.getElementById("mw-search-keywords") as BUI.TextInput | null;
      const guidInput = document.getElementById("mw-search-guid") as BUI.TextInput | null;
      const typeSelect = document.getElementById("mw-search-ifc-type") as HTMLSelectElement | null;
      const psetCheckbox = document.getElementById("mw-search-in-pset-names") as HTMLInputElement | null;
      const resultsContainer = document.getElementById("mw-search-results");
      if (!fragmentModel || !resultsContainer) return;

      const keywords = (keywordsInput?.value ?? "").trim();
      const globalId = (guidInput?.value ?? "").trim();
      const ifcType = typeSelect?.value ?? "";
      const searchInPropertyNames = Boolean(psetCheckbox?.checked);

      if (keywords.length > 0 && keywords.length < 2 && !globalId) {
        searchResults = [];
        renderSearchResults(false);
        return;
      }
      if (!keywords && !globalId && !ifcType) {
        searchResults = [];
        renderSearchResults(false);
        return;
      }

      updateMwSearchScopeHint();
      const { allowList, label: scopeLabel } = resolveMwSearchScope();

      try {
        const indexer = components.get(OBC.IfcRelationsIndexer);
        const { elements, truncated } = await queryIfcElements(
          fragmentModel,
          {
            ifcType: ifcType || undefined,
            keywords: keywords || undefined,
            globalId: globalId || undefined,
            searchInDescription: true,
            searchInPropertyNames,
            maxResults: 500,
            expressIdAllowList: allowList ?? undefined,
          },
          { indexer: indexer as import("../utils/ifcElementQuery").IfcRelationsIndexerLike }
        );
        searchResults = elements;
        lastSearchTruncated = truncated;
        searchHasRun = true;
        elements.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        renderSearchResults(truncated, scopeLabel);
      } catch (error) {
        searchResults = [];
        renderSearchResults(false);
        const resultsContainer = document.getElementById("mw-search-results");
        if (resultsContainer) {
          const err = document.createElement("div");
          err.className = "costa-panel-empty costa-panel-empty--error";
          err.textContent =
            error instanceof Error ? error.message : "Search failed.";
          resultsContainer.querySelector(".mw-search-hits-section")?.prepend(err);
        }
      }
    };

    const setModelWorkspaceTab = (tab: "tree" | "selection") => {
      const treePanel = document.getElementById("mw-tab-tree");
      const selectionPanel = document.getElementById("mw-tab-selection");
      const treeBtn = document.getElementById("mw-tab-btn-tree");
      const selectionBtn = document.getElementById("mw-tab-btn-selection");
      if (!treePanel || !selectionPanel) return;
      const isTree = tab === "tree";
      treePanel.style.display = isTree ? "" : "none";
      selectionPanel.style.display = isTree ? "none" : "";
      if (treeBtn) {
        if (isTree) treeBtn.setAttribute("data-active", "");
        else treeBtn.removeAttribute("data-active");
      }
      if (selectionBtn) {
        if (!isTree) selectionBtn.setAttribute("data-active", "");
        else selectionBtn.removeAttribute("data-active");
      }
      if (!isTree) {
        void ensureMwSearchIfcTypeOptions();
        updateMwSearchScopeHint();
        if (searchResults.length > 0 || searchSelectedCatalog.size > 0) {
          renderSearchResults(lastSearchTruncated);
        }
      }
    };

    const resolveGroupModel = (): FragmentsGroup | undefined =>
      fragmentModel ?? ((window as any).fragmentModelRef as FragmentsGroup | undefined);

    const refreshMwGroupingFooter = () => {
      const namedListEl = document.getElementById("mw-groups-named-list");
      const namedStatusEl = document.getElementById("mw-groups-named-status");
      if (!namedListEl) return;
      ensurePanelList(namedListEl);
      const groupMode = groupModeRef.current;
      const named = listNamedGroups();
      if (named.length === 0) {
        groupMode.activeId = null;
        groupMode.pendingAddIds = [];
        namedListEl.replaceChildren(
          renderPanelEmpty(
            "No Costa groups yet. Select in 3D or from Tree/Search, then save below."
          )
        );
      } else {
        namedListEl.replaceChildren();
        for (const group of named) {
          const isActive = groupMode.activeId === group.id;
          const actions: CostaPanelRowAction[] = [];

          if (isActive) {
            actions.push({
              label: "Update with selection",
              icon: "tabler:refresh",
              onClick: () => {
                const newIds = groupMode.pendingAddIds.slice();
                if (newIds.length === 0) {
                  setGroupsStatus("Pick elements in 3D first, then press Update.");
                  return;
                }
                const existingIds = (
                  group.expressIds?.length
                    ? group.expressIds
                    : getExpressIdsFromFragmentIdMap(group.map)
                ).map(Number);
                const merged = [...new Set([...existingIds, ...newIds])];
                const added = merged.length - existingIds.length;
                if (added === 0) {
                  groupMode.pendingAddIds = [];
                  setGroupsStatus(`Already in "${group.name}" — nothing to add.`);
                  return;
                }

                const model = resolveGroupModel();
                const result = updateNamedGroup(
                  { groupId: group.id },
                  { expressIds: merged },
                  model
                );
                if (!result.ok) {
                  setGroupsStatus(`Update failed: ${result.error}`);
                  return;
                }

                // Refresh the list before painting: a paint failure must never
                // leave the row showing a stale element count.
                groupMode.pendingAddIds = [];
                refreshMwGroupingFooter();
                setGroupsStatus(
                  `Added ${added} element(s) to "${group.name}" — ${merged.length} total.`
                );
                if (model) {
                  void enrichNamedGroupsWithGlobalIds(model).then(() => refreshMwGroupingFooter());
                }

                const updatedMap =
                  Object.keys(result.group.map).length > 0
                    ? result.group.map
                    : model
                      ? fragmentMapForExpressIds(model, merged)
                      : {};
                if (Object.keys(updatedMap).length > 0) {
                  try {
                    applyGroupSelection(updatedMap);
                  } catch (err) {
                    console.warn("[costa] group repaint after update failed", err);
                  }
                }
                updateMwSearchScopeHint();
                updateMwLiveSelectionHint();
              },
            });
          }

          actions.push(
            {
              label: "Isolate",
              icon: "prime:filter-fill",
              onClick: () => isolateGroupSelection(group.map, group.name),
            },
            {
              label: "Delete",
              icon: "tabler:trash",
              variant: "danger",
              onClick: () => {
                const deletedIds = new Set(
                  (group.expressIds?.length
                    ? group.expressIds
                    : getExpressIdsFromFragmentIdMap(group.map)
                  ).map((id) => Number(id))
                );
                const activeIds = new Set([
                  ...getExpressIdsFromFragmentIdMap(getPaintChannelMap("cost-select")).map(Number),
                  ...getExpressIdsFromFragmentIdMap(getLiveSelection()).map(Number),
                ]);
                const wasActive = [...deletedIds].some((id) => activeIds.has(id));

                // Drop add-mode first so the row stops claiming a group that is gone.
                if (groupMode.activeId === group.id) exitGroupAddMode();
                removeNamedGroup(group.id);
                refreshMwGroupingFooter();

                if (wasActive) {
                  clearGroupVisualState();
                }
                updateMwSearchScopeHint();
                updateMwLiveSelectionHint();
              },
            }
          );

          namedListEl.appendChild(
            renderPanelRow({
              title: group.name,
              meta: `${group.elementCount} element(s)${
                group.unresolvedGlobalIds?.length
                  ? ` · ${group.unresolvedGlobalIds.length} GUID missing`
                  : group.members?.length
                    ? " · GUID"
                    : ""
              }`,
              active: isActive,
              onActivate: () => {
                if (groupMode.activeId === group.id) {
                  exitGroupAddMode();
                  return;
                }
                groupMode.activeId = group.id;
                groupMode.pendingAddIds = [];
                applyGroupSelection(group.map);
                refreshMwGroupingFooter();
                updateMwSearchScopeHint();
                updateMwLiveSelectionHint();
              },
              actions,
            })
          );
        }
      }
      if (namedStatusEl) {
        namedStatusEl.textContent =
          named.length > 0 ? `${named.length} Costa group(s) in this session.` : "";
      }
    };

    (window as any).__costaRefreshMwGroupingFooter = refreshMwGroupingFooter;
    (window as any).__costaGroupMode = () => ({
      activeId: groupModeRef.current.activeId,
      pendingAddIds: groupModeRef.current.pendingAddIds.slice(),
    });

    /** Multi-select state for Model tree rows (node.id → expressIds). */
    const mwTreeSelected = new Map<string, number[]>();
    const mwTreeRowEls = new Map<string, HTMLElement>();

    const syncMwTreeBold = () => {
      for (const [id, el] of mwTreeRowEls) {
        if (mwTreeSelected.has(id)) {
          el.classList.add("costa-panel-row--active");
          el.classList.add("mw-ifc-tree-row--visible");
        } else {
          el.classList.remove("costa-panel-row--active");
          el.classList.remove("mw-ifc-tree-row--visible");
        }
      }
    };

    resetTreeVisualScopeRef.current = () => {
      mwVisualScopeIds = null;
      mwTreeSelected.clear();
      syncMwTreeBold();
      updateMwSearchScopeHint();
    };

    /** Model Tree = visualize only (Hider isolate). Does not write live selection. */
    const applyMwTreeVisualization = () => {
      if (!fragmentModel) return;
      const allIds: number[] = [];
      for (const ids of mwTreeSelected.values()) {
        for (const id of ids) allIds.push(id);
      }
      if (allIds.length === 0) {
        syncMwTreeBold();
        return;
      }
      const map = fragmentMapForExpressIds(fragmentModel, allIds);
      if (countFragmentIdMap(map) === 0) {
        syncMwTreeBold();
        return;
      }
      mwVisualScopeIds = new Set(allIds.map((n) => Number(n)));
      const hider = components.get(OBC.Hider);
      hider.set(true);
      hider.isolate(cloneFragmentIdMap(map));
      forceRendererUpdate(50);
      syncMwTreeBold();
      updateMwSearchScopeHint();
    };

    const expressIdSetsEqual = (scope: Set<number>, ids: number[]) => {
      if (scope.size !== ids.length) return false;
      for (const id of ids) {
        if (!scope.has(Number(id))) return false;
      }
      return true;
    };

    /** After remount, mark Tree rows that match persisted visual scope / selection. */
    const restoreMwTreeSelectionFromScope = (nodes: IfcModelTreeNode[]) => {
      const validIds = new Set<string>();
      const walkCollect = (n: IfcModelTreeNode) => {
        validIds.add(n.id);
        for (const c of n.children) walkCollect(c);
      };
      for (const n of nodes) walkCollect(n);

      // Drop stale row ids from a previous tree build
      for (const id of [...mwTreeSelected.keys()]) {
        if (!validIds.has(id)) mwTreeSelected.delete(id);
      }

      if (mwTreeSelected.size > 0) return;
      if (!mwVisualScopeIds || mwVisualScopeIds.size === 0) return;

      const walkMatch = (n: IfcModelTreeNode) => {
        if (expressIdSetsEqual(mwVisualScopeIds!, n.expressIds)) {
          mwTreeSelected.set(n.id, n.expressIds.slice());
        }
        for (const c of n.children) walkMatch(c);
      };
      for (const n of nodes) walkMatch(n);
    };

    const renderMwIfcTree = (nodes: IfcModelTreeNode[]) => {
      const host = document.getElementById("classifications-tree-host");
      if (!host) return;
      ensurePanelList(host);
      host.replaceChildren();
      mwTreeRowEls.clear();
      // Keep mwTreeSelected / mwVisualScopeIds — rehydrate row chrome after remount
      restoreMwTreeSelectionFromScope(nodes);

      const isAncestorOfSelection = (node: IfcModelTreeNode) => {
        if (mwTreeSelected.has(node.id)) return true;
        if (node.expressId == null) return false;
        const token = String(node.expressId);
        for (const id of mwTreeSelected.keys()) {
          if (
            id.includes(`/${token}/`) ||
            id.includes(`/${token}:`) ||
            id.startsWith(`p${token}/`) ||
            id.startsWith(`p${token}:`)
          ) {
            return true;
          }
        }
        return false;
      };

      const mount = (parent: HTMLElement, node: IfcModelTreeNode, depth: number) => {
        const hasChildren = node.children.length > 0;
        const forceOpen = isAncestorOfSelection(node);
        const expanded = { value: depth < 3 || forceOpen };

        const title =
          node.kind === "typeGroup" ? node.entity : node.label;
        const meta = `${node.expressIds.length} element(s)`;

        const row = renderPanelRow({
          title,
          meta,
          active: mwTreeSelected.has(node.id),
        });
        row.dataset.nodeId = node.id;
        row.classList.add("costa-panel-row--interactive");
        if (mwTreeSelected.has(node.id)) {
          row.classList.add("mw-ifc-tree-row--visible");
        }
        mwTreeRowEls.set(node.id, row);

        const twisty = document.createElement("button");
        twisty.type = "button";
        twisty.className = "mw-ifc-tree-twisty";
        twisty.textContent = hasChildren ? (expanded.value ? "▾" : "▸") : "";
        twisty.disabled = !hasChildren;
        twisty.setAttribute("aria-label", expanded.value ? "Collapse" : "Expand");
        row.insertBefore(twisty, row.firstChild);

        row.addEventListener("click", (ev) => {
          if ((ev.target as HTMLElement).closest("bim-button, .mw-ifc-tree-twisty")) {
            return;
          }
          if (!fragmentModel || node.expressIds.length === 0) return;
          const additive = ev.ctrlKey || ev.metaKey;
          if (!additive) mwTreeSelected.clear();
          if (additive && mwTreeSelected.has(node.id)) {
            mwTreeSelected.delete(node.id);
          } else {
            mwTreeSelected.set(node.id, node.expressIds.slice());
          }
          applyMwTreeVisualization();
        });

        parent.appendChild(row);

        const childHost = document.createElement("div");
        childHost.classList.add("mw-ifc-tree-children");
        childHost.style.display = hasChildren && expanded.value ? "" : "none";
        parent.appendChild(childHost);

        if (hasChildren) {
          twisty.addEventListener("click", (ev) => {
            ev.stopPropagation();
            expanded.value = !expanded.value;
            twisty.textContent = expanded.value ? "▾" : "▸";
            twisty.setAttribute(
              "aria-label",
              expanded.value ? "Collapse" : "Expand"
            );
            childHost.style.display = expanded.value ? "" : "none";
          });
          for (const child of node.children) {
            mount(childHost, child, depth + 1);
          }
        }
      };

      for (const node of nodes) mount(host, node, 0);
      syncMwTreeBold();
    };

    const refreshClassificationsPanel = async () => {
      const host = document.getElementById("classifications-tree-host");
      if (!fragmentModel) {
        if (host) {
          host.replaceChildren();
          host.appendChild(
            renderPanelEmpty("Load an IFC model to browse the model tree.")
          );
        }
        refreshMwGroupingFooter();
        return;
      }
      try {
        const indexer = components.get(OBC.IfcRelationsIndexer);
        const nodes = await buildIfcModelTree(fragmentModel, indexer);
        if (nodes.length === 0) {
          if (host) {
            host.replaceChildren();
            host.appendChild(
              renderPanelEmpty("No IFC Project / spatial structure found.")
            );
          }
        } else {
          renderMwIfcTree(nodes);
        }
      } catch (err) {
        console.error("[Costa] IFC model tree failed:", err);
        if (host) {
          host.replaceChildren();
          host.appendChild(
            renderPanelEmpty(
              err instanceof Error ? err.message : "Failed to build model tree.",
              "error"
            )
          );
        }
      }
      refreshMwGroupingFooter();
      if (searchResults.length > 0) {
        renderSearchResults(lastSearchTruncated);
      }
      updateMwSearchScopeHint();
      updateMwLiveSelectionHint();
      setModelWorkspaceTab("tree");
    };

    (window as any).__costaRefreshClassificationsPanel = refreshClassificationsPanel;

    const updateClassificationsToolbarButton = () => {
      const btn = document.getElementById("classifications-panel-toggle-btn") as HTMLElement | null;
      if (!btn || !floatingGrid) return;
      const open = floatingGrid.layout === "classifications";
      btn.style.outline = "";
      if (open) btn.setAttribute("active", "");
      else btn.removeAttribute("active");
      btn.setAttribute("aria-pressed", open ? "true" : "false");
      btn.setAttribute(
        "tooltip-title",
        open ? "Model / Selection (close)" : "Model / Selection"
      );
    };

    const updatePropertiesToolbarButton = () => {
      const btn = document.getElementById("properties-panel-toggle-btn") as HTMLElement | null;
      if (!btn || !floatingGrid) return;
      const open = floatingGrid.layout === "second";
      btn.style.outline = "";
      if (open) btn.setAttribute("active", "");
      else btn.removeAttribute("active");
      btn.setAttribute("aria-pressed", open ? "true" : "false");
      btn.setAttribute(
        "tooltip-title",
        open ? "Properties (close)" : "Properties"
      );
    };

    /** BIM-standard: explicit Properties toggle + sync live selection bag to panel. */
    const onTogglePropertiesPanel = () => {
      if (!floatingGrid) return;
      if (floatingGrid.layout === "second") {
        floatingGrid.layout = "main";
        updatePropertiesToolbarButton();
        updateClassificationsToolbarButton();
        return;
      }
      // Opening Properties leaves Model/Selection: clicks are plain selection again.
      exitGroupAddMode();
      floatingGrid.layout = "second";
      updatePropertiesToolbarButton();
      updateClassificationsToolbarButton();
      updateMwLiveSelectionHint();
      const highlighter = components.get(OBCF.Highlighter);
      const selection = highlighter.selection.select ?? {};
      requestAnimationFrame(() => {
        try {
          highlighter.events?.select?.onHighlight?.trigger(selection);
        } catch {
          /* panel may mount on next frame */
        }
      });
    };

    (window as any).__costaTogglePropertiesPanel = onTogglePropertiesPanel;

    /** Model / Selection: tabs Tree | Element search + pie de agrupación Costa. */
    const classificationsPanel = BUI.Component.create<BUI.Panel>(() => {
      return BUI.html`
        <bim-panel>
          <bim-panel-section
            name="model-workspace"
            label="Model / Selection"
            icon="tabler:binary-tree"
            fixed
            open
          >
            <div class="mw-panel">
              <div class="mw-tab-bar" role="tablist">
                <button
                  type="button"
                  id="mw-tab-btn-tree"
                  class="mw-tab"
                  data-active
                  role="tab"
                  @click=${() => setModelWorkspaceTab("tree")}
                >
                  Model tree
                </button>
                <button
                  type="button"
                  id="mw-tab-btn-selection"
                  class="mw-tab"
                  role="tab"
                  @click=${() => setModelWorkspaceTab("selection")}
                >
                  Element search
                </button>
              </div>

              <div
                id="mw-live-selection-hint"
                class="mw-live-selection-hint"
                style="display: none;"
                role="status"
              ></div>

              <div id="mw-tab-tree" class="mw-tab-panel" role="tabpanel">
                <div id="classifications-tree-host" class="costa-panel-list groups-classifications-host mw-relations-tree-host"></div>
              </div>

              <div id="mw-tab-selection" class="mw-tab-panel" style="display: none;" role="tabpanel">
                <div class="search-panel-content">
                  <bim-label>Find elements by IFC type, keywords, or GlobalId</bim-label>
                  <div id="mw-search-scope-hint" class="mw-search-scope-hint">
                    Search scope: Whole model (no Tree scope, no live selection)
                  </div>
                  <div class="search-filter-row">
                    <label class="search-filter-label" for="mw-search-ifc-type">IFC type</label>
                    <select id="mw-search-ifc-type" class="search-ifc-type-select">
                      <option value="">All types</option>
                    </select>
                  </div>
                  <div class="search-filter-row">
                    <bim-text-input
                      id="mw-search-keywords"
                      placeholder="Keywords (Name, Description)"
                      style="width: 100%;"
                    ></bim-text-input>
                  </div>
                  <div class="search-filter-row">
                    <bim-text-input
                      id="mw-search-guid"
                      placeholder="GlobalId (exact)"
                      style="width: 100%;"
                    ></bim-text-input>
                  </div>
                  <label class="search-pset-checkbox">
                    <input type="checkbox" id="mw-search-in-pset-names" />
                    Also search property names in Psets (slower)
                  </label>
                  <div class="search-actions-row">
                    <bim-button
                      icon="tabler:search"
                      label="Search"
                      @click=${() => void runMwElementSearch()}
                    ></bim-button>
                    <bim-button
                      label="Clear filters"
                      icon="tabler:filter-off"
                      tooltip-title="Clear search fields and 3D highlight. Keeps Model Tree scope and checked rows below."
                      @click=${() => {
                        const kw = document.getElementById("mw-search-keywords") as BUI.TextInput | null;
                        const guid = document.getElementById("mw-search-guid") as BUI.TextInput | null;
                        const typeSelect = document.getElementById("mw-search-ifc-type") as HTMLSelectElement | null;
                        const pset = document.getElementById("mw-search-in-pset-names") as HTMLInputElement | null;
                        if (kw) kw.value = "";
                        if (guid) guid.value = "";
                        if (typeSelect) typeSelect.value = "";
                        if (pset) pset.checked = false;
                        searchResults = [];
                        searchHasRun = false;
                        searchPreviewExpressId = null;
                        suspendSearchSelectionVisual();
                        renderSearchResults(false);
                      }}
                    ></bim-button>
                  </div>
                  <div id="mw-search-results" class="search-results-host costa-panel-list">
                    <div class="costa-panel-empty">Set filters and click Search.</div>
                  </div>
                </div>
              </div>

              <div class="mw-grouping-footer">
                <div class="mw-section-label">Grouping</div>
                <div class="groups-save-row">
                  <bim-text-input
                    id="mw-groups-new-name"
                    placeholder="Group name"
                    style="width: 100%;"
                  ></bim-text-input>
                  <bim-button
                    label="Save selection"
                    icon="tabler:device-floppy"
                    @click=${() => {
                      const selection = resolveGroupSaveMap();
                      const nameInput = document.getElementById("mw-groups-new-name") as BUI.TextInput | null;
                      const name = (nameInput?.value ?? "").trim();
                      const status = document.getElementById("mw-groups-named-status");
                      if (!name) {
                        if (status) status.textContent = "Enter a group name.";
                        return;
                      }
                      if (countFragmentIdMap(selection) === 0) {
                        if (status) {
                          status.textContent =
                            "Select in 3D (click/lasso) or check rows in Element Search.";
                        }
                        return;
                      }
                      const saved = saveNamedGroup(name, selection);
                      if (!saved) {
                        if (status) status.textContent = "Could not save group.";
                        return;
                      }
                      if (nameInput) nameInput.value = "";
                      refreshMwGroupingFooter();
                      if (status) {
                        status.textContent = `Saved “${saved.name}” (${saved.elementCount}).`;
                      }
                      const model =
                        fragmentModel ??
                        ((window as any).fragmentModelRef as FragmentsGroup | undefined);
                      if (model) {
                        void enrichNamedGroupsWithGlobalIds(model).then(() => {
                          refreshMwGroupingFooter();
                        });
                      }
                    }}
                  ></bim-button>
                </div>
                <div class="groups-save-row" style="margin-top: 6px; gap: 6px;">
                  <bim-button
                    label="Export JSON"
                    icon="tabler:file-export"
                    @click=${() => {
                      const status = document.getElementById("mw-groups-named-status");
                      const model =
                        fragmentModel ??
                        ((window as any).fragmentModelRef as FragmentsGroup | undefined);
                      const runExport = () => {
                        const result = downloadCostaGroupsPortableFile(
                          (window as any).ifcFilename ?? null
                        );
                        if (!result.ok) {
                          if (status) status.textContent = result.error;
                          return;
                        }
                        if (status) {
                          status.textContent = `Exported ${result.fileName} (${result.document.groups.length} group(s)).`;
                        }
                      };
                      if (model) {
                        void enrichNamedGroupsWithGlobalIds(model).then(runExport);
                      } else {
                        runExport();
                      }
                    }}
                  ></bim-button>
                  <bim-button
                    label="Import JSON"
                    icon="tabler:file-import"
                    @click=${() => {
                      const status = document.getElementById("mw-groups-named-status");
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".json,application/json";
                      input.addEventListener("change", () => {
                        const file = input.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => {
                          try {
                            const raw = JSON.parse(String(reader.result ?? ""));
                            const imported = importCostaGroupsDocument(raw);
                            if (!imported.ok) {
                              if (status) status.textContent = imported.error;
                              return;
                            }
                            refreshMwGroupingFooter();
                            const model =
                              fragmentModel ??
                              ((window as any).fragmentModelRef as FragmentsGroup | undefined);
                            const baseMsg = `Imported ${imported.groupCount} group(s) (v${imported.version}).`;
                            if (status) {
                              status.textContent = imported.warnings.length
                                ? `${baseMsg} ${imported.warnings[0]}`
                                : baseMsg;
                            }
                            if (model) {
                              void rebindNamedGroupMaps(model).then((report) => {
                                refreshMwGroupingFooter();
                                if (status && report.unresolvedMembers > 0) {
                                  status.textContent = `${baseMsg} ${report.resolvedMembers} resolved, ${report.unresolvedMembers} GUID(s) missing.`;
                                } else if (status && report.warnings[0]) {
                                  status.textContent = `${baseMsg} ${report.warnings[0]}`;
                                }
                              });
                            }
                          } catch (err) {
                            if (status) {
                              status.textContent =
                                err instanceof Error ? err.message : "Invalid JSON file.";
                            }
                          }
                        };
                        reader.readAsText(file);
                      });
                      input.click();
                    }}
                  ></bim-button>
                </div>
                <div id="mw-groups-named-status" class="groups-status"></div>
                <div id="mw-groups-named-list" class="costa-panel-list">
                  <div class="costa-panel-empty">No Costa groups yet.</div>
                </div>
              </div>
            </div>
          </bim-panel-section>
        </bim-panel>
      `;
    });


    const getCurrentProject = () => {
      const projectElement = document.querySelector('[data-project-info="name"]');
      const projectInfo = document.querySelector('.bim-project-info');
      const costDiv = Array.from(projectInfo?.querySelectorAll('div') || [])
        .find(div => div.textContent?.includes('Cost'));
      const costValue = costDiv?.lastElementChild?.textContent || '0';
      
      return {
        name: projectElement?.textContent || "Project Name",
        cost: parseFloat(costValue.replace('€', '')) || 0,
        description: document.querySelector('.bim-project-info p')?.textContent || "",
        status: document.querySelector('.bim-project-info')?.querySelector('div p:nth-child(2)')?.textContent || "Active",
        progress: parseFloat(document.querySelector('.bim-project-info')?.querySelector('div:last-child')?.textContent || '0') / 100
      };
    };

    const showSuccessMessage = () => {
      const messageDiv = document.createElement('div');
      messageDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(2, 154, 224, 0.9);
        color: white;
        padding: 20px;
        border-radius: 8px;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      `;
      
      messageDiv.innerHTML = `
        <span class="material-icons" style="font-size: 24px;">check_circle</span>
        <div>
          <div style="font-weight: bold; margin-bottom: 4px;">Success!</div>
          <div>LCA evaluation now has initial data available</div>
        </div>
      `;
      
      document.body.appendChild(messageDiv);
      
      setTimeout(() => {
        messageDiv.style.opacity = '0';
        messageDiv.style.transition = 'opacity 0.5s ease-out';
        setTimeout(() => {
          if (document.body.contains(messageDiv)) {
            document.body.removeChild(messageDiv);
          }
        }, 500);
      }, 2000);
    };

    const lcaPanel = () => {
      return BUI.Component.create<BUI.Panel>(() => {
        return BUI.html`
          <bim-panel>
            <bim-panel-section
              name="lca"
              label="Global quantities"
              icon="tabler:chart-dots"
              fixed
              open
            >
              <div id="lca-content" style="margin: 10px 0;">
              </div>
              <div style="margin-top: 15px;">
                <bim-button
                  label="Send data to LCA Evaluation"
                  icon="tabler:table-export"
                  @click=${async () => {
                    try {
                      const lcaCalculator = components.get(LCACalculator);
                      const data = await lcaCalculator.getMaterialQuantities();
                      const currentProject = getCurrentProject();
                      
                      setLCAData({
                        data: data.data,
                        columns: data.columns
                      });
                      
                      // Guardar la información del proyecto
                      if (currentProject) {
                        setProjectInfo({
                          name: currentProject.name,
                          cost: currentProject.cost,
                          description: currentProject.description,
                          status: currentProject.status,
                          progress: currentProject.progress,
                          area: 0,  // Valor por defecto
                          type: 'residential', // Valor por defecto
                          location: 'Helsinki'  // Valor por defecto
                        });
                      }
                      
                      showSuccessMessage();

                      setTimeout(() => {
                        window.location.hash = '#/materials';
                      }, 1000);
                    } catch (error) {
                      console.error('LCA calculation failed:', error);
                    }
                  }}
                ></bim-button>
              </div>
            </bim-panel-section>
          </bim-panel>
        `;
      });
    };

    const costPanel = () => {
      return BUI.Component.create<BUI.Panel>(() => {
        const bridgeLang = useCostStore.getState().language;
        return BUI.html`
          <bim-panel>
            <bim-panel-section
              name="cost"
              label="${getCostBridgeUiText("costPanelSection", bridgeLang)}"
              icon="tabler:currency-euro"
              fixed
              open
              style="overflow: hidden;"
            >
              <div id="cost-data" style="margin: 10px 0;">
              </div>
            </bim-panel-section>
          </bim-panel>
        `;
      });
    };

    const toolbar = BUI.Component.create<BUI.Toolbar>(() => {
      const [loadIfcBtn] = CUI.buttons.loadIfc({ components: components })
      loadIfcBtn.tooltipTitle = "Load IFC"
      loadIfcBtn.label = ""

      const onToggleClassificationsPanel = () => {
        if (!floatingGrid) return;
        if (floatingGrid.layout === "classifications") {
          exitGroupAddMode();
          floatingGrid.layout = "main";
          updateClassificationsToolbarButton();
          updatePropertiesToolbarButton();
          return;
        }
        floatingGrid.layout = "classifications";
        updateClassificationsToolbarButton();
        updatePropertiesToolbarButton();
        requestAnimationFrame(() => void refreshClassificationsPanel());
      };

      const onCalculateVolume = async () => {
        if (!floatingGrid) return
        
        const highlighter = components.get(OBCF.Highlighter)
        const simpleQto = components.get(SimpleQTO)
        const selection = highlighter.selection.select
        
        floatingGrid.layout = "volume"
        
        if (Object.keys(selection).length === 0) {
          // El panel reactivo se actualizará automáticamente cuando se dispare el evento
          return;
        }
        
        // Llamar a sumQuantitiesV2 que disparará onQuantitiesComputed
        // El panel reactivo escuchará este evento y se actualizará automáticamente
        await simpleQto.sumQuantitiesV2(selection);
      }

      const onCalculateMaterials = async () => {
        if (!floatingGrid) return
        
        const highlighter = components.get(OBCF.Highlighter)
        const materialQto = components.get(MaterialQTO)
        const selection = highlighter.selection.select
        
        floatingGrid.layout = "materials"
        
        if (Object.keys(selection).length > 0) {
          const result = await materialQto.calculateMaterialQuantities(selection);
          
          const materialsDiv = document.querySelector('#materials-data') as HTMLElement;
          if (!materialsDiv) {
            console.error("Materials div not found!");
            return;
          }

          let html = '<bim-label>Material Quantities</bim-label><div style="margin-top: 10px;">';
          
          // Iterate through all materials
          Object.entries(result).forEach(([materialName, quantities]) => {
            html += `<div style="font-weight: bold; margin: 15px 0 10px 0;">${materialName}</div>`;
            
            // Si no hay cantidades, mostrar N/A
            if (Object.keys(quantities).length === 0) {
              html += `
                <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                  <span>Volume</span>
                  <span>N/A</span>
                </div>
              `;
            } else {
              Object.entries(quantities).forEach(([name, value]) => {
                const displayValue = value !== null && !isNaN(Number(value)) 
                  ? `${Number(value).toFixed(2)} m³`
                  : 'N/A';
                  
                html += `
                  <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>${name}</span>
                    <span>${displayValue}</span>
                  </div>
                `;
              });
            }
          });
          
          html += '</div>';
          materialsDiv.innerHTML = html;
        }
      }

      const onCalculateCosts = async () => {
        if (!floatingGrid || !fragmentModel) return;
        
        const costCalculator = components.get(CostCalculator);
        const fragmentsManager = components.get(OBC.FragmentsManager);
        if (!costCalculator || !fragmentsManager) {
          console.error('Cost Calculator or Fragments Manager not found');
          return;
        }
        
        floatingGrid.layout = "cost";
        
        // Asegurarnos de que el contenedor existe
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const costDataContainer = document.getElementById('cost-data');
        if (!costDataContainer) return;
        
        // Mostrar mensaje de procesamiento
        costDataContainer.innerHTML = `
          <div id="cost-initial-state" style="margin: 15px 0; text-align: center;">
            <div style="color: #888;">Processing quantities...</div>
          </div>
        `;
        
        try {
          
          const fragmentIdMap = fragmentsManager.getModelIdMap({ 
            [fragmentModel.id]: new Set(
              Array.from(fragmentModel.items.values())
                .map(item => Number(item.id))
                .filter(id => !isNaN(id))
            ) 
          });
          
          const results = await costCalculator.calculateMaterialCosts(fragmentIdMap);
  

          // Convert raw results to MaterialCostsTableData format
          costCalculator.materialCostsTable = {
            columns: [
              { header: 'TALO Code', dataField: 'taloCode', width: '16%', sortable: true },
              { header: 'Name', dataField: 'name', width: '34%', sortable: true },
              { header: 'Type', dataField: 'type', width: '18%', sortable: true },
              { header: 'Base Quantities', dataField: 'baseQuantities', width: '32%', sortable: true }
            ],
            data: results.map(item => ({
              id: String(item.id),
              name: item.name || '',
              type: item.type || '',
              category: item.type || '',
              taloCode: item.taloCode || '',
              materialCost: item.costs?.material || 0,
              laborCost: item.costs?.labor || 0,
              subcontractCost: item.costs?.subcontract ?? 0,
              totalCost: item.costs?.total || 0,
              baseQuantities: JSON.stringify(item.baseQuantities || {}),
              primaryQuantity: `${item.quantity || 0} ${item.baseQuantities ? Object.values(item.baseQuantities)[0]?.unit || '-' : '-'}`
            }))
          };
          
          // Actualizar el contenedor (ya existe, solo actualizar contenido)
          const costDataContainer = document.getElementById('cost-data');
          if (!costDataContainer) return;
          
          const sendLabel = getCostBridgeUiText(
            "sendToQuantitiesCost",
            useCostStore.getState().language
          );
          const buttonTemplate = BUI.html`
            <bim-button
              label="${sendLabel}"
              icon="tabler:table-export"
              @click=${async () => {
        
                const calculator = components.get(CostCalculator);
                if (!calculator) {
                  console.error('[Cost Panel] CostCalculator not found');
                  return;
                }

                // Helper function to determine unit based on quantity type
                function determineUnit(quantityType: string): string {
                  const lowerType = quantityType.toLowerCase();
                  if (lowerType.includes('volume')) return 'm³';
                  if (lowerType.includes('area')) return 'm²';
                  if (lowerType.includes('length') || lowerType.includes('height') || lowerType.includes('width')) return 'm';
                  if (lowerType.includes('count')) return 'units';
                  return '';
                }

                // Get raw data from calculator
                const rawData = await calculator.calculateMaterialCosts({});
        

                // Convert to BaseCostElement format and remove duplicates
                const uniqueElements = new Map();
                rawData.forEach((item: any) => {
                  // Extract all available quantities
                  const quantities: { [key: string]: { value: number, unit: string } } = {};
                  
                  // Check if item has baseQuantities
                  if (item.baseQuantities) {
                    Object.entries(item.baseQuantities).forEach(([key, value]: [string, any]) => {
                      if (value && typeof value.value === 'number') {
                        quantities[key] = {
                          value: value.value,
                          unit: value.unit || determineUnit(key)
                        };
                      }
                    });
                  }

                  // Check if item has quantities directly
                  if (item.quantities) {
                    Object.entries(item.quantities).forEach(([key, value]: [string, any]) => {
                      if (value && typeof value.value === 'number') {
                        quantities[key] = {
                          value: value.value,
                          unit: value.unit || determineUnit(key)
                        };
                      }
                    });
                  }

                  // Create temporary ElementData for quantity calculation
                  const tempElementData = {
                    id: item.id || Date.now(),
                    name: item.name || '',
                    type: item.type || '',
                    category: item.type || '',
                    taloCode: item.taloCode || item.taloClassification?.identification || '',
                    quantities: quantities,
                    properties: {},
                    taloName: item.taloName || item.taloClassification?.name || ''
                  };

                  // Try to get quantity using Talo 2000 rules first
                  let primaryQuantity = 0;
                  try {
                    const taloQuantity = getTalo2000Quantity(tempElementData, tempElementData.taloCode);
                    if (taloQuantity) {
                      primaryQuantity = taloQuantity.value;
                    } else {
                      // Fallback to the original priority order if Talo 2000 rules don't apply
                      if (quantities['Volume']?.value) {
                        primaryQuantity = quantities['Volume'].value;
                      } else if (quantities['Area']?.value) {
                        primaryQuantity = quantities['Area'].value;
                      } else if (quantities['Length']?.value) {
                        primaryQuantity = quantities['Length'].value;
                      } else if (Object.values(quantities).length > 0) {
                        primaryQuantity = Object.values(quantities)[0].value;
                      }
                    }
                  } catch (error) {
                    console.warn('[Cost Panel] Error applying Talo 2000 quantity rules:', error);
                    // Fallback to the original priority order
                    if (quantities['Volume']?.value) {
                      primaryQuantity = quantities['Volume'].value;
                    } else if (quantities['Area']?.value) {
                      primaryQuantity = quantities['Area'].value;
                    } else if (quantities['Length']?.value) {
                      primaryQuantity = quantities['Length'].value;
                    } else if (Object.values(quantities).length > 0) {
                      primaryQuantity = Object.values(quantities)[0].value;
                    }
                  }

                  const element: BaseCostElement = {
                    id: item.id || Date.now(),
                    globalId: item.globalId,
                    name: item.name || '',
                    type: item.type || '',
                    taloCode: item.taloCode || item.taloClassification?.identification || '',
                    taloName: item.taloName || item.taloClassification?.name || '',
                    quantity: primaryQuantity,
                    baseQuantities: quantities,
                    costs: item.costs || {
                      material: 0,
                      labor: 0,
                      subcontract: 0,
                      total: 0
                    },
                    // Copy Littera classification from extracted data (including multiple codes)
                    litteraCodes: item.litteraCodes || undefined,
                    // Legacy fields for backward compatibility
                    litteraCode: item.litteraCode || undefined,
                    litteraName: item.litteraName || undefined,
                    litteraCategory: item.litteraCategory || undefined
                  };

                  // Attach extra IFC properties (Pset.Property -> value) and floor without breaking BaseCostElement typing
                  (element as any).extraProperties = item.extraProperties;
                  (element as any).floor = (item as any).floor;

                  // Debug: Log Littera codes transfer
                  if (item.litteraCodes && item.litteraCodes.length > 0) {
                    console.log(`[IFCViewer] Element ${element.id} transferring ${item.litteraCodes.length} Littera codes:`, 
                      item.litteraCodes.map((lc: any) => lc.litteraCode).join(', '));
                  }

                  // Only keep the first occurrence of each element ID
                  if (!uniqueElements.has(element.id)) {
                    uniqueElements.set(element.id, element);
                  }
                });

                const costElements = Array.from(uniqueElements.values()).filter(
                  (el) => !isMeasurementExcluded(el.name, el.type).excluded
                );

                // Get store actions
                const store = useCostStore.getState();
                
                // Set project info
                const projectInfo = {
                  name: 'Current Project',
                  area: 1000,
                  cost: 0,
                  type: 'residential',
                  location: 'Helsinki',
                  description: 'Project imported from IFC viewer',
                  buildingType: 'Residential',
                  constructionMethod: 'OnSite'
                };
                
        
                store.setProjectInfo(projectInfo);
                store.setCostData(costElements);

                // Show success message
                const messageDiv = document.createElement('div');
                messageDiv.style.cssText = `
                  position: fixed;
                  top: 50%;
                  left: 50%;
                  transform: translate(-50%, -50%);
                  background: rgba(2, 154, 224, 0.9);
                  color: white;
                  padding: 20px;
                  border-radius: 8px;
                  z-index: 1000;
                  display: flex;
                  align-items: center;
                  gap: 10px;
                  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                `;
                const toastLang = useCostStore.getState().language;
                messageDiv.innerHTML = `
                  <span class="material-icons">check_circle</span>
                  <div>
                    <div style="font-weight: bold; margin-bottom: 4px;">${getCostBridgeUiText("sendSuccessTitle", toastLang)}</div>
                    <div>${getCostBridgeUiText("sendSuccessBody", toastLang)}</div>
                  </div>
                `;
                document.body.appendChild(messageDiv);
                
                setTimeout(() => {
                  messageDiv.style.opacity = '0';
                  messageDiv.style.transition = 'opacity 0.5s ease-out';
                  setTimeout(() => {
                    if (document.body.contains(messageDiv)) {
                      document.body.removeChild(messageDiv);
                    }
                    window.location.hash = '#/costs';
                  }, 500);
                }, 1500);
              }}
            ></bim-button>
          `;
          
          const costTableColumns = costCalculator.materialCostsTable.columns;
          const costCellBase =
            "padding: 3px 4px; border-bottom: 1px solid #333; font-size: 8px; color: #888; vertical-align: top; word-break: break-word; overflow-wrap: anywhere;";
          const formatCostQuantities = (row: MaterialCostsTableData): string => {
            try {
              if (row.baseQuantities) {
                const quantities = JSON.parse(row.baseQuantities);
                const formatted = Object.entries(quantities)
                  .map(([key, value]: [string, any]) => {
                    if (value && typeof value.value === "number") {
                      return `${key}: ${value.value.toFixed(2)} ${value.unit || ""}`;
                    }
                    return null;
                  })
                  .filter(Boolean)
                  .join(" | ");
                if (formatted) return formatted;
              }
              if (row.primaryQuantity) return row.primaryQuantity;
              return "No quantities available";
            } catch (e) {
              console.warn("Failed to parse quantities:", e);
              return "Error parsing quantities";
            }
          };

          costDataContainer.innerHTML = `
            <bim-label>Cost Information</bim-label>
            <div style="margin-top: 10px; max-height: 390px; overflow: auto;">
              <table class="cost-analysis-table" style="width: 100%; table-layout: fixed; border-collapse: collapse; font-family: Arial, sans-serif;">
                  <colgroup>
                    ${costTableColumns.map((col) => `<col style="width: ${col.width}">`).join("")}
                  </colgroup>
                  <thead>
                    <tr>
                      ${costTableColumns
                        .map(
                          (col) => `
                        <th style="text-align: left; padding: 4px; border-bottom: 1px solid #444; color: #888; font-weight: normal; text-transform: uppercase; font-size: 6px;">${escapePropertyHtml(col.header)}</th>`
                        )
                        .join("")}
                    </tr>
                  </thead>
                  <tbody>
                    ${costCalculator.materialCostsTable.data
                      .map((row: MaterialCostsTableData) => {
                        const displayQuantities = formatCostQuantities(row);
                        return `
                        <tr 
                          style="cursor: pointer; transition: background-color 0.2s;"
                          onmouseover="this.style.backgroundColor='#333'"
                          onmouseout="this.style.backgroundColor=''"
                          onclick="document.dispatchEvent(new CustomEvent('highlight-cost-element', { 
                            detail: { 
                              expressId: ${Number(row.id) || 0}
                            }
                          }))"
                        >
                          <td style="text-align: left; ${costCellBase}">${escapePropertyHtml(row.taloCode || "-")}</td>
                          <td style="text-align: left; ${costCellBase}">${escapePropertyHtml(row.name || "-")}</td>
                          <td style="text-align: left; ${costCellBase} white-space: nowrap;">${escapePropertyHtml(row.type || "-")}</td>
                          <td style="text-align: left; ${costCellBase}">${escapePropertyHtml(displayQuantities)}</td>
                        </tr>
                      `;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
            <div id="cost-button-container" style="margin-top: 8px;"></div>
          `;

          const buttonContainer = document.getElementById('cost-button-container');
          if (buttonContainer) {
            render(buttonTemplate, buttonContainer);
          }
        } catch (err) {
          console.error('Cost calculation failed:', err);
          const costDataContainer = document.getElementById('cost-data');
          if (costDataContainer) {
            costDataContainer.innerHTML = `
              <div style="color: #d32f2f; padding: 15px; background: #ffebee; border-radius: 4px; margin: 10px 0; font-size: 6px;">
                Error calculating costs: ${err instanceof Error ? err.message : 'Unknown error'}
              </div>
            `;
          }
        }
      };

      return BUI.html`
        <bim-toolbar style="justify-self: center;">
          <bim-toolbar-section label="File">
            ${loadIfcBtn}
          </bim-toolbar-section>
          <bim-toolbar-section label="View">
            <bim-button
              tooltip-title="Hide/Show"
              icon="tabler:square-toggle"
              @click=${onToggleVisibility}
            ></bim-button>
            <bim-button
              tooltip-title="Isolate"
              icon="prime:filter-fill"
              @click=${onIsolate}
            ></bim-button>
            <bim-button
              tooltip-title="Show All"
              icon="tabler:eye-filled"
              @click=${onShowAll}
            ></bim-button>
            <bim-button
              tooltip-title="Zoom Extend"
              icon="tabler:arrows-maximize"
              @click=${onZoomExtend}
            ></bim-button>
          </bim-toolbar-section>
          <bim-toolbar-section label="Select">
            <bim-button
              id="box-select-toggle-btn"
              tooltip-title="Area Select"
              icon="tabler:marquee-2"
              @click=${() => {
                setBoxSelectEnabledSynced(!boxSelectEnabledRef.current);
              }}
            ></bim-button>
            <bim-button
              id="classifications-panel-toggle-btn"
              tooltip-title="Model / Selection"
              icon="tabler:binary-tree"
              @click=${onToggleClassificationsPanel}
            ></bim-button>
          </bim-toolbar-section>
          <bim-toolbar-section label="Inspect">
            <bim-button
              id="properties-panel-toggle-btn"
              tooltip-title="Properties"
              icon="material-symbols:list"
              @click=${onTogglePropertiesPanel}
            ></bim-button>
            <bim-button
              tooltip-title="Base Quantities"
              icon="tabler:calculator-filled"
              @click=${onCalculateVolume}
            ></bim-button>
          </bim-toolbar-section>
          <!-- LCA Data section - Hidden -->
          <!--
          <bim-toolbar-section label="LCA Data">
            <bim-button
              tooltip-title="Material/Quantities"
              icon="tabler:ruler"
              @click=${onCalculateMaterials}
            ></bim-button>
            <bim-button
              tooltip-title="Extract/Migrate"
              icon="tabler:chart-dots"
              @click=${async (e: Event) => {
                e.preventDefault();
                e.stopPropagation();
                
                if (!floatingGrid) return;
                
                const highlighter = components.get(OBCF.Highlighter);
                const lcaCalculator = components.get(LCACalculator);
                const selection = highlighter.selection.select;

                // 1. Cambiar layout
                floatingGrid.layout = "lca";
                
                // Asegurarnos de que el contenedor existe
                await new Promise(resolve => setTimeout(resolve, 50));
                
                const contentContainer = document.querySelector('#lca-content') as HTMLElement;
                if (!contentContainer) return;

                // 2. Mostrar estado inicial inmediatamente
                contentContainer.innerHTML = `                  <div id="lca-initial-state" style="margin: 15px 0; text-align: center;">
                    <div style="margin-bottom: 15px; color: #888;">Calculating material quantities...</div>
                    <div id="lca-progress-bar" style="
                      width: 100%;
                      background: #e0e0e0;
                      height: 4px;
                      border-radius: 2px;
                      overflow: hidden;
                    ">
                      <div id="lca-progress" style="
                        width: 5%;
                        background: #2196F3;
                        height: 100%;
                        border-radius: 2px;
                        transition: width 0.3s ease-in-out;
                      "></div>
                    </div>
                  </div>
                `;

                try {
                  // 3. Configurar callback de progreso
                  lcaCalculator.onProgress = (percent) => {
                    const progressBar = document.querySelector('#lca-progress') as HTMLElement;
                    if (progressBar) {
                      progressBar.style.width = `${percent}%`;
                    }
                  };

                  // 4. Ejecutar cálculo
                  const result = await lcaCalculator.calculateMaterialQuantities(selection);
                  
                  // 5. Mostrar resultados
                  contentContainer.innerHTML = `
                    <style>
                      #lca-content table {
                        width: 100%;
                        border-collapse: collapse;
                      }
                      #lca-content td, #lca-content th {
                        padding: 10px;
                        font-size: 8px;  /* Tamaño base del texto */
                      }
                      #lca-content .header-row td {
                        font-size: 10px;  /* Tamaño para totales */
                        font-weight: bold;
                      }
                      #lca-content .element-row td {
                        font-size: 10px;  /* Tamaño para subtotales */
                        font-weight: bold;
                      }
                    </style>
                    <table class="lca-table">
                      <thead>
                        <tr>
                          ${lcaCalculator.materialQuantitiesTable.columns.map(col => 
                            `<th>${col.header}</th>`
                          ).join('')}
                        </tr>
                      </thead>
                      <tbody>
                        ${lcaCalculator.materialQuantitiesTable.data.map(row => `
                          <tr class="${row.isHeader ? (row.property === 'Total Material Volumes' ? 'header-row' : 'element-row') : ''}">
                            <td>${row.property}</td>
                            <td>${row.value}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  `;
                } catch (error) {
                  contentContainer.innerHTML = `
                    <div style="color: #d32f2f; padding: 15px; background: #ffebee; border-radius: 4px; margin: 10px 0;">
                      Error calculating LCA data: ${error instanceof Error ? error.message : 'Unknown error'}
                    </div>
                  `;
                }
              }}
            ></bim-button>
          </bim-toolbar-section>
          -->
          <bim-toolbar-section label="Cost">
            <bim-button
              tooltip-title="Calculate Costs"
              icon="tabler:currency-euro"
              label=""
              @click=${onCalculateCosts}
            ></bim-button>
          </bim-toolbar-section>
          <!-- Documents section - Hidden (Map/BCF eliminados en la rama de migración)
          <bim-toolbar-section label="Documents">
          </bim-toolbar-section>
          -->
        </bim-toolbar>
      `
    })

    /** Shared width for all floating side panels (grid column). */
    const floatingSidePanelWidth = "26rem";

    floatingGrid.layouts = {
      main: {
        template: `
          "empty" 1fr
          /1fr
        `,
        elements: {},
      },
      second: {
        template: `
          "empty elementPropertyPanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: { 
          elementPropertyPanel
        },
      },
      world: {
        template: `
          "empty worldPanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: { 
          worldPanel
        },
      },
      volume: {
        template: `
          "empty volumePanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: { 
          volumePanel
        },
      },
      materials: {
        template: `
          "empty materialsPanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: { 
          materialsPanel
        },
      },
      classifications: {
        template: `
          "empty classificationsPanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: {
          classificationsPanel
        },
      },
      lca: {
        template: `
          "empty lcaPanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: { 
          lcaPanel: lcaPanel()
        },
      },
      cost: {
        template: `
          "empty costPanel" 1fr
          /1fr ${floatingSidePanelWidth}
        `,
        elements: { 
          costPanel: costPanel()
        },
      },
    }
    floatingGrid.layout = "main"
    viewerContainer.appendChild(floatingGrid)
    
    // Añadir la toolbar directamente al viewerContainer (fuera del grid) para que esté siempre fija
    viewerContainer.appendChild(toolbar)
    
    /** Idle: icono azul + botón negro. Hover/active: invertido. Pierces bim-button shadow. */
    const COSTA_TOOLBAR_BTN_HOST_CSS = `
      :host {
        --bim-label--c: #42a5f5 !important;
        --bim-icon--c: #42a5f5 !important;
        background-color: #212121 !important;
        outline: none !important;
      }
      :host(:hover),
      :host([active]) {
        --bim-label--c: #212121 !important;
        --bim-icon--c: #212121 !important;
        background-color: #42a5f5 !important;
      }
    `;
    const COSTA_TOOLBAR_BTN_NESTED_CSS = `
      :host {
        --bim-icon--c: var(--bim-label--c) !important;
        color: var(--bim-label--c) !important;
      }
      iconify-icon {
        color: var(--bim-icon--c, var(--bim-label--c)) !important;
      }
    `;

    const ensureShadowStyle = (shadow: ShadowRoot, css: string) => {
      let style = shadow.querySelector("#costa-toolbar-btn-css") as HTMLStyleElement | null;
      if (!style) {
        style = document.createElement("style");
        style.id = "costa-toolbar-btn-css";
        shadow.appendChild(style);
      }
      if (style.textContent !== css) style.textContent = css;
    };

    const paintToolbarButtonShadows = (toolbarElement: HTMLElement) => {
      const paintNestedIcons = (root: ParentNode) => {
        root.querySelectorAll("bim-label, bim-icon").forEach((nested) => {
          const nestedShadow = (nested as HTMLElement).shadowRoot;
          if (!nestedShadow) return;
          ensureShadowStyle(nestedShadow, COSTA_TOOLBAR_BTN_NESTED_CSS);
          paintNestedIcons(nestedShadow);
        });
      };

      toolbarElement.querySelectorAll("bim-button").forEach((node) => {
        const btn = node as HTMLElement;
        const shadow = btn.shadowRoot;
        if (!shadow) return;
        ensureShadowStyle(shadow, COSTA_TOOLBAR_BTN_HOST_CSS);
        paintNestedIcons(shadow);
      });
    };

    // Función para aplicar estilos a la toolbar (centrada en la parte inferior, relativa al viewerContainer)
    const applyToolbarStyles = () => {
      const toolbarElement = viewerContainer.querySelector('bim-toolbar') as HTMLElement;
      if (toolbarElement) {
        // La toolbar está directamente en viewerContainer, posicionarla de forma absoluta relativa a él
        toolbarElement.style.cssText = `
          position: absolute !important;
          bottom: 20px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 1000 !important;
          background: rgba(42, 42, 42, 0.95) !important;
          backdrop-filter: blur(10px) !important;
          -webkit-backdrop-filter: blur(10px) !important;
          border-radius: 8px !important;
          padding: 8px 16px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
          display: flex !important;
          justify-content: center !important;
          align-items: center !important;
          margin: 0 auto !important;
          pointer-events: auto !important;
        `;
        
        // Aplicar estilos a las secciones para centrar verticalmente los botones
        const sections = toolbarElement.querySelectorAll('bim-toolbar-section');
        sections.forEach((section) => {
          const sectionElement = section as HTMLElement;
          sectionElement.style.cssText = `
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-height: 40px !important;
          `;
        });

        paintToolbarButtonShadows(toolbarElement);
      }
    };
    
    // Aplicar estilos inicialmente (la toolbar ya está en el viewerContainer)
    setTimeout(applyToolbarStyles, 100);
    setTimeout(applyToolbarStyles, 400);
    
    // Observer simple para re-aplicar estilos si el toolbar se modifica
    const observer = new MutationObserver(() => {
      applyToolbarStyles();
    });
    
    observer.observe(viewerContainer, {
      childList: true,
      subtree: true
    });
  }

  React.useEffect(() => {
    setTimeout(() => {
      setViewer()
      setupUI()

      // MCP WebSocket for Claude Desktop (load-ifc, etc.)
      const mcpWs = setupMCPWebSocket(components);
      void processPendingMcpIfcLoad(components, mcpWs);

      // Exponer IFCQuantityService a la consola del navegador
      exposeIFCQuantityServiceToConsole();
      
      // Exponer modelo y components globalmente para facilitar acceso desde consola
      // Esto permite usar: window.getIFCModel() y window.getIFCComponents()
      if (typeof window !== 'undefined') {
        (window as any).__ifcViewerActive = true;
        (window as any).getIFCModel = () => {
          const fragments = components.get(OBC.FragmentsManager);
          if (fragments.groups.size > 0) {
            const firstModel = Array.from(fragments.groups.values())[0];
            return firstModel;
          }
          return null;
        };
        
        (window as any).getIFCComponents = () => {
          return components;
        };
      }
    })

    return () => {
      setGhostModeEnabled(false);
      registerGhostPainter(null);
      registerHighlighter(null);
      registerExternalSelectionFlag(null);
      uninstallViewerSelectionGlobals();
      try {
        (window as any).__costaBoxSelectCleanup?.();
      } catch {
        /* noop */
      }
      if (typeof window !== 'undefined') {
        (window as any).__ifcViewerActive = false;
        delete (window as any).getIFCComponents;
        delete (window as any).getIFCModel;
        delete (window as any).fragmentModelRef;
        delete (window as any).__costaBoxSelectCleanup;
        delete (window as any).highlighterRef;
        delete window.__costaSearchSelectionIds;
        delete window.__costaGetTreeScopeIds;
        delete window.__costaSetGhostMode;
        delete window.__costaExitGroupAddMode;
        delete window.__costaHiderIsolate;
        delete window.__costaGetViewerSelectionState;
        delete window.__costaResetViewerVisualState;
      }
      if (components) {
        components.dispose()
      }
      if (fragmentModel) {
        fragmentModel.dispose()
        fragmentModel = undefined
      }
    }
  }, [])

  // Effect para manejar el resize cuando cambia el modo full screen
  React.useEffect(() => {
    if (worldRef.current) {
      // Pequeño delay para asegurar que el DOM se haya actualizado
      setTimeout(() => {
        const viewerContainer = document.getElementById("viewer-container") as HTMLElement;
        if (viewerContainer && worldRef.current) {
          // Disparar evento de resize para que el renderer y cámara se actualicen
          window.dispatchEvent(new Event('resize'));
          
          // También actualizar la cámara directamente
          if (worldRef.current.camera && 'updateAspect' in worldRef.current.camera) {
            (worldRef.current.camera as any).updateAspect();
          }
          
          // Forzar un resize del renderer
          if (worldRef.current.renderer) {
            // Usar el método resize sin parámetros para que use las dimensiones del contenedor
            (worldRef.current.renderer as any).resize();
          }
        }
        
        // Actualizar el padding del floating grid directamente en el DOM
        // Padding normal ya que la toolbar está fuera del grid
        const floatingGrid = document.querySelector('bim-grid[floating]') as HTMLElement;
        if (floatingGrid) {
          const padding = "20px 20px 20px 20px";
          floatingGrid.style.padding = padding;
        }
      }, 100);
    }
  }, [props.isExpanded]);

  React.useEffect(() => {
    if (props.ifcFilePath) {
      loadIFCFromPath(props.ifcFilePath);
    }
  }, [props.ifcFilePath]);

  const loadIFCFromPath = async (path: string) => {
    let loadingOverlay: HTMLDivElement | undefined;
    
    try {
      // Crear overlay con spinner
      loadingOverlay = document.createElement('div');
      loadingOverlay.className = 'loading-container';
      loadingOverlay.id = 'ifc-loading-overlay';
      loadingOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10000;
        background: transparent;
        padding: 0;
        pointer-events: none;
      `;
      loadingOverlay.innerHTML = `
        <div class="spinner"></div>
        <p style="color: white; margin-top: 20px; margin-bottom: 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">Loading IFC file...</p>
      `;
      
      document.body.appendChild(loadingOverlay);
      
      const response = await fetch(path);
      const arrayBuffer = await response.arrayBuffer();
      applyPerformanceProfileForModel(arrayBuffer.byteLength);
      const uint8Array = new Uint8Array(arrayBuffer);
      (window as any).ifcRawBuffer = uint8Array;
      (window as any).ifcFilename = path.split('/').pop()?.replace(/[?#].*$/, '') ?? 'model.ifc';

      const ifcLoader = components.get(OBC.IfcLoader);

      // Cargar el modelo IFC
      const model = await ifcLoader.load(uint8Array);
      if (!model) {
        throw new Error("Failed to load IFC model");
      }

      // Limpiar modelo anterior si existe
      if (fragmentModel) {
        fragmentModel.dispose();
        fragmentModel = undefined;
      }

      // Asignar el modelo directamente
      fragmentModel = model;
      (window as any).fragmentModelRef = model;
      // scene + processModel + culler se gestionan en onFragmentsLoaded (ruta única).

      // Hacer zoom extend al modelo cargado
      if (zoomUtilRef.current) {
        await zoomUtilRef.current.zoomToModel(model);
      }

      // Remover overlay
      if (loadingOverlay && document.body.contains(loadingOverlay)) {
        document.body.removeChild(loadingOverlay);
      }

    } catch (error) {
      console.error('Error loading IFC file:', error);
      
      // Remover overlay en caso de error
      if (loadingOverlay && document.body.contains(loadingOverlay)) {
        document.body.removeChild(loadingOverlay);
      }
    }
  };

  const handleFileLoad = async (file: File) => {
    let loadingOverlay: HTMLDivElement | undefined;
    
    try {
      // Crear overlay con spinner
      loadingOverlay = document.createElement('div');
      loadingOverlay.className = 'loading-container';
      loadingOverlay.id = 'ifc-loading-overlay-file';
      loadingOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10000;
        background: transparent;
        padding: 0;
        pointer-events: none;
      `;
      loadingOverlay.innerHTML = `
        <div class="spinner"></div>
        <p style="color: white; margin-top: 20px; margin-bottom: 0; text-shadow: 1px 1px 2px rgba(0,0,0,0.8);">Loading IFC file...</p>
      `;
      
      document.body.appendChild(loadingOverlay);
      
      const reader = new FileReader();
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
      applyPerformanceProfileForModel(file.size || buffer.byteLength);

      const uint8Array = new Uint8Array(buffer);
      (window as any).ifcRawBuffer = uint8Array;
      (window as any).ifcFilename = file.name;
      const ifcLoader = components.get(OBC.IfcLoader);
      
      // Limpiar modelo anterior si existe
      if (fragmentModel) {
        fragmentModel.dispose();
        fragmentModel = undefined;
      }

      // Cargar el modelo IFC
      const model = await ifcLoader.load(uint8Array);
      if (!model) {
        throw new Error("Failed to load IFC model");
      }

      fragmentModel = model;
      (window as any).fragmentModelRef = model;
      // scene + processModel + culler se gestionan en onFragmentsLoaded (ruta única).

      // Hacer zoom extend al modelo cargado
      if (zoomUtilRef.current) {
        await zoomUtilRef.current.zoomToModel(model);
      }

      // Remover overlay
      if (loadingOverlay && document.body.contains(loadingOverlay)) {
        document.body.removeChild(loadingOverlay);
      }

    } catch (error) {
      console.error('Error processing IFC:', error);
      
      // Remover overlay en caso de error
      if (loadingOverlay && document.body.contains(loadingOverlay)) {
        document.body.removeChild(loadingOverlay);
      }
    }
  };

  const formatFragmentId = (id: string) => {
    const chunks = [];
    for (let i = 0; i < id.length; i += 16) {
      chunks.push(id.slice(i, i + 16));
    }
    return chunks.join('\n');
  };




  // Add event listener for highlighting cost elements
  document.addEventListener('highlight-cost-element', ((event: CustomEvent) => {
    const expressId = Number(event.detail.expressId);
    if (!expressId || Number.isNaN(expressId)) return;

    const highlighter = components.get(OBCF.Highlighter);
    const model = ((window as any).fragmentModelRef as FragmentsGroup | undefined) ?? fragmentModel;
    if (!highlighter || !model) {
      console.warn('Highlighter or fragmentModel not available');
      return;
    }

    const selection = buildFragmentIdMapForIds(model, [expressId]);
    if (Object.keys(selection).length === 0) return;

    // Replace live via facade (no clear()+reselect; avoids onClear panel flicker).
    applySelectionWithStyle('cost-select', selection, false);
  }) as EventListener);



  return (
    <div 
      style={{
        width: '100%',
        height: '100%',
        transition: 'all 0.3s ease-in-out',
        backgroundColor: '#1a1a1a'
      }}
    >
      <div 
        id="viewer-container" 
        style={{
          width: '100%',
          height: '100%',
          backgroundColor: '#1a1a1a',
          position: 'relative'
        }}
      >
        <div style={{ display: 'none' }}>
          <MaterialsPage />
        </div>
      </div>
    </div>
  );
}
