import * as React from "react";
import { useTeamGateStore } from "../stores/TeamGateStore";

/** Avoid flash of sidebar before sessionStorage rehydrates team access. */
export function useTeamGateHydrated(): boolean {
  const [hydrated, setHydrated] = React.useState(() =>
    useTeamGateStore.persist.hasHydrated()
  );

  React.useEffect(() => {
    if (useTeamGateStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useTeamGateStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  return hydrated;
}
