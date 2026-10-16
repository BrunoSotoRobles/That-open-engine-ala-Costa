import * as React from "react";
import * as Router from "react-router-dom";
import { useTeamGateStore } from "../stores/TeamGateStore";
import { isTeamGateEnabled } from "../utils/costaTeamGate";

export function RequireTeamAccess({ children }: { children: React.ReactNode }) {
  const accessGranted = useTeamGateStore((s) => s.accessGranted);

  if (!isTeamGateEnabled()) {
    return <>{children}</>;
  }

  if (!accessGranted) {
    return <Router.Navigate to="/" replace />;
  }

  return <>{children}</>;
}
