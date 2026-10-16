import * as OBC from "@thatopen/components"
import * as THREE from "three"
import { FragmentsGroup } from "@thatopen/fragments"

export class ZoomExtendUtil {
  constructor(private components: OBC.Components) {
    // No need to store world in constructor - will be obtained when needed
  }

  /**
   * Obtiene el world activo, intentando primero el pasado como parámetro,
   * luego el almacenado en components
   */
  private getWorld(world?: OBC.World): OBC.World | null {
    // Si se pasa un world específico, usarlo
    if (world) {
      return world;
    }

    // Intentar obtener el world desde components
    try {
      const worlds = this.components.get(OBC.Worlds);
      if (worlds && worlds.list && (worlds.list as Map<string, any>).size > 0) {
        return (worlds.list as Map<string, any>).values().next().value;
      }
    } catch (error) {
      console.warn('[Zoom] Error getting world from components:', error);
    }

    return null;
  }

  async zoomToModel(fragmentModel: FragmentsGroup, world?: OBC.World) {
    if (!fragmentModel) {
      console.warn('[Zoom] No fragment model provided');
      return;
    }

    // Obtener el world (del parámetro o de components)
    const targetWorld = this.getWorld(world);
    if (!targetWorld) {
      console.warn('[Zoom] World not found');
      return;
    }

    const camera = targetWorld.camera;
    if (!camera) {
      console.warn('[Zoom] Camera not found in world');
      return;
    }

    if (!camera.controls) {
      console.warn('[Zoom] Camera controls not found');
      return;
    }
    
    // Calcular bounding box usando expandByObject que considera transformaciones
    // Esto es más robusto que usar geometry.boundingBox que solo considera coordenadas locales
    const bbox = new THREE.Box3();
    let fragmentCount = 0;
    
    for (const fragment of fragmentModel.items) {
      if (!fragment.mesh) {
        console.warn('[Zoom] Fragment without mesh found');
        continue;
      }
      
      // expandByObject considera las transformaciones (matrices) del mesh
      // Esto es crucial para obtener el bounding box correcto en world space
      bbox.expandByObject(fragment.mesh);
      fragmentCount++;
    }

    if (bbox.isEmpty() || fragmentCount === 0) {
      console.warn('[Zoom] Bounding box is empty or no fragments found, cannot zoom');
      return;
    }
    
    // Calcular centro y tamaño del bounding box (ya en world space, sin necesidad de escalar)
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);
    
    // Obtener el tamaño máximo del modelo
    const maxSize = Math.max(size.x, size.y, size.z);
    
    // Acceder a la cámara Three.js subyacente para obtener FOV y aspect ratio
    const threeCamera = camera.three as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    if (!threeCamera) {
      console.warn('[Zoom] No Three.js camera found');
      return;
    }
    
    // Obtener FOV y aspect ratio de la cámara
    // Para PerspectiveCamera tiene fov, para OrthographicCamera usamos un valor por defecto
    const fov = (threeCamera as THREE.PerspectiveCamera).fov || 50;
    // Aspect ratio está disponible en ambas cámaras, pero TypeScript no lo reconoce en OrthographicCamera
    // Accedemos de forma segura
    const aspect = (threeCamera as any).aspect || 1; // Aspect por defecto si no está disponible
    
    // Calcular distancia basada en el tamaño del modelo y el FOV de la cámara
    // Esto asegura que el modelo completo sea visible en el viewport
    const fitHeightDistance = maxSize / (2 * Math.tan((Math.PI * fov) / 360));
    const fitWidthDistance = fitHeightDistance / aspect;
    const distance = 1.2 * Math.max(fitHeightDistance, fitWidthDistance);
    
    // Calcular posición de la cámara manteniendo la dirección de vista actual
    const currentPosition = new THREE.Vector3();
    const currentTarget = new THREE.Vector3();
    camera.controls.getPosition(currentPosition);
    camera.controls.getTarget(currentTarget);
    
    // Calcular dirección de vista y normalizarla
    const direction = new THREE.Vector3()
      .subVectors(currentPosition, currentTarget)
      .normalize();
    
    // Si la dirección es cero (cámara en el target), usar una dirección por defecto
    if (direction.length() < 0.001) {
      direction.set(1, 1, 1).normalize();
    }
    
    // Calcular nueva posición de la cámara
    const position = center.clone().add(direction.multiplyScalar(distance));
    
    try {
      // Aplicar el zoom con animación
      camera.controls.setLookAt(
        position.x, position.y, position.z,
        center.x, center.y, center.z,
        true // Animate
      );
      
      // Forzar actualización del aspect ratio de la cámara (si el método existe)
      if (typeof (camera as any).updateAspect === 'function') {
        (camera as any).updateAspect();
      }
    } catch (error) {
      console.error('[Zoom] Error updating camera position:', error);
    }
  }
} 