export interface ToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler: ToolHandler;
}

const tools = new Map<string, ToolDefinition>();
let cachedArray: ToolDefinition[] | null = null;

export function registerTool(def: ToolDefinition): void {
  tools.set(def.name, def);
  cachedArray = null;
}

export function getTools(): ToolDefinition[] {
  if (!cachedArray) cachedArray = Array.from(tools.values());
  return cachedArray;
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}
