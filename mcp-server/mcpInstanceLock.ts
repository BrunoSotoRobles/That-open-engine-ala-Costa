/**
 * Costa MCP bridge role: one primary (WebSocket :8081) + N secondaries (stdio relay).
 * Lock file: %LOCALAPPDATA%\CostaMCP\costa-mcp.instance.json
 */
import fs from "fs";
import os from "os";
import path from "path";

export type CostaMcpLockInfo = {
  pid: number;
  port: number;
  startedAt: number;
};

export type BridgeRole = "primary" | "secondary";

export function getCostaMcpLockPath(): string {
  const base =
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CostaMCP")
      : path.join(os.homedir(), ".costa-mcp");
  return path.join(base, "costa-mcp.instance.json");
}

export function readCostaMcpLock(): CostaMcpLockInfo | null {
  const lockPath = getCostaMcpLockPath();
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, "utf8")) as Partial<CostaMcpLockInfo>;
    const pid = Number(raw.pid);
    const port = Number(raw.port);
    const startedAt = Number(raw.startedAt);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    return {
      pid,
      port: Number.isFinite(port) ? port : 8081,
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
    };
  } catch {
    return null;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeLockIfOwnedBy(pid: number): void {
  const lockPath = getCostaMcpLockPath();
  if (!fs.existsSync(lockPath)) return;
  try {
    const current = readCostaMcpLock();
    if (current?.pid === pid) fs.unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

export function releaseCostaMcpInstanceLock(): void {
  removeLockIfOwnedBy(process.pid);
}

function clearStaleLock(log: (msg: string) => void): void {
  const lockPath = getCostaMcpLockPath();
  if (!fs.existsSync(lockPath)) return;
  const info = readCostaMcpLock();
  if (!info) {
    try {
      fs.unlinkSync(lockPath);
      log("[Costa MCP] Removed unreadable instance lock.");
    } catch {
      /* ignore */
    }
    return;
  }
  if (!isPidAlive(info.pid)) {
    try {
      fs.unlinkSync(lockPath);
      log(`[Costa MCP] Removed stale instance lock (pid ${info.pid} is gone).`);
    } catch {
      /* ignore */
    }
  }
}

/** Primary holds lock + WebSocket; secondaries relay to primary (never exit). */
export function resolveBridgeRole(options: { port: number; log: (msg: string) => void }): BridgeRole {
  const lockPath = getCostaMcpLockPath();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  clearStaleLock(options.log);

  const existing = readCostaMcpLock();
  if (existing && existing.pid !== process.pid && isPidAlive(existing.pid)) {
    options.log(
      `[Costa MCP] Bridge secondary pid=${process.pid} (primary pid ${existing.pid} port ${existing.port})`
    );
    return "secondary";
  }

  const payload: CostaMcpLockInfo = {
    pid: process.pid,
    port: options.port,
    startedAt: Date.now(),
  };

  try {
    const fd = fs.openSync(lockPath, "wx");
    try {
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), { encoding: "utf8" });
    } finally {
      fs.closeSync(fd);
    }
    options.log(`[Costa MCP] Bridge primary pid=${process.pid} port=${options.port}`);
    return "primary";
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "EEXIST") {
      const holder = readCostaMcpLock();
      if (holder && holder.pid !== process.pid && isPidAlive(holder.pid)) {
        options.log(
          `[Costa MCP] Bridge secondary pid=${process.pid} (primary pid ${holder.pid} after race)`
        );
        return "secondary";
      }
      clearStaleLock(options.log);
      return resolveBridgeRole(options);
    }
    options.log(`[Costa MCP] Instance lock error: ${String(error)} — running as secondary`);
    return "secondary";
  }
}
