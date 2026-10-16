// Configuración de datos protegidos (no eliminables)
// Estos son los datos demo del sistema que no deben ser eliminados

export const PROTECTED_USER_IDS = [
  '1', // John Doe
  '2', // Jane Smith  
  '3', // Antonio Rodriguez
  '4', // Juan Carlos
  '5'  // Vishwajeet Kumar
];

export const PROTECTED_PROJECT_IDS = [
  'aedReHfEmmXLfQohxZve'  // Test, Test project (único proyecto visible en demo)
];

// IDs de proyectos que no se mostrarán en la fase actual
export const HIDDEN_PROJECT_IDS = [
  'H3gu8a8WGRck1BZ0PiLp', // Proyecto de oficina (oculto)
  'NP2MddybUjl0ldV7R4nx', // Proyecto de vivienda (oculto)
];

// Función para verificar si un usuario está protegido
export function isUserProtected(userId: string): boolean {
  return PROTECTED_USER_IDS.includes(userId);
}

// Función para verificar si un proyecto está protegido
export function isProjectProtected(projectId: string): boolean {
  return PROTECTED_PROJECT_IDS.includes(projectId);
}

// Función para obtener mensaje de error personalizado
export function getProtectionMessage(type: 'user' | 'project'): string {
  return `Este ${type === 'user' ? 'usuario' : 'proyecto'} no se puede eliminar (${type === 'user' ? 'usuario' : 'proyecto'} de demostración)`;
}
