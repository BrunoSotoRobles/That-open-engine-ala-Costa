/** Shared team password for pilot / Netlify preview (embedded at build via VITE_*). */
export function isTeamGateEnabled(): boolean {
  return Boolean(import.meta.env.VITE_TEAM_GATE_PASSWORD?.trim());
}

export function verifyTeamGatePassword(input: string): boolean {
  const expected = import.meta.env.VITE_TEAM_GATE_PASSWORD?.trim() ?? "";
  if (!expected) return true;
  return input.trim() === expected;
}
