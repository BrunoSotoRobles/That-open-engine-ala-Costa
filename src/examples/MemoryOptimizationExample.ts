import * as OBC from "@thatopen/components";
import { MemoryOptimizationManager } from "../utils/MemoryOptimizationManager";
import { MemoryManager } from "../utils/MemoryManager";
import { DisposalManager } from "../utils/DisposalManager";
import { IFCLoaderOptimized } from "../utils/IFCLoaderOptimized";

/**
 * Example of how to use the Memory Optimization System
 */
export class MemoryOptimizationExample {
  private components: OBC.Components;
  private optimizationManager: MemoryOptimizationManager;
  private memoryManager: MemoryManager;
  private disposalManager: DisposalManager;
  private ifcLoaderOptimized: IFCLoaderOptimized;

  constructor(components: OBC.Components) {
    this.components = components;
    this.optimizationManager = components.get(MemoryOptimizationManager);
    this.memoryManager = components.get(MemoryManager);
    this.disposalManager = components.get(DisposalManager);
    this.ifcLoaderOptimized = components.get(IFCLoaderOptimized);
  }

  /**
   * Initialize the memory optimization system
   */
  async initialize(): Promise<void> {
    console.log('[MemoryOptimizationExample] Initializing memory optimization system...');

    // Configure the optimization system
    await this.optimizationManager.initialize({
      enableAutoMonitoring: true,
      monitoringInterval: 3000, // Check every 3 seconds
      enableAutoOptimization: true,
      enableProgressiveLoading: true,
      memoryThresholds: {
        critical: 0.75, // 75% memory usage triggers critical optimization
        warning: 0.5,   // 50% memory usage triggers warning
        optimal: 0.3    // 30% memory usage is considered optimal
      },
      loadingOptions: {
        chunkSize: 30,              // Process 30 fragments per chunk
        delayBetweenChunks: 50,     // 50ms delay between chunks
        enableMemoryCheck: true,    // Check memory before each chunk
        disposeOnMemoryCritical: true, // Dispose old models if memory is critical
        maxConcurrentChunks: 1      // Process one chunk at a time
      }
    });

    console.log('[MemoryOptimizationExample] Memory optimization system initialized');
  }

  /**
   * Example: Load IFC file with optimization
   */
  async loadIFCFileOptimized(file: File): Promise<any> {
    console.log('[MemoryOptimizationExample] Loading IFC file with optimization:', file.name);

    try {
      // Load file with progress tracking
      const model = await this.optimizationManager.loadIFCFileWithOptimization(
        file,
        (progress) => {
          console.log('[MemoryOptimizationExample] Loading progress:', {
            stage: progress.stage,
            percentage: progress.percentage.toFixed(1) + '%',
            message: progress.message
          });
        }
      );

      console.log('[MemoryOptimizationExample] IFC file loaded successfully');
      return model;

    } catch (error) {
      console.error('[MemoryOptimizationExample] Error loading IFC file:', error);
      throw error;
    }
  }

  /**
   * Example: Monitor memory usage
   */
  startMemoryMonitoring(): void {
    console.log('[MemoryOptimizationExample] Starting memory monitoring...');

    // Start monitoring
    this.optimizationManager.startAutoMonitoring(2000); // Check every 2 seconds

    // Log memory status periodically
    setInterval(() => {
      const status = this.optimizationManager.getMemoryStatus();
      const disposalStats = this.optimizationManager.getDisposalStats();

      console.log('[MemoryOptimizationExample] Memory Status:', {
        usagePercentage: status.usagePercentage.toFixed(1) + '%',
        isWarning: status.isWarning,
        isCritical: status.isCritical,
        disposedObjects: disposalStats.disposedObjects,
        fragmentCount: status.memoryInfo?.fragmentCount || 0,
        geometryCount: status.memoryInfo?.geometryCount || 0
      });

      // Show warnings
      if (status.isCritical) {
        console.warn('[MemoryOptimizationExample] ⚠️ CRITICAL memory usage detected!');
      } else if (status.isWarning) {
        console.warn('[MemoryOptimizationExample] ⚠️ High memory usage detected');
      }

    }, 5000); // Log every 5 seconds
  }

  /**
   * Example: Manual memory optimization
   */
  async performManualOptimization(): Promise<void> {
    console.log('[MemoryOptimizationExample] Performing manual memory optimization...');

    try {
      await this.optimizationManager.optimizeMemory();
      console.log('[MemoryOptimizationExample] Manual optimization completed');

    } catch (error) {
      console.error('[MemoryOptimizationExample] Error during manual optimization:', error);
      throw error;
    }
  }

  /**
   * Example: Emergency cleanup
   */
  async performEmergencyCleanup(): Promise<void> {
    console.log('[MemoryOptimizationExample] Performing emergency cleanup...');

    try {
      await this.optimizationManager.emergencyCleanup();
      console.log('[MemoryOptimizationExample] Emergency cleanup completed');

    } catch (error) {
      console.error('[MemoryOptimizationExample] Error during emergency cleanup:', error);
      throw error;
    }
  }

  /**
   * Example: Get system status
   */
  getSystemStatus(): void {
    const status = this.optimizationManager.getStatus();
    const memoryStatus = this.optimizationManager.getMemoryStatus();
    const disposalStats = this.optimizationManager.getDisposalStats();

    console.log('[MemoryOptimizationExample] System Status:', {
      optimizationEnabled: status.enabled,
      autoMonitoring: status.autoMonitoring,
      memoryManager: status.memoryManager,
      disposalManager: status.disposalManager,
      ifcLoaderOptimized: status.ifcLoaderOptimized,
      memoryUsage: memoryStatus.usagePercentage.toFixed(1) + '%',
      disposedObjects: disposalStats.disposedObjects
    });
  }

  /**
   * Example: Configure optimization settings
   */
  configureOptimization(): void {
    console.log('[MemoryOptimizationExample] Configuring optimization settings...');

    // Set more aggressive settings for large models
    this.optimizationManager.setConfig({
      memoryThresholds: {
        critical: 0.7,  // Lower threshold for critical
        warning: 0.45,  // Lower threshold for warning
        optimal: 0.25   // Lower threshold for optimal
      },
      loadingOptions: {
        chunkSize: 20,              // Smaller chunks
        delayBetweenChunks: 100,    // Longer delays
        maxConcurrentChunks: 1      // Single chunk processing
      }
    });

    console.log('[MemoryOptimizationExample] Optimization settings updated');
  }

  /**
   * Example: Stop monitoring
   */
  stopMonitoring(): void {
    console.log('[MemoryOptimizationExample] Stopping memory monitoring...');
    this.optimizationManager.stopAutoMonitoring();
  }

  /**
   * Example: Dispose optimization system
   */
  async dispose(): Promise<void> {
    console.log('[MemoryOptimizationExample] Disposing optimization system...');
    
    this.stopMonitoring();
    await this.optimizationManager.dispose();
    
    console.log('[MemoryOptimizationExample] Optimization system disposed');
  }
}

/**
 * Usage example:
 * 
 * ```typescript
 * // Initialize
 * const example = new MemoryOptimizationExample(components);
 * await example.initialize();
 * 
 * // Start monitoring
 * example.startMemoryMonitoring();
 * 
 * // Load IFC file with optimization
 * const file = // ... get IFC file
 * const model = await example.loadIFCFileOptimized(file);
 * 
 * // Manual optimization if needed
 * await example.performManualOptimization();
 * 
 * // Emergency cleanup if memory is critical
 * await example.performEmergencyCleanup();
 * 
 * // Get system status
 * example.getSystemStatus();
 * 
 * // Dispose when done
 * await example.dispose();
 * ```
 */
