import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { getTools, getTool } from "../registry.js";

const PORT = parseInt(process.env.PORT ?? "3333", 10);
const API_KEY = process.env.MCP_API_KEY ?? "";

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) { next(); return; }
  const auth = req.headers.authorization ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (provided !== API_KEY) {
    res.status(401).json({ error: "API key invalide ou manquante" });
    return;
  }
  next();
}

function buildOpenApiSpec(baseUrl: string): object {
  const securityEntry = API_KEY ? [{ bearerAuth: [] }] : undefined;
  const paths: Record<string, unknown> = {};

  for (const tool of getTools()) {
    paths[`/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description,
        requestBody: {
          required: true,
          content: { "application/json": { schema: tool.inputSchema } },
        },
        responses: {
          "200": {
            description: "Résultat du tool",
            content: { "application/json": { schema: { type: "object", properties: { result: { type: "string" } } } } },
          },
          "400": { description: "Paramètres invalides" },
          "401": { description: "Authentification requise" },
          "500": { description: "Erreur interne" },
        },
        ...(securityEntry ? { security: securityEntry } : {}),
      },
    };
  }

  return {
    openapi: "3.0.0",
    info: {
      title: "Beacon MCP API",
      description: "Pont entre une IA et l'application Beacon — gestion de serveurs de jeu (Ark, Palworld, etc.)",
      version: "1.0.0",
    },
    servers: [{ url: baseUrl }],
    ...(API_KEY
      ? { components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Valeur de MCP_API_KEY" } } } }
      : {}),
    paths,
  };
}

export async function startHttpServer(mcpServer: McpServer): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", mode: "http" });
  });

  app.get("/openapi.json", (req, res) => {
    const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? `localhost:${PORT}`;
    res.json(buildOpenApiSpec(`${proto}://${host}`));
  });

  app.post("/tools/:toolName", requireApiKey, async (req, res) => {
    const toolName = String(req.params.toolName);
    const tool = getTool(toolName);

    if (!tool) {
      res.status(404).json({ error: `Tool inconnu : ${toolName}` });
      return;
    }

    try {
      const toolResult = await tool.handler(req.body ?? {});
      res.json({ result: toolResult.content.map((c) => c.text).join("\n") });
    } catch (err) {
      console.error(`Erreur tool ${toolName}:`, err);
      res.status(500).json({ error: String(err) });
    }
  });

  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/mcp/sse", requireApiKey, async (req, res) => {
    const transport = new SSEServerTransport("/mcp/messages", res);
    sseTransports.set(transport.sessionId, transport);

    res.on("close", () => sseTransports.delete(transport.sessionId));

    try {
      await mcpServer.connect(transport);
    } catch (err) {
      sseTransports.delete(transport.sessionId);
      throw err;
    }
  });

  app.post("/mcp/messages", requireApiKey, async (req, res) => {
    const raw = req.query.sessionId;
    const sessionId = Array.isArray(raw) ? String(raw[0]) : String(raw ?? "");
    const transport = sseTransports.get(sessionId);

    if (!transport) {
      res.status(404).json({ error: "Session SSE introuvable" });
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.error(`Beacon MCP HTTP server démarré sur le port ${PORT}`);
    console.error(`  OpenAPI spec : http://localhost:${PORT}/openapi.json`);
    console.error(`  SSE MCP      : http://localhost:${PORT}/mcp/sse`);
    console.error(`  Tools REST   : http://localhost:${PORT}/tools/<nom>`);
    if (!API_KEY) console.error("  ⚠️  Aucune MCP_API_KEY définie — serveur ouvert sans auth");
  });
}
