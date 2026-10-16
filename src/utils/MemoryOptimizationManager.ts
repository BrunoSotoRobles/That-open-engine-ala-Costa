import * as OBC from "@thatopen/components";
import { MemoryManager } from "./MemoryManager";
import { DisposalManager } from "./DisposalManager";
import { IFCLoaderOptimized } from "./IFCLoaderOptimized";

export interface OptimizationConfig {
  enableAutoMonitoring: boolean;
  monitoringInterval: number;
  enableAutoOptimization: boolean;
  enableProgressiveLoading: boolean;
  memoryThresholds: {
    critical: number;
    warning: number;
    optimal: number;
  };
  loadingOptions: {
    chunkSize: number;
    delayBetweenChunks: number;
    enableMemoryCheck: boolean;
    disposeOnMemoryCritical: boolean;
    maxConcurrentChunks: number;
  };
}

export class MemoryOptimizationManager extends OBC.Component {
  static uuid = "memory-optimization-manager-001";
  
  enabled = true;
  private memoryManager: MemoryManager;
  private disposalManager: DisposalManager;
  private ifcLoaderOptimized: IFCLoaderOptimized;
  
  private defaultConfig: OptimizationConfig = {
    enableAutoMonitoring: true,
    monitoringInterval: 5000,
    enableAutoOptimization: true,
    enableProgressiveLoading: true,
    memoryThresholds: {
      critical: 0.8,
      warning: 0.6,
      optimal: 0.4
    },
    loadingOptions: {
      chunkSize: 50,
      delayBetweenChunks: 100,
      enableMemoryCheck: true,
      disposeOnMemoryCritical: true,
      maxConcurrentChunks: 2
    }
  };

  constructor(components: OBC.Components) {
    super(components);
    this.memoryManager = components.get(MemoryManager);
    this.disposalManager = components.get(DisposalManager);
    this.ifcLoaderOptimized = components.get(IFCLoaderOptimized);
  }

  get(): MemoryOptimizationManager {
    return this;
  }

  async dispose(): Promise<void> {
    this.enabled = false;
    this.stopAutoMonitoring();
  }

  /**
   * Initialize the memory optimization system
   */
  async initialize(config: Partial<OptimizationConfig> = {}): Promise<void> {
    if (!this.enabled) return;

    const finalConfig = { ...this.defaultConfig, ...config };
    
    console.log('[MemoryOptimizationManager] Initializing memory optimization system:', finalConfig);

    try {
      // Configure memory manager
      if (this.memoryManager) {
        this.memoryManager.setThresholds(finalConfig.memoryThresholds);
      }

      // Configure IFC loader
      if (this.ifcLoaderOptimized) {
        this.ifcLoaderOptimized.setDefaultOptions(finalConfig.loadingOptions);
      }

      // Start auto monitoring if enabled
      if (finalConfig.enableAutoMonitoring) {
        this.startAutoMonitoring(finalConfig.monitoringInterval);
      }

      console.log('[MemoryOptimizationManager] Memory optimization system initialized successfully');

    } catch (error) {
      console.error('[MemoryOptimizationManager] Error initializing memory optimization system:', error);
      throw error;
    }
  }

  /**
   * Start automatic memory monitoring
   */
  startAutoMonitoring(intervalMs: number = 5000): void {
    if (!this.enabled || !this.memoryManager) return;

    console.log('[MemoryOptimizationManager] Starting auto monitoring');
    this.memoryManager.startMonitoring(intervalMs);
  }

  /**
   * Stop automatic memory monitoring
   */
  stopAutoMonitoring(): void {
    if (!this.memoryManager) return;

    console.log('[MemoryOptimizationManager] Stopping auto monitoring');
    this.memoryManager.stopMonitoring();
  }

  /**
   * Perform manual memory optimization
   */
  async optimizeMemory(): Promise<void> {
    if (!this.enabled) return;

    console.log('[MemoryOptimizationManager] Performing manual memory optimization');

    try {
      // Get current memory info
      const memoryInfo = this.memoryManager?.getMemoryInfo();
      console.log('[MemoryOptimizationManager] Memory before optimization:', memoryInfo);

      // Apply optimizations
      await this.applyOptimizations();

      // Get memory info after optimization
      const afterMemoryInfo = this.memoryManager?.getMemoryInfo();
      console.log('[MemoryOptimizationManager] Memory after optimization:', afterMemoryInfo);

    } catch (error) {
      console.error('[MemoryOptimizationManager] Error during memory optimization:', error);
      throw error;
    }
  }

  /**
   * Apply all available optimizations
   */
  private async applyOptimizations(): Promise<void> {
    const optimizations = [];

    // 1. Dispose unused resources
    if (this.disposalManager) {
      this.disposalManager.disposeUnusedResources();
      optimizations.push('Unused resources disposed');
    }

    // 2. Force garbage collection if available
    if ((window as any).gc) {
      (window as any).gc();
      optimizations.push('Garbage collection forced');
    }

    // 3. Clear Three.js caches
    if (typeof THREE !== 'undefined') {
      THREE.Cache.clear();
      optimizations.push('Three.js caches cleared');
    }

    console.log('[MemoryOptimizationManager] Applied optimizations:', optimizations);
  }

  /**
   * Load IFC file with optimization
   */
  async loadIFCFileWithOptimization(
    file: File,
    onProgress?: (progress: any) => void
  ): Promise<any> {
    if (!this.enabled || !this.ifcLoaderOptimized) {
      throw new Error('IFCLoaderOptimized not available');
    }

    console.log('[MemoryOptimizationManager] Loading IFC file with optimization:', file.name);

    // Check memory before loading
    if (this.memoryManager?.isMemoryCritical()) {
      console.warn('[MemoryOptimizationManager] Memory is critical, performing optimization before loading');
      await this.optimizeMemory();
    }

    // Load with optimized loader
    return this.ifcLoaderOptimized.loadIFCFile(file, {}, onProgress);
  }

  /**
   * Get current memory status
   */
  getMemoryStatus(): {
    isCritical: boolean;
    isWarning: boolean;
    usagePercentage: number;
    memoryInfo: any;
  } {
    if (!this.memoryManager) {
      return {
        isCritical: false,
        isWarning: false,
        usagePercentage: 0,
        memoryInfo: null
      };
    }

    const memoryInfo = this.memoryManager.getMemoryInfo();
    const usagePercentage = this.memoryManager.getMemoryUsagePercentage();
    const isCritical = this.memoryManager.isMemoryCritical();
    const thresholds = this.memoryManager.getThresholds();
    const isWarning = usagePercentage > thresholds.warning * 100;

    return {
      isCritical,
      isWarning,
      usagePercentage,
      memoryInfo
    };
  }

  /**
   * Get disposal statistics
   */
  getDisposalStats(): any {
    return this.disposalManager?.getDisposalStats() || { disposedObjects: 0 };
  }

  /**
   * Set optimization configuration
   */
  setConfig(config: Partial<OptimizationConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...config };
    
    // Apply new configuration to components
    if (this.memoryManager) {
      this.memoryManager.setThresholds(this.defaultConfig.memoryThresholds);
    }
    
    if (this.ifcLoaderOptimized) {
      this.ifcLoaderOptimized.setDefaultOptions(this.defaultConfig.loadingOptions);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OptimizationConfig {
    return { ...this.defaultConfig };
  }

  /**
   * Enable/disable the optimization manager
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    
    if (!enabled) {
      this.stopAutoMonitoring();
    }
  }

  /**
   * Check if optimization manager is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get optimization system status
   */
  getStatus(): {
    enabled: boolean;
    autoMonitoring: boolean;
    memoryManager: boolean;
    disposalManager: boolean;
    ifcLoaderOptimized: boolean;
  } {
    return {
      enabled: this.enabled,
      autoMonitoring: this.memoryManager?.isEnabled() || false,
      memoryManager: !!this.memoryManager,
      disposalManager: !!this.disposalManager,
      ifcLoaderOptimized: !!this.ifcLoaderOptimized
    };
  }

  /**
   * Emergency cleanup - dispose all models and clear memory
   */
  async emergencyCleanup(): Promise<void> {
    if (!this.enabled) return;

    console.warn('[MemoryOptimizationManager] Performing emergency cleanup');

    try {
      // Dispose all models
      if (this.disposalManager) {
        this.disposalManager.disposeAllModels({
          disposeGeometries: true,
          disposeMaterials: true,
          disposeTextures: true,
          clearScene: true
        });
      }

      // Force garbage collection
      if ((window as any).gc) {
        (window as any).gc();
      }

      // Clear all caches
      if (typeof THREE !== 'undefined') {
        THREE.Cache.clear();
      }

      console.log('[MemoryOptimizationManager] Emergency cleanup completed');

    } catch (error) {
      console.error('[MemoryOptimizationManager] Error during emergency cleanup:', error);
      throw error;
    }
  }
}
