/** Shared team password for pilot / Netlify preview (embedded at build via VITE_*). */
export function isTeamGateEnabled(): boolean {
  if (import.meta.env.DEV) {
    return Boolean(import.meta.env.VITE_TEAM_GATE_PASSWORD?.trim());
  }
  return true;
}

export function isTeamPasswordConfigured(): boolean {
  return Boolean(import.meta.env.VITE_TEAM_GATE_PASSWORD?.trim());
}

export function verifyTeamGatePassword(input: string): boolean {
  const expected = import.meta.env.VITE_TEAM_GATE_PASSWORD?.trim() ?? "";
  if (!expected) return false;
  return input.trim() === expected;
}
