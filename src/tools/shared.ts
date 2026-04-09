import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolDefinition, ToolResult, registerTool } from "../registry.js";

export interface StandardToolPayload {
  ok: boolean;
  message: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: Record<string, unknown>;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; result: ToolResult };

function makePayload(payload: StandardToolPayload, isError = false): ToolResult {
  return {
    content: [{ type: "text", text: payload.message }],
    structuredContent: payload as unknown as Record<string, unknown>,
    isError,
  };
}

export function textResult(text: string, data?: unknown, meta?: Record<string, unknown>): ToolResult {
  return makePayload({ ok: true, message: text, data, meta });
}

export function errorResult(
  message: string,
  code = "unknown_error",
  details?: unknown,
  meta?: Record<string, unknown>
): ToolResult {
  return makePayload(
    {
      ok: false,
      message,
      error: { code, message, details },
      meta,
    },
    true
  );
}

export function invalidParams(message: string, details?: unknown): ToolResult {
  return errorResult(message, "validation_error", details);
}

export function requireString(
  args: Record<string, unknown>,
  key: string,
  label = key
): ValidationResult<string> {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      result: invalidParams(`Paramètre ${label} requis.`, { field: key, expected: "non-empty string" }),
    };
  }
  return { ok: true, value: value.trim() };
}

export function requireRawString(
  args: Record<string, unknown>,
  key: string,
  label = key
): ValidationResult<string> {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      result: invalidParams(`Paramètre ${label} requis.`, { field: key, expected: "non-empty string" }),
    };
  }
  return { ok: true, value };
}

export function optionalString(
  args: Record<string, unknown>,
  key: string
): ValidationResult<string | undefined> {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return {
      ok: false,
      result: invalidParams(`Paramètre ${key} invalide.`, { field: key, expected: "string" }),
    };
  }
  const trimmed = value.trim();
  return { ok: true, value: trimmed || undefined };
}

export function optionalNumber(
  args: Record<string, unknown>,
  key: string
): ValidationResult<number | undefined> {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    return {
      ok: false,
      result: invalidParams(`Paramètre ${key} invalide.`, { field: key, expected: "number" }),
    };
  }
  return { ok: true, value };
}

export function requireLiteralString<T extends readonly string[]>(
  args: Record<string, unknown>,
  key: string,
  values: T,
  label = key
): ValidationResult<T[number]> {
  const parsed = requireString(args, key, label);
  if (!parsed.ok) return parsed;
  if (!values.includes(parsed.value)) {
    return {
      ok: false,
      result: invalidParams(`Paramètre ${label} invalide. Valeurs acceptées : ${values.join(", ")}.`, {
        field: key,
        acceptedValues: values,
      }),
    };
  }
  return { ok: true, value: parsed.value as T[number] };
}

export function mapApiError(
  err: unknown,
  context?: "sentinel"
): { message: string; code: string; details?: unknown; meta?: Record<string, unknown> } {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    const data = err.response?.data;
    const apiMessage =
      (typeof data === "object" && data !== null && "message" in data
        ? String((data as Record<string, unknown>).message)
        : undefined) ?? err.message;

    if (context === "sentinel" && status === 403) {
      return {
        message: "Accès refusé (403). Un token Sentinel valide est requis pour ce service.",
        code: "sentinel_forbidden",
        details: data,
        meta: { status },
      };
    }

    if (status === 401) {
      return {
        message: "Authentification Beacon invalide ou expirée.",
        code: "auth_error",
        details: data,
        meta: { status },
      };
    }

    if (status === 403) {
      return {
        message: "Accès refusé par l'API Beacon.",
        code: "forbidden",
        details: data,
        meta: { status },
      };
    }

    if (status === 404) {
      return {
        message: "Ressource introuvable dans l'API Beacon.",
        code: "not_found",
        details: data,
        meta: { status },
      };
    }

    return {
      message: `Erreur API (${status ?? "?"}): ${apiMessage}`,
      code: "api_error",
      details: data ?? apiMessage,
      meta: { status },
    };
  }

  return {
    message: err instanceof Error ? err.message : String(err),
    code: "unknown_error",
  };
}

export function formatApiError(err: unknown, context?: "sentinel"): ToolResult {
  const mapped = mapApiError(err, context);
  return errorResult(mapped.message, mapped.code, mapped.details, mapped.meta);
}

export const SUPPORTED_GAMES = ["ark", "arksa", "palworld", "7dtd"] as const;
export type Game = (typeof SUPPORTED_GAMES)[number];

export function isValidGame(game: unknown): game is Game {
  return SUPPORTED_GAMES.includes(game as Game);
}

export function requireGame(
  args: Record<string, unknown>,
  key = "game",
  supportedGames: readonly Game[] = SUPPORTED_GAMES
): ValidationResult<Game> {
  return requireLiteralString(args, key, supportedGames, key);
}

export function gameName(game: Game): string {
  switch (game) {
    case "ark":
      return "ARK: Survival Evolved";
    case "arksa":
      return "ARK: Survival Ascended";
    case "palworld":
      return "Palworld";
    case "7dtd":
      return "7 Days to Die";
    default:
      return game;
  }
}

type JsonSchemaScalarProperty = {
  type?: "string" | "number" | "boolean";
  enum?: readonly string[];
  description?: string;
};

function buildZodPropertySchema(property: JsonSchemaScalarProperty) {
  const description = property.description;

  if (Array.isArray(property.enum) && property.enum.length > 0) {
    const [firstValue, ...restValues] = property.enum;
    let schema = z.enum([firstValue, ...restValues] as [string, ...string[]]);
    if (description) schema = schema.describe(description);
    return schema;
  }

  switch (property.type) {
    case "number": {
      let schema = z.number();
      if (description) schema = schema.describe(description);
      return schema;
    }
    case "boolean": {
      let schema = z.boolean();
      if (description) schema = schema.describe(description);
      return schema;
    }
    case "string":
    default: {
      let schema = z.string();
      if (description) schema = schema.describe(description);
      return schema;
    }
  }
}

function buildZodObjectSchema(tool: ToolDefinition): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const required = new Set(tool.inputSchema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [name, rawProperty] of Object.entries(tool.inputSchema.properties)) {
    const property = (rawProperty ?? {}) as JsonSchemaScalarProperty;
    const baseSchema = buildZodPropertySchema(property);
    shape[name] = required.has(name) ? baseSchema : baseSchema.optional();
  }

  return z.object(shape);
}

export function registerToolGroup(server: McpServer, tools: ToolDefinition[]): void {
  for (const tool of tools) {
    registerTool(tool);
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: buildZodObjectSchema(tool),
      },
      async (args) => {
        try {
          return await tool.handler(args as Record<string, unknown>);
        } catch (err) {
          return formatApiError(err);
        }
      }
    );
  }
}
