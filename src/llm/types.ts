export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatMessage {
    role: ChatRole;
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ChatUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

export interface ChatResult {
    message: ChatMessage;
    finishReason: string;
    usage: ChatUsage;
    model: string;
}