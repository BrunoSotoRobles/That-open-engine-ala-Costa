import * as OBC from "@thatopen/components";
import { FragmentsGroup } from "@thatopen/fragments";
import * as THREE from "three";

export class ZoomExtendUtil extends OBC.Component {
  enabled = true;
  isDisposeable = false;
  isResizeable = false;
  isUpdateable = false;

  constructor(components: OBC.Components) {
    super(components);
  }

  async zoomToModel(model: FragmentsGroup, world?: any) {
    console.log('[ZoomExtendUtil] Starting zoom to model');
    // Si se pasa un world específico, usarlo; sino intentar obtenerlo
    let targetWorld = world;
    if (!targetWorld) {
      const worlds = this.components.get(OBC.Worlds);
      // En nuestra versión de That Open Engine, worlds.list es un Map
      if (worlds && (worlds.list as Map<string, any>).size > 0) {
        targetWorld = (worlds.list as Map<string, any>).values().next().value;
      }
    }
    
    if (!targetWorld) {
      console.warn('[ZoomExtendUtil] No world found');
      return;
    }

    // World and camera resolved correctly
    const camera = targetWorld.camera;
    if (!camera) {
      console.warn('[ZoomExtendUtil] No camera found in world');
      return;
    }

    // Camera found, computing bounding box
    const box = new THREE.Box3();
    for (const fragment of model.items) {
      if (fragment.mesh) {
        fragment.mesh.geometry.computeBoundingBox();
        box.expandByObject(fragment.mesh);
      }
    }

    if (box.isEmpty()) {
      console.warn('[ZoomExtendUtil] Bounding box is empty');
      return;
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    
    console.log('[ZoomExtendUtil] Bounding box center:', center);
    console.log('[ZoomExtendUtil] Bounding box size:', size);

    const maxSize = Math.max(size.x, size.y, size.z);
    
    // Acceder a la cámara Three.js subyacente
    const threeCamera = camera.three as any;
    if (!threeCamera) {
      console.warn('[ZoomExtendUtil] No Three.js camera found');
      return;
    }
    
    const fov: number = threeCamera.fov ?? 50; // FOV por defecto si no está disponible
    const aspect: number = threeCamera.aspect ?? 1; // Aspect por defecto si no está disponible
    
    const fitHeightDistance = maxSize / (2 * Math.tan((Math.PI * fov) / 360));
    const fitWidthDistance = fitHeightDistance / aspect;

    // Ajustar el factor de distancia según el tamaño del modelo
    let distanceFactor = 1.2;
    if (maxSize > 300) distanceFactor = 1.0;
    if (maxSize > 600) distanceFactor = 0.85;
    
    const distance = distanceFactor * Math.max(fitHeightDistance, fitWidthDistance);

    console.log('[ZoomExtendUtil] Calculated distance:', distance);
    console.log('[ZoomExtendUtil] Camera FOV:', fov);
    console.log('[ZoomExtendUtil] Camera aspect:', aspect);

    // Centro visual: mismo X/Z, pero un poco por encima del mínimo en Y
    const visualCenter = center.clone();
    visualCenter.y = box.min.y + size.y * 0.4;

    // Calcular dirección de vista a partir de la cámara actual
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    if (camera.controls && typeof camera.controls.getPosition === 'function' && typeof camera.controls.getTarget === 'function') {
      camera.controls.getPosition(from);
      camera.controls.getTarget(to);
    } else {
      from.copy(threeCamera.position);
      to.copy(visualCenter);
    }

    const direction = new THREE.Vector3().subVectors(from, to).normalize();
    if (direction.length() < 0.001) {
      direction.set(1, 1, 1).normalize();
    }

    const newPosition = visualCenter.clone().add(direction.multiplyScalar(distance));

    // console.log('[ZoomExtendUtil] New camera position:', newPosition);
    // console.log('[ZoomExtendUtil] Looking at visual center:', visualCenter);

    camera.controls.setLookAt(
      newPosition.x,
      newPosition.y,
      newPosition.z,
      visualCenter.x,
      visualCenter.y,
      visualCenter.z
    );

    // Forzar actualización de la cámara (si el método existe)
    if (typeof (camera as any).updateAspect === 'function') {
      (camera as any).updateAspect();
    }
    
    console.log('[ZoomExtendUtil] Zoom completed');
  }

  get(): void {
    // Not needed for this utility
  }

  dispose(): void {
    // Not needed for this utility
  }
} 