import * as OBC from "@thatopen/components";
import * as THREE from "three";
import { FragmentsGroup } from "@thatopen/fragments";

export interface DisposalOptions {
  disposeGeometries: boolean;
  disposeMaterials: boolean;
  disposeTextures: boolean;
  disposeLights: boolean;
  disposeCameras: boolean;
  disposeControls: boolean;
  clearScene: boolean;
}

export class DisposalManager extends OBC.Component {
  static uuid = "disposal-manager-001";
  
  enabled = true;
  private disposedObjects = new Set<THREE.Object3D>();

  constructor(components: OBC.Components) {
    super(components);
  }

  get(): DisposalManager {
    return this;
  }

  async dispose(): Promise<void> {
    this.enabled = false;
    this.disposedObjects.clear();
  }

  /**
   * Dispose a Three.js object and all its children
   */
  disposeObject(object: THREE.Object3D, options: Partial<DisposalOptions> = {}): void {
    if (!this.enabled || this.disposedObjects.has(object)) {
      return;
    }

    const defaultOptions: DisposalOptions = {
      disposeGeometries: true,
      disposeMaterials: true,
      disposeTextures: true,
      disposeLights: true,
      disposeCameras: true,
      disposeControls: true,
      clearScene: false
    };

    const finalOptions = { ...defaultOptions, ...options };

    this.disposeObjectRecursive(object, finalOptions);
    this.disposedObjects.add(object);
  }

  /**
   * Dispose a FragmentsGroup
   */
  disposeFragmentsGroup(group: FragmentsGroup, options: Partial<DisposalOptions> = {}): void {
    if (!this.enabled) return;

    console.log('[DisposalManager] Disposing FragmentsGroup:', group.name);

    // Dispose all fragments
    for (const fragment of group.items) {
      if (fragment.mesh) {
        this.disposeObject(fragment.mesh, options);
      }
    }

    // Clear the group
    group.items.length = 0;
  }

  /**
   * Dispose all objects in a scene
   */
  disposeScene(scene: THREE.Scene, options: Partial<DisposalOptions> = {}): void {
    if (!this.enabled) return;

    console.log('[DisposalManager] Disposing scene');

    const objectsToDispose: THREE.Object3D[] = [];
    scene.traverse((object) => {
      objectsToDispose.push(object);
    });

    for (const object of objectsToDispose) {
      this.disposeObject(object, options);
    }

    if (options.clearScene) {
      scene.clear();
    }
  }

  /**
   * Dispose all models in FragmentsManager
   */
  disposeAllModels(options: Partial<DisposalOptions> = {}): void {
    if (!this.enabled) return;

    const fragments = this.components.get(OBC.FragmentsManager);
    if (!fragments) return;

    console.log('[DisposalManager] Disposing all models');

    for (const [_, group] of fragments.groups) {
      this.disposeFragmentsGroup(group, options);
    }

    fragments.groups.clear();
  }

  /**
   * Dispose unused resources
   */
  disposeUnusedResources(): void {
    if (!this.enabled) return;

    console.log('[DisposalManager] Disposing unused resources');

    // Dispose unused geometries
    for (const geometry of Object.values(THREE.Cache.get('geometries') || {})) {
      if (geometry instanceof THREE.BufferGeometry) {
        geometry.dispose();
      }
    }

    // Dispose unused materials
    for (const material of Object.values(THREE.Cache.get('materials') || {})) {
      if (material instanceof THREE.Material) {
        material.dispose();
      }
    }

    // Dispose unused textures
    for (const texture of Object.values(THREE.Cache.get('textures') || {})) {
      if (texture instanceof THREE.Texture) {
        texture.dispose();
      }
    }

    // Clear caches
    THREE.Cache.clear();
  }

  /**
   * Recursive disposal of Three.js objects
   */
  private disposeObjectRecursive(object: THREE.Object3D, options: DisposalOptions): void {
    if (!object || this.disposedObjects.has(object)) {
      return;
    }

    // Dispose children first
    const children = [...object.children];
    for (const child of children) {
      this.disposeObjectRecursive(child, options);
    }

    // Dispose the object itself
    this.disposeSingleObject(object, options);
  }

  /**
   * Dispose a single Three.js object
   */
  private disposeSingleObject(object: THREE.Object3D, options: DisposalOptions): void {
    // Dispose Mesh
    if (object instanceof THREE.Mesh) {
      if (options.disposeGeometries && object.geometry) {
        object.geometry.dispose();
      }

      if (options.disposeMaterials && object.material) {
        if (Array.isArray(object.material)) {
          for (const material of object.material) {
            this.disposeMaterial(material, options);
          }
        } else {
          this.disposeMaterial(object.material, options);
        }
      }
    }

    // Dispose Light
    if (options.disposeLights && object instanceof THREE.Light) {
      if (object.shadow) {
        if (object.shadow.map) {
          object.shadow.map.dispose();
        }
        if (object.shadow.camera) {
          object.shadow.camera.dispose();
        }
      }
    }

    // Dispose Camera
    if (options.disposeCameras && object instanceof THREE.Camera) {
      // Cameras don't need explicit disposal in Three.js
    }

    // Dispose Controls
    if (options.disposeControls && (object as any).dispose) {
      try {
        (object as any).dispose();
      } catch (error) {
        // Ignore disposal errors
      }
    }

    // Remove from parent
    if (object.parent) {
      object.parent.remove(object);
    }
  }

  /**
   * Dispose a material and its textures
   */
  private disposeMaterial(material: THREE.Material, options: DisposalOptions): void {
    if (!material) return;

    if (options.disposeTextures) {
      // Dispose all textures used by the material
      const textureProperties = [
        'map', 'normalMap', 'roughnessMap', 'metalnessMap',
        'emissiveMap', 'aoMap', 'displacementMap', 'alphaMap',
        'envMap', 'lightMap', 'specularMap', 'bumpMap'
      ];

      for (const prop of textureProperties) {
        const texture = (material as any)[prop];
        if (texture instanceof THREE.Texture) {
          texture.dispose();
        }
      }
    }

    // Dispose the material
    material.dispose();
  }

  /**
   * Get disposal statistics
   */
  getDisposalStats(): { disposedObjects: number } {
    return {
      disposedObjects: this.disposedObjects.size
    };
  }

  /**
   * Check if an object has been disposed
   */
  isDisposed(object: THREE.Object3D): boolean {
    return this.disposedObjects.has(object);
  }

  /**
   * Clear disposal history
   */
  clearDisposalHistory(): void {
    this.disposedObjects.clear();
  }

  /**
   * Enable/disable disposal manager
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if disposal manager is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
