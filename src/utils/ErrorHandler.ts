/**
 * Centralized error handling with detailed error information and recovery suggestions
 */

export enum ErrorType {
  CSV_LOAD_ERROR = 'CSV_LOAD_ERROR',
  CSV_PARSE_ERROR = 'CSV_PARSE_ERROR',
  CSV_VALIDATION_ERROR = 'CSV_VALIDATION_ERROR',
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  MAPPING_NOT_FOUND = 'MAPPING_NOT_FOUND',
  INVALID_ELEMENT = 'INVALID_ELEMENT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONSTRUCTION_METHOD_ERROR = 'CONSTRUCTION_METHOD_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export interface DetailedError {
  type: ErrorType;
  message: string;
  context?: Record<string, any>;
  suggestions?: string[];
  recoverable: boolean;
  originalError?: Error;
}

export class ErrorHandler {
  /**
   * Handle and categorize an error with detailed information
   */
  static handle(error: unknown, context?: Record<string, any>): DetailedError {
    // Handle Error instances
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();

      // CSV parsing errors
      if (errorMessage.includes('csv') || errorMessage.includes('parse') || errorMessage.includes('validation')) {
        return {
          type: ErrorType.CSV_PARSE_ERROR,
          message: `Error parsing CSV file: ${error.message}`,
          context: { ...context, originalError: error.message },
          suggestions: [
            'Check CSV file format and encoding (should be UTF-8)',
            'Verify all rows have the correct number of columns (14 columns expected)',
            'Check for unclosed quotes in text fields',
            'Verify CSV file is not corrupted'
          ],
          recoverable: true,
          originalError: error
        };
      }

      // Network/fetch errors
      if (errorMessage.includes('fetch') || 
          errorMessage.includes('network') || 
          errorMessage.includes('failed to fetch') ||
          errorMessage.includes('load')) {
        return {
          type: ErrorType.NETWORK_ERROR,
          message: `Network error loading file: ${error.message}`,
          context: { ...context, originalError: error.message },
          suggestions: [
            'Check if the file path is correct',
            'Verify the file is accessible from the current location',
            'Check network connectivity',
            'Verify CORS settings if loading from different domain'
          ],
          recoverable: true,
          originalError: error
        };
      }

      // Template not found errors
      if (errorMessage.includes('template') && 
          (errorMessage.includes('not found') || errorMessage.includes('missing'))) {
        return {
          type: ErrorType.TEMPLATE_NOT_FOUND,
          message: `Template not found: ${error.message}`,
          context: { ...context, originalError: error.message },
          suggestions: [
            'Check if the element has a valid TALO code',
            'Verify the construction method is correctly detected',
            'Consider adding a new template for this element type',
            'Check if the Nimikkeistö code exists in the template database'
          ],
          recoverable: true,
          originalError: error
        };
      }

      // Mapping not found errors
      if (errorMessage.includes('mapping') && 
          (errorMessage.includes('not found') || errorMessage.includes('missing'))) {
        return {
          type: ErrorType.MAPPING_NOT_FOUND,
          message: `Mapping not found: ${error.message}`,
          context: { ...context, originalError: error.message },
          suggestions: [
            'Verify the TALO code is correct',
            'Check if the mapping database is loaded',
            'Verify the element name matches expected patterns'
          ],
          recoverable: true,
          originalError: error
        };
      }

      // Invalid element errors
      if (errorMessage.includes('invalid element') || errorMessage.includes('element')) {
        return {
          type: ErrorType.INVALID_ELEMENT,
          message: `Invalid element: ${error.message}`,
          context: { ...context, originalError: error.message },
          suggestions: [
            'Verify the element has required properties (name, type, taloCode)',
            'Check if the element type is supported',
            'Verify baseQuantities are available'
          ],
          recoverable: false,
          originalError: error
        };
      }

      // Construction method errors
      if (errorMessage.includes('construction method') || errorMessage.includes('method')) {
        return {
          type: ErrorType.CONSTRUCTION_METHOD_ERROR,
          message: `Construction method error: ${error.message}`,
          context: { ...context, originalError: error.message },
          suggestions: [
            'Check element name for construction method keywords',
            'Verify the construction method detector is working correctly',
            'Consider adding more keywords to the detection logic'
          ],
          recoverable: true,
          originalError: error
        };
      }
    }

    // Unknown error type
    return {
      type: ErrorType.UNKNOWN_ERROR,
      message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      context: { ...context, error },
      suggestions: [
        'Check browser console for more details',
        'Try refreshing the page',
        'Verify all required data files are loaded',
        'Contact support if the problem persists'
      ],
      recoverable: false,
      originalError: error instanceof Error ? error : new Error(String(error))
    };
  }

  /**
   * Log a detailed error using structured logging
   */
  static log(detailedError: DetailedError): void {
    const logLevel = detailedError.recoverable ? 'warn' : 'error';
    const logContext: Record<string, any> = {
      type: detailedError.type,
      message: detailedError.message,
      recoverable: detailedError.recoverable
    };

    if (detailedError.context) {
      logContext.context = detailedError.context;
    }

    if (detailedError.suggestions) {
      logContext.suggestions = detailedError.suggestions;
    }

    if (detailedError.originalError) {
      logContext.originalError = detailedError.originalError.message;
    }

    console[logLevel](`[ErrorHandler] ${detailedError.type}:`, logContext);
  }

  /**
   * Handle and log an error in one call
   */
  static handleAndLog(error: unknown, context?: Record<string, any>): DetailedError {
    const detailedError = this.handle(error, context);
    this.log(detailedError);
    return detailedError;
  }

  /**
   * Create a custom detailed error
   */
  static create(
    type: ErrorType,
    message: string,
    options?: {
      context?: Record<string, any>;
      suggestions?: string[];
      recoverable?: boolean;
      originalError?: Error;
    }
  ): DetailedError {
    return {
      type,
      message,
      context: options?.context,
      suggestions: options?.suggestions,
      recoverable: options?.recoverable ?? true,
      originalError: options?.originalError
    };
  }
}

