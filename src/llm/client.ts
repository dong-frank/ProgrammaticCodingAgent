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
        let completion: OpenAI.Chat.Completions.ChatCompletion;
        try {
            completion = await this.client.chat.completions.create({
                model: this.model,
                messages: toSdkMessages(request.messages),
                tools: request.tools,
                tool_choice: request.tools === undefined || request.tools.length === 0 ? undefined : "auto",
            });
        } catch (error) {
            if (error instanceof OpenAI.APIError) {
                throw new Error(`模型接口返回 ${error.status}: ${error.message}`);
            }
            throw error;
        } finally {
            this.apiDurationMs += Date.now() - startedAt;
        }

        const choice = completion.choices[0];
        if (choice === undefined) {
            throw new Error("模型接口响应缺少 choices 内容");
        }

        const message = choice.message;
        const toolCalls: ToolCall[] | undefined = message.tool_calls
            ?.filter(
                (call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
                    call.type === "function",
            )
            .map((call) => ({
                id: call.id,
                type: "function",
                function: {
                    name: call.function.name,
                    arguments: call.function.arguments,
                },
            }));

        const usage = completion.usage;
        return {
            message: {
                role: "assistant",
                content: message.content,
                tool_calls: toolCalls,
            },
            finishReason: choice.finish_reason ?? "",
            usage: {
                promptTokens: usage?.prompt_tokens ?? 0,
                completionTokens: usage?.completion_tokens ?? 0,
                totalTokens: usage?.total_tokens ?? 0,
            },
            model: completion.model,
        };
    }
}

function toSdkMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((message) => {
        switch (message.role) {
            case "system":
                return { role: "system", content: message.content ?? "" };
            case "user":
                return { role: "user", content: message.content ?? "" };
            case "assistant":
                return {
                    role: "assistant",
                    content: message.content,
                    tool_calls: message.tool_calls,
                };
            case "tool":
                return {
                    role: "tool",
                    tool_call_id: message.tool_call_id ?? "",
                    content: message.content ?? "",
                };
        }
    });
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