import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolDefinition, ToolResult, registerTool } from "../registry.js";

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function formatApiError(err: unknown, context?: "sentinel"): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const msg = (err.response?.data as Record<string, unknown>)?.message ?? err.message;
    if (context === "sentinel" && status === 403) {
      return "Accès refusé (403). Un token Sentinel valide est requis pour ce service.";
    }
    return `Erreur API (${status}): ${msg}`;
  }
  return String(err);
}

export const SUPPORTED_GAMES = ["ark", "arksa"] as const;
export type Game = (typeof SUPPORTED_GAMES)[number];

export function isValidGame(game: unknown): game is Game {
  return SUPPORTED_GAMES.includes(game as Game);
}

export function gameName(game: Game): string {
  return game === "ark" ? "ARK: Survival Evolved" : "ARK: Survival Ascended";
}

export function registerToolGroup(server: McpServer, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    registerTool(tool);
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.properties,
      (args) => tool.handler(args as Record<string, unknown>)
    );
  }
}
