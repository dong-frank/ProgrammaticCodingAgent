export interface ToolContext {
    cwd: string;
    sessionId?: string;
    restrictToWorkspace?: boolean;
    signal?: AbortSignal;
}

export interface ToolResult {
    content: string;
    error?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
