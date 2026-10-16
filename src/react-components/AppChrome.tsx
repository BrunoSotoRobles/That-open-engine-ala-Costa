import * as React from "react";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";
import { useTeamGateStore } from "../stores/TeamGateStore";
import { isTeamGateEnabled } from "../utils/costaTeamGate";

export function AppChrome({ children }: { children: React.ReactNode }) {
  const accessGranted = useTeamGateStore((s) => s.accessGranted);
  const showNav = !isTeamGateEnabled() || accessGranted;

  return (
    <>
      <div className="app-layout">
        {showNav && <Sidebar />}
        <div
          style={{
            gridArea: "content",
            display: "flex",
            flexDirection: "column",
            minHeight: "100vh",
            minWidth: 0,
            paddingBottom: "30px",
          }}
        >
          {children}
        </div>
      </div>
      {showNav && <Footer />}
    </>
  );
}
