import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "./tools/schemas.js";
import { handleNightshift } from "./nightshift/index.js";
import { handleFindings } from "./tools/findings.js";
import { closeDb } from "./db/index.js";

const server = new Server(
  { name: "boost", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

// ── Instructions injected into Claude's context ───────────────

const INSTRUCTIONS = `
You have access to Boost tools for overnight automation and findings management.

## boost_nightshift
Use this to schedule tasks that run automatically (e.g., nightly code reviews, security audits).
- Tasks run "claude -p" with the specified prompt
- Use worktree: { enabled: true } for tasks that modify code, so each run gets its own branch
- Use skipPermissions: true for fully unattended runs
- Always set a meaningful name and description

## boost_findings
Use this to record and recall findings from code analysis.
- Store bugs, security issues, and quality notes with severity levels
- Use "search" to find relevant past findings before starting analysis
- Update status to "fixed" when issues are resolved
`.trim();

// ── Tool handlers ─────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "boost_nightshift":
        result = await handleNightshift(args as unknown as Parameters<typeof handleNightshift>[0]);
        break;
      case "boost_findings":
        result = await handleFindings(args as unknown as Parameters<typeof handleFindings>[0]);
        break;
      default:
        return {
          content: [
            { type: "text" as const, text: `Unknown tool: ${name}` },
          ],
          isError: true,
        };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// ── Lifecycle ─────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  const cleanup = () => {
    closeDb();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error("Boost failed to start:", err);
  process.exit(1);
});
