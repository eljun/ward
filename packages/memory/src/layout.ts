import { mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type WardPaths = {
  home: string;
  runDir: string;
  authDir: string;
  logsDir: string;
  cacheDir: string;
  sessionsDir: string;
  secretsDir: string;
  attachmentsDir: string;
  pidFile: string;
  portFile: string;
  lockFile: string;
  deviceKeyFile: string;
  dbFile: string;
};

export function resolveRepoRoot(): string {
  return process.env.WARD_REPO_ROOT ?? resolve(import.meta.dir, "../../..");
}

export function resolveWardPaths(home = process.env.WARD_HOME ?? join(homedir(), ".ward")): WardPaths {
  return {
    home,
    runDir: join(home, "run"),
    authDir: join(home, "auth"),
    logsDir: join(home, "logs"),
    cacheDir: join(home, "cache"),
    sessionsDir: join(home, "sessions"),
    secretsDir: join(home, "secrets"),
    attachmentsDir: join(home, "attachments"),
    pidFile: join(home, "run", "ward.pid"),
    portFile: join(home, "run", "ward.port"),
    lockFile: join(home, "run", "ward.lock"),
    deviceKeyFile: join(home, "auth", "device.key"),
    dbFile: join(home, "ward.sqlite")
  };
}

export async function ensureWardLayout(paths = resolveWardPaths()): Promise<void> {
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await mkdir(paths.runDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.authDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.logsDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.cacheDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.sessionsDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
  await mkdir(paths.attachmentsDir, { recursive: true, mode: 0o700 });

  await Promise.allSettled([
    chmod(paths.home, 0o700),
    chmod(paths.runDir, 0o700),
    chmod(paths.authDir, 0o700),
    chmod(paths.secretsDir, 0o700)
  ]);
}
