/**
 * File Download Utilities
 * Handles file downloads in React environment
 */

export interface DownloadOptions {
  filename: string;
  mimeType?: string;
  encoding?: string;
}

/**
 * Download JSON data as a file
 */
export function downloadJSON(data: any, options: DownloadOptions): void {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { 
      type: options.mimeType || 'application/json' 
    });
    
    downloadBlob(blob, options.filename);
  } catch (error) {
    console.error('[FileDownload] Error downloading JSON:', error);
    throw new Error('Failed to download JSON file');
  }
}

/**
 * Download blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  try {
    // Create object URL
    const url = URL.createObjectURL(blob);
    
    // Create download link
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    
    // Add to DOM, click, and cleanup
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Cleanup object URL
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 100);
    
    console.log('[FileDownload] File downloaded successfully:', filename);
  } catch (error) {
    console.error('[FileDownload] Error downloading file:', error);
    throw new Error('Failed to download file');
  }
}

/**
 * Download text content as a file
 */
export function downloadText(content: string, options: DownloadOptions): void {
  try {
    const blob = new Blob([content], { 
      type: options.mimeType || 'text/plain' 
    });
    
    downloadBlob(blob, options.filename);
  } catch (error) {
    console.error('[FileDownload] Error downloading text:', error);
    throw new Error('Failed to download text file');
  }
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
}

/**
 * Validate filename
 */
export function validateFilename(filename: string): boolean {
  const invalidChars = /[<>:"/\\|?*]/;
  return !invalidChars.test(filename) && filename.length > 0;
}
