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
      <div
        className={
          showNav ? "app-layout" : "app-layout app-layout--landing"
        }
      >
        {showNav && <Sidebar />}
        <div
          className="app-layout__content"
          style={{
            paddingBottom: showNav ? "30px" : 0,
          }}
        >
          {children}
        </div>
      </div>
      {showNav && <Footer />}
    </>
  );
}
