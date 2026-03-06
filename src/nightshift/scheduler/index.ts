import { DarwinScheduler } from "./darwin.js";
import type { BaseScheduler } from "./base.js";

export function createScheduler(): BaseScheduler {
  if (process.platform === "darwin") {
    return new DarwinScheduler();
  }
  throw new Error(
    `Unsupported platform: ${process.platform}. Currently only macOS is supported.`,
  );
}

export { BaseScheduler } from "./base.js";
export { shellEscape, sanitizeForComment } from "./shell.js";
