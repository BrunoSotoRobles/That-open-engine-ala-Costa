import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface TeamGateState {
  accessGranted: boolean;
  grantAccess: () => void;
  revokeAccess: () => void;
}

export const useTeamGateStore = create<TeamGateState>()(
  persist(
    (set) => ({
      accessGranted: false,
      grantAccess: () => set({ accessGranted: true }),
      revokeAccess: () => set({ accessGranted: false }),
    }),
    {
      name: "costa-team-gate",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ accessGranted: state.accessGranted }),
    }
  )
);
