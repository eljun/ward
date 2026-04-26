import { constants, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { WardPaths } from "./layout.ts";
import { resolveWardPaths } from "./layout.ts";

export type RuntimeState = {
  pid: number | null;
  port: number | null;
  running: boolean;
};

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") {
      return true;
    }
    return false;
  }
}

export function readPidFile(pidFile: string): number | null {
  if (!existsSync(pidFile)) {
    return null;
  }
  const raw = readFileSync(pidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function acquireInstanceLock(paths = resolveWardPaths()): { release: () => void } {
  const existingPid = readPidFile(paths.pidFile);
  if (existingPid && isProcessRunning(existingPid)) {
    throw new Error(`WARD runtime is already running with pid ${existingPid}`);
  }

  if (existingPid && !isProcessRunning(existingPid)) {
    unlinkSync(paths.pidFile);
  }

  let fd: number;
  try {
    fd = openSync(paths.pidFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const pid = readPidFile(paths.pidFile);
      throw new Error(pid ? `WARD runtime is already running with pid ${pid}` : "WARD runtime lock exists");
    }
    throw error;
  }

  writeFileSync(fd, `${process.pid}\n`, "utf8");
  closeSync(fd);

  return {
    release() {
      const pid = readPidFile(paths.pidFile);
      if (pid === process.pid) {
        unlinkSync(paths.pidFile);
      }
    }
  };
}

export async function writePort(paths: WardPaths, port: number): Promise<void> {
  await writeFile(paths.portFile, `${port}\n`, { mode: 0o600 });
}

export async function readPort(paths = resolveWardPaths()): Promise<number | null> {
  try {
    const raw = (await readFile(paths.portFile, "utf8")).trim();
    const port = Number(raw);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export async function readRuntimeState(paths = resolveWardPaths()): Promise<RuntimeState> {
  const pid = readPidFile(paths.pidFile);
  const port = await readPort(paths);
  return {
    pid,
    port,
    running: Boolean(pid && isProcessRunning(pid))
  };
}
