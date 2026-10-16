import { runLitteraValidation } from './LitteraValidationTool';

/**
 * Exposes validation function to browser console for manual testing
 * 
 * The validation UI is hidden from production, but the tool remains available
 * via browser console for testing and debugging.
 * 
 * Usage in browser console:
 * > window.validateLittera()
 * 
 * This runs validation against predefined test cases in:
 * - src/data/littera_validation_cases.json
 * 
 * Returns a detailed report with:
 * - Overall score
 * - Passed/failed cases
 * - Actual vs expected Littera codes
 * - Critical issues to address
 * 
 * Note: Validation is based on theoretical cases. Real IFC testing
 * should provide feedback for further refinement.
 */
export function exposeValidationToConsole() {
  if (typeof window !== 'undefined') {
    (window as any).validateLittera = async () => {
      console.log('🔍 Starting Littera validation...');
      try {
        const results = await runLitteraValidation();
        console.log('✅ Validation complete!');
        return results;
      } catch (error) {
        console.error('❌ Validation failed:', error);
        throw error;
      }
    };
    
    console.log('💡 Littera validation available via console: window.validateLittera()');
  }
}

