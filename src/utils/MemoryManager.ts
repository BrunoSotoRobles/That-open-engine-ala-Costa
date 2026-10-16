import * as OBC from "@thatopen/components";
import * as THREE from "three";

export interface MemoryInfo {
  totalMemory: number;
  usedMemory: number;
  availableMemory: number;
  fragmentCount: number;
  geometryCount: number;
  textureCount: number;
  modelCount: number;
}

export interface MemoryThresholds {
  critical: number; // 80% of available memory
  warning: number;  // 60% of available memory
  optimal: number;  // 40% of available memory
}

export class MemoryManager extends OBC.Component {
  static uuid = "memory-manager-001";
  
  enabled = true;
  private monitoringInterval: number | null = null;
  private thresholds: MemoryThresholds = {
    critical: 0.8,
    warning: 0.6,
    optimal: 0.4
  };

  private fragments: OBC.FragmentsManager;
  private worlds: OBC.Worlds;

  constructor(components: OBC.Components) {
    super(components);
    this.fragments = components.get(OBC.FragmentsManager);
    this.worlds = components.get(OBC.Worlds);
  }

  get(): MemoryManager {
    return this;
  }

  async dispose(): Promise<void> {
    this.stopMonitoring();
    this.enabled = false;
  }

  /**
   * Start memory monitoring
   */
  startMonitoring(intervalMs: number = 5000): void {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    console.log('[MemoryManager] Memory monitoring started');
    
    this.monitoringInterval = window.setInterval(() => {
      if (this.enabled) {
        this.checkMemoryUsage();
      }
    }, intervalMs);
  }

  /**
   * Stop memory monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[MemoryManager] Memory monitoring stopped');
    }
  }

  /**
   * Get current memory information
   */
  getMemoryInfo(): MemoryInfo {
    const performance = (window as any).performance;
    const memory = performance?.memory;
    
    const fragmentCount = this.getFragmentCount();
    const geometryCount = this.getGeometryCount();
    const textureCount = this.getTextureCount();
    const modelCount = this.getModelCount();

    return {
      totalMemory: memory?.totalJSHeapSize || 0,
      usedMemory: memory?.usedJSHeapSize || 0,
      availableMemory: memory?.jsHeapSizeLimit || 0,
      fragmentCount,
      geometryCount,
      textureCount,
      modelCount
    };
  }

  /**
   * Check memory usage and trigger optimizations if needed
   */
  private checkMemoryUsage(): void {
    const memoryInfo = this.getMemoryInfo();
    const usagePercentage = this.getMemoryUsagePercentage(memoryInfo);

    console.log('[MemoryManager] Memory usage:', {
      percentage: `${usagePercentage.toFixed(1)}%`,
      used: `${(memoryInfo.usedMemory / 1024 / 1024).toFixed(1)}MB`,
      total: `${(memoryInfo.totalMemory / 1024 / 1024).toFixed(1)}MB`,
      fragments: memoryInfo.fragmentCount,
      geometries: memoryInfo.geometryCount
    });

    if (usagePercentage > this.thresholds.critical * 100) {
      console.warn('[MemoryManager] CRITICAL memory usage detected:', memoryInfo);
      this.optimizeMemory();
    } else if (usagePercentage > this.thresholds.warning * 100) {
      console.warn('[MemoryManager] WARNING memory usage detected:', memoryInfo);
      this.applyLightOptimizations();
    }
  }

  /**
   * Calculate memory usage percentage
   */
  private getMemoryUsagePercentage(memoryInfo: MemoryInfo): number {
    if (memoryInfo.availableMemory === 0) return 0;
    return (memoryInfo.usedMemory / memoryInfo.availableMemory) * 100;
  }

  /**
   * Get fragment count from all models
   */
  private getFragmentCount(): number {
    let count = 0;
    for (const [_, model] of this.fragments.groups) {
      count += model.items.length;
    }
    return count;
  }

  /**
   * Get geometry count from Three.js scene
   */
  private getGeometryCount(): number {
    let count = 0;
    for (const [_, world] of this.worlds.list) {
      if (world.scene?.three) {
        world.scene.three.traverse((object) => {
          if (object instanceof THREE.Mesh && object.geometry) {
            count++;
          }
        });
      }
    }
    return count;
  }

  /**
   * Get texture count from Three.js scene
   */
  private getTextureCount(): number {
    let count = 0;
    for (const [_, world] of this.worlds.list) {
      if (world.scene?.three) {
        world.scene.three.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            if (object.material) {
              if (Array.isArray(object.material)) {
                object.material.forEach(mat => {
                  if (mat.map) count++;
                  if (mat.normalMap) count++;
                  if (mat.roughnessMap) count++;
                });
              } else {
                if (object.material.map) count++;
                if (object.material.normalMap) count++;
                if (object.material.roughnessMap) count++;
              }
            }
          }
        });
      }
    }
    return count;
  }

  /**
   * Get model count
   */
  private getModelCount(): number {
    return this.fragments.groups.size;
  }

  /**
   * Apply light optimizations for warning level
   */
  private applyLightOptimizations(): void {
    console.log('[MemoryManager] Applying light optimizations...');
    
    // Force garbage collection if available
    if ((window as any).gc) {
      (window as any).gc();
    }

    // Clear texture cache
    THREE.Cache.clear();
  }

  /**
   * Apply aggressive optimizations for critical level
   */
  optimizeMemory(): void {
    console.log('[MemoryManager] Starting memory optimization...');
    
    const optimizations = [];

    // 1. Force garbage collection
    if ((window as any).gc) {
      (window as any).gc();
      optimizations.push('Garbage collection');
    }

    // 2. Clear texture cache
    THREE.Cache.clear();
    optimizations.push('Texture cache cleared');

    // 3. Dispose unused geometries
    this.disposeUnusedGeometries();
    optimizations.push('Unused geometries disposed');

    // 4. Optimize fragment culling
    this.optimizeFragmentCulling();
    optimizations.push('Fragment culling optimized');

    console.log('[MemoryManager] Memory optimization completed. Applied', optimizations.length, 'optimizations.');
    
    // Log memory after optimization
    const afterMemory = this.getMemoryInfo();
    console.log('[MemoryManager] Memory after optimization:', afterMemory);
  }

  /**
   * Dispose unused geometries
   */
  private disposeUnusedGeometries(): void {
    for (const [_, world] of this.worlds.list) {
      if (world.scene?.three) {
        const geometries = new Set<THREE.BufferGeometry>();
        
        // Collect all geometries in use
        world.scene.three.traverse((object) => {
          if (object instanceof THREE.Mesh && object.geometry) {
            geometries.add(object.geometry);
          }
        });

        // Dispose geometries not in use
        THREE.Cache.enabled = false;
        for (const geometry of geometries) {
          if (geometry.userData && geometry.userData.disposed) {
            geometry.dispose();
          }
        }
        THREE.Cache.enabled = true;
      }
    }
  }

  /**
   * Optimize fragment culling
   */
  private optimizeFragmentCulling(): void {
    const cullers = this.components.get(OBC.Cullers);
    if (cullers) {
      for (const [_, culler] of cullers.list) {
        culler.needsUpdate = true;
      }
    }
  }

  /**
   * Set memory thresholds
   */
  setThresholds(thresholds: Partial<MemoryThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Get current thresholds
   */
  getThresholds(): MemoryThresholds {
    return { ...this.thresholds };
  }

  /**
   * Check if memory usage is critical
   */
  isMemoryCritical(): boolean {
    const memoryInfo = this.getMemoryInfo();
    const usagePercentage = this.getMemoryUsagePercentage(memoryInfo);
    return usagePercentage > this.thresholds.critical * 100;
  }

  /**
   * Get memory usage percentage
   */
  getMemoryUsagePercentage(): number {
    const memoryInfo = this.getMemoryInfo();
    return this.getMemoryUsagePercentage(memoryInfo);
  }
}
