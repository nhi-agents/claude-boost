import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

export interface BoostConfig {
  nightshift: {
    defaultTimeout: number;
    defaultTimezone: string;
    worktree: {
      branchPrefix: string;
      remoteName: string;
    };
    logDir: string;
  };
  hooks: {
    autoApprove: string[]; // tool patterns to auto-approve
  };
  dashboard: {
    port: number;
  };
}

const CONFIG_PATH =
  process.env.BOOST_CONFIG ??
  `${process.env.HOME}/.claude/boost/config.json`;

const DEFAULTS: BoostConfig = {
  nightshift: {
    defaultTimeout: 300,
    defaultTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    worktree: {
      branchPrefix: "boost/",
      remoteName: "origin",
    },
    logDir: `${process.env.HOME}/.claude/boost/logs`,
  },
  hooks: {
    autoApprove: [
      "Read",
      "Glob",
      "Grep",
      "Agent",
      "WebFetch",
    ],
  },
  dashboard: {
    port: 4455,
  },
};

let _config: BoostConfig | null = null;

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (
      val &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

export function getConfig(): BoostConfig {
  if (_config) return _config;

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    _config = deepMerge(
      DEFAULTS as unknown as Record<string, unknown>,
      JSON.parse(raw) as Record<string, unknown>,
    ) as unknown as BoostConfig;
  } catch {
    _config = { ...DEFAULTS };
  }
  return _config;
}

export function saveConfig(config: BoostConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  _config = config;
}
