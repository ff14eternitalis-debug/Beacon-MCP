import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import "dotenv/config";

import { registerAuthTools } from "./tools/auth.js";
import { startHttpServer } from "./server/http.js";

const server = new McpServer({
  name: "beacon-mcp",
  version: "1.0.0",
});

// --- Enregistrement des tools (commun aux deux modes) ---
registerAuthTools(server);
// Phase 3+ : registerProjectTools(server), registerBlueprintTools(server), ...

// --- Sélection du mode de transport ---
const useHttp = process.argv.includes("--http");

async function main() {
  if (useHttp) {
    await startHttpServer(server);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Beacon MCP server démarré (stdio)");
  }
}

main().catch((err) => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
