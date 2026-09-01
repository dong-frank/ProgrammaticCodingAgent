import OpenAI from "openai";
import type { ChatMessage, ChatResult, ToolCall, ToolSchema } from "./types.ts";

export interface LlmClientOptions {
    baseUrl: string;
    apiKey: string;
    model: string;
}

export interface ChatRequest {
    messages: ChatMessage[];
    tools?: ToolSchema[];
    signal?: AbortSignal;
}

const REQUEST_TIMEOUT_MS = 300_000;

export class LlmClient {
    private readonly client: OpenAI;
    private readonly model: string;
    private apiDurationMs = 0;

    constructor(options: LlmClientOptions) {
        this.model = options.model;
        this.client = new OpenAI({
            baseURL: options.baseUrl,
            apiKey: options.apiKey,
            timeout: REQUEST_TIMEOUT_MS,
            maxRetries: 0,
        });
    }

    getModelName(): string {
        return this.model;
    }

    getApiDurationMs(): number {
        return this.apiDurationMs;
    }

    async chat(request: ChatRequest): Promise<ChatResult> {
        const startedAt = Date.now();
        let response: OpenAI.Responses.Response;
        try {
            response = await this.client.responses.create({
                model: this.model,
                input: toResponseInput(request.messages),
                tools: request.tools?.map(toResponseTool),
                tool_choice: request.tools === undefined || request.tools.length === 0 ? undefined : "auto",
                reasoning: { effort: "medium", summary: "auto" },
            }, { signal: request.signal });
        } catch (error) {
            if (error instanceof OpenAI.APIError) {
                throw new Error(`模型接口返回 ${error.status}: ${error.message}`);
            }
            throw error;
        } finally {
            this.apiDurationMs += Date.now() - startedAt;
        }

        const toolCalls = response.output
            .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call")
            .map((call) => ({
                id: call.call_id,
                type: "function" as const,
                function: {
                    name: call.name,
                    arguments: call.arguments,
                },
            }));

        const content = response.output
            .filter((item): item is OpenAI.Responses.ResponseOutputMessage => item.type === "message")
            .flatMap((item) => item.content)
            .filter((part): part is OpenAI.Responses.ResponseOutputText => part.type === "output_text")
            .map((part) => part.text)
            .join("");
        const reasoningSummary = response.output
            .filter((item): item is OpenAI.Responses.ResponseReasoningItem => item.type === "reasoning")
            .flatMap((item) => [
                ...item.summary.map((part) => part.text),
                ...(item.content?.map((part) => part.text) ?? []),
            ])
            .join("");

        return {
            message: {
                role: "assistant",
                content: content.length === 0 ? null : content,
                tool_calls: toolCalls.length === 0 ? undefined : toolCalls,
                response_output_items: response.output,
            },
            reasoningSummary: reasoningSummary.length === 0 ? null : reasoningSummary,
            finishReason: response.status ?? "",
            usage: {
                promptTokens: response.usage?.input_tokens ?? 0,
                completionTokens: response.usage?.output_tokens ?? 0,
                totalTokens: response.usage?.total_tokens ?? 0,
            },
            model: response.model ?? this.model,
        };
    }
}

function toResponseInput(messages: ChatMessage[]): OpenAI.Responses.ResponseInput {
    return messages.flatMap((message) => {
        if (message.role === "assistant" && message.response_output_items !== undefined) {
            return message.response_output_items as OpenAI.Responses.ResponseInputItem[];
        }
        switch (message.role) {
            case "system":
                return [{ role: "system", content: message.content ?? "" }];
            case "user":
                return [{ role: "user", content: message.content ?? "" }];
            case "assistant":
                return [{ role: "assistant", content: message.content ?? "" }];
            case "tool":
                return [{
                    type: "function_call_output",
                    call_id: message.tool_call_id ?? "",
                    output: message.content ?? "",
                }];
        }
    });
}

function toResponseTool(tool: ToolSchema): OpenAI.Responses.FunctionTool {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: false,
    };
}

export function createLlmClientFromEnv(overrides?: { model?: string }): LlmClient {
    const baseUrl = process.env.PCA_BASE_URL;
    const apiKey = process.env.PCA_API_KEY;
    const model = overrides?.model ?? process.env.PCA_MODEL;

    const missing: string[] = [];
    if (baseUrl === undefined) {
        missing.push("PCA_BASE_URL");
    }
    if (apiKey === undefined) {
        missing.push("PCA_API_KEY");
    }
    if (model === undefined) {
        missing.push("PCA_MODEL");
    }
    if (missing.length > 0) {
        throw new Error(`缺少环境变量：${missing.join("、")}`);
    }

    return new LlmClient({ baseUrl: baseUrl!, apiKey: apiKey!, model: model! });
}
