import type { NightshiftInput } from "../types/index.js";
import {
  handleAdd,
  handleRun,
  handleList,
  handleRemove,
  handleStatus,
  handleHistory,
  handleLogs,
} from "./actions/index.js";

export async function handleNightshift(input: NightshiftInput) {
  switch (input.action) {
    case "add":
      return handleAdd(input);
    case "run":
      return handleRun(input);
    case "list":
      return handleList(input);
    case "remove":
      return handleRemove(input);
    case "status":
      return handleStatus(input);
    case "history":
      return handleHistory(input);
    case "logs":
      return handleLogs(input);
    default:
      return {
        success: false,
        error: `Unknown action: ${(input as { action: string }).action}`,
      };
  }
}
