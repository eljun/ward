import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import type { WardPaths } from "./layout.ts";
import { ensureWardLayout, resolveWardPaths } from "./layout.ts";

export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function readDeviceToken(paths = resolveWardPaths()): Promise<string> {
  return (await readFile(paths.deviceKeyFile, "utf8")).trim();
}

export async function ensureDeviceToken(paths: WardPaths): Promise<string> {
  await ensureWardLayout(paths);
  try {
    const token = await readDeviceToken(paths);
    await chmod(paths.deviceKeyFile, 0o600);
    return token;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const token = generateDeviceToken();
  await writeFile(paths.deviceKeyFile, `${token}\n`, { mode: 0o600, flag: "wx" });
  await chmod(paths.deviceKeyFile, 0o600);
  return token;
}

export async function rotateDeviceToken(paths = resolveWardPaths()): Promise<string> {
  await ensureWardLayout(paths);
  const token = generateDeviceToken();
  await writeFile(paths.deviceKeyFile, `${token}\n`, { mode: 0o600 });
  await chmod(paths.deviceKeyFile, 0o600);
  return token;
}
