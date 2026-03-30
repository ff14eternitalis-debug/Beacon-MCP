"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
require("dotenv/config");
const auth_js_1 = require("./tools/auth.js");
const http_js_1 = require("./server/http.js");
const server = new mcp_js_1.McpServer({
    name: "beacon-mcp",
    version: "1.0.0",
});
// --- Enregistrement des tools (commun aux deux modes) ---
(0, auth_js_1.registerAuthTools)(server);
// Phase 3+ : registerProjectTools(server), registerBlueprintTools(server), ...
// --- Sélection du mode de transport ---
const useHttp = process.argv.includes("--http");
async function main() {
    if (useHttp) {
        await (0, http_js_1.startHttpServer)(server);
    }
    else {
        const transport = new stdio_js_1.StdioServerTransport();
        await server.connect(transport);
        console.error("Beacon MCP server démarré (stdio)");
    }
}
main().catch((err) => {
    console.error("Erreur fatale :", err);
    process.exit(1);
});
