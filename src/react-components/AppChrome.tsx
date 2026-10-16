import * as React from "react";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";
import { useTeamGateStore } from "../stores/TeamGateStore";
import { isTeamGateEnabled } from "../utils/costaTeamGate";
import { useTeamGateHydrated } from "../hooks/useTeamGateHydrated";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const hydrated = useTeamGateHydrated();
  const accessGranted = useTeamGateStore((s) => s.accessGranted);
  const gateOn = isTeamGateEnabled();

  const showNav = !gateOn || (hydrated && accessGranted);

  if (!showNav) {
    return <div className="app-landing-shell">{children}</div>;
  }

  return (
    <>
      <div className="app-layout">
        <Sidebar />
        <div className="app-layout__content" style={{ paddingBottom: "30px" }}>
          {children}
        </div>
      </div>
      <Footer />
    </>
  );
}
