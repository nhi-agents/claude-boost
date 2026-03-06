import type { NightshiftTask } from "../../types/index.js";

export abstract class BaseScheduler {
  abstract register(task: NightshiftTask): Promise<void>;
  abstract unregister(taskId: string): Promise<void>;
  abstract isRegistered(taskId: string): Promise<boolean>;
  abstract getStatus(taskId: string): Promise<{
    registered: boolean;
    healthy: boolean;
    details?: string;
  }>;
  abstract listRegistered(): Promise<string[]>;
}
