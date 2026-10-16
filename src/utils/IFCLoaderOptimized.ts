import * as OBC from "@thatopen/components";
import { FragmentsGroup } from "@thatopen/fragments";
import { MemoryManager } from "./MemoryManager";
import { DisposalManager } from "./DisposalManager";

export interface LoadingProgress {
  current: number;
  total: number;
  percentage: number;
  stage: 'parsing' | 'fragmenting' | 'processing' | 'complete';
  message: string;
}

export interface LoadingOptions {
  chunkSize: number; // Number of fragments to process per chunk
  delayBetweenChunks: number; // Delay in ms between chunks
  enableMemoryCheck: boolean; // Check memory before each chunk
  disposeOnMemoryCritical: boolean; // Dispose old models if memory is critical
  maxConcurrentChunks: number; // Maximum concurrent chunk processing
}

export class IFCLoaderOptimized extends OBC.Component {
  static uuid = "ifc-loader-optimized-001";
  
  enabled = true;
  private memoryManager: MemoryManager;
  private disposalManager: DisposalManager;
  private defaultOptions: LoadingOptions = {
    chunkSize: 50,
    delayBetweenChunks: 100,
    enableMemoryCheck: true,
    disposeOnMemoryCritical: true,
    maxConcurrentChunks: 2
  };

  constructor(components: OBC.Components) {
    super(components);
    this.memoryManager = components.get(MemoryManager);
    this.disposalManager = components.get(DisposalManager);
  }

  get(): IFCLoaderOptimized {
    return this;
  }

  async dispose(): Promise<void> {
    this.enabled = false;
  }

  /**
   * Load IFC file with optimized memory management
   */
  async loadIFCFile(
    file: File,
    options: Partial<LoadingOptions> = {},
    onProgress?: (progress: LoadingProgress) => void
  ): Promise<FragmentsGroup> {
    if (!this.enabled) {
      throw new Error('IFCLoaderOptimized is disabled');
    }

    const finalOptions = { ...this.defaultOptions, ...options };
    
    console.log('[IFCLoaderOptimized] Starting optimized IFC loading:', {
      fileName: file.name,
      fileSize: `${(file.size / 1024 / 1024).toFixed(2)}MB`,
      options: finalOptions
    });

    // Check memory before starting
    if (finalOptions.enableMemoryCheck && this.memoryManager) {
      if (this.memoryManager.isMemoryCritical()) {
        console.warn('[IFCLoaderOptimized] Memory is critical before loading, disposing old models');
        if (finalOptions.disposeOnMemoryCritical) {
          this.disposalManager.disposeAllModels();
        }
      }
    }

    try {
      // Parse IFC file
      const progress: LoadingProgress = {
        current: 0,
        total: 100,
        percentage: 0,
        stage: 'parsing',
        message: 'Parsing IFC file...'
      };

      onProgress?.(progress);

      const ifcLoader = this.components.get(OBC.IfcLoader);
      if (!ifcLoader) {
        throw new Error('IfcLoader component not found');
      }

      // Load the IFC file
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const model = await ifcLoader.load(uint8Array);
      
      progress.stage = 'fragmenting';
      progress.message = 'Processing fragments...';
      onProgress?.(progress);

      // Process fragments in chunks
      await this.processFragmentsInChunks(model, finalOptions, onProgress);

      progress.stage = 'complete';
      progress.percentage = 100;
      progress.message = 'Loading complete';
      onProgress?.(progress);

      console.log('[IFCLoaderOptimized] IFC loading completed successfully');
      return model;

    } catch (error) {
      console.error('[IFCLoaderOptimized] Error loading IFC file:', error);
      throw error;
    }
  }

  /**
   * Process fragments in chunks to optimize memory usage
   */
  private async processFragmentsInChunks(
    model: FragmentsGroup,
    options: LoadingOptions,
    onProgress?: (progress: LoadingProgress) => void
  ): Promise<void> {
    const fragments = model.items;
    const totalFragments = fragments.length;
    const chunks = this.createChunks(fragments, options.chunkSize);

    console.log(`[IFCLoaderOptimized] Processing ${totalFragments} fragments in ${chunks.length} chunks`);

    const progress: LoadingProgress = {
      current: 0,
      total: totalFragments,
      percentage: 0,
      stage: 'processing',
      message: 'Processing fragments...'
    };

    // Process chunks with concurrency control
    const semaphore = new Semaphore(options.maxConcurrentChunks);
    const promises: Promise<void>[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkIndex = i;

      const promise = semaphore.acquire().then(async () => {
        try {
          await this.processChunk(chunk, chunkIndex, chunks.length, options, onProgress);
        } finally {
          semaphore.release();
        }
      });

      promises.push(promise);

      // Add delay between chunk starts
      if (i < chunks.length - 1) {
        await this.delay(options.delayBetweenChunks);
      }
    }

    // Wait for all chunks to complete
    await Promise.all(promises);
  }

  /**
   * Process a single chunk of fragments
   */
  private async processChunk(
    chunk: any[],
    chunkIndex: number,
    totalChunks: number,
    options: LoadingOptions,
    onProgress?: (progress: LoadingProgress) => void
  ): Promise<void> {
    console.log(`[IFCLoaderOptimized] Processing chunk ${chunkIndex + 1}/${totalChunks} with ${chunk.length} fragments`);

    // Check memory before processing chunk
    if (options.enableMemoryCheck && this.memoryManager) {
      if (this.memoryManager.isMemoryCritical()) {
        console.warn('[IFCLoaderOptimized] Memory critical during chunk processing, applying optimizations');
        this.memoryManager.get().optimizeMemory();
      }
    }

    // Process each fragment in the chunk
    for (const fragment of chunk) {
      // Process fragment (this is where the actual processing happens)
      await this.processFragment(fragment);
    }

    // Update progress
    if (onProgress) {
      const progress: LoadingProgress = {
        current: (chunkIndex + 1) * chunk.length,
        total: chunk.length * totalChunks,
        percentage: ((chunkIndex + 1) / totalChunks) * 100,
        stage: 'processing',
        message: `Processed chunk ${chunkIndex + 1}/${totalChunks}`
      };
      onProgress(progress);
    }
  }

  /**
   * Process a single fragment
   */
  private async processFragment(fragment: any): Promise<void> {
    // This is where you would implement the actual fragment processing
    // For now, we'll just simulate some processing time
    await this.delay(10);
  }

  /**
   * Create chunks from an array
   */
  private createChunks<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Set default loading options
   */
  setDefaultOptions(options: Partial<LoadingOptions>): void {
    this.defaultOptions = { ...this.defaultOptions, ...options };
  }

  /**
   * Get current default options
   */
  getDefaultOptions(): LoadingOptions {
    return { ...this.defaultOptions };
  }

  /**
   * Enable/disable the loader
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if loader is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

/**
 * Simple semaphore implementation for concurrency control
 */
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const resolve = this.waitQueue.shift()!;
      resolve();
    } else {
      this.permits++;
    }
  }
}
