"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
require("dotenv/config");
const auth_js_1 = require("./tools/auth.js");
const projects_js_1 = require("./tools/projects.js");
const gamedata_js_1 = require("./tools/gamedata.js");
const sentinel_js_1 = require("./tools/sentinel.js");
const connector_js_1 = require("./tools/connector.js");
const http_js_1 = require("./server/http.js");
const server = new mcp_js_1.McpServer({
    name: "beacon-mcp",
    version: "1.0.0",
});
// --- Enregistrement des tools ---
(0, auth_js_1.registerAuthTools)(server);
(0, projects_js_1.registerProjectTools)(server);
(0, gamedata_js_1.registerGameDataTools)(server);
(0, sentinel_js_1.registerSentinelTools)(server);
(0, connector_js_1.registerConnectorTools)(server);
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
