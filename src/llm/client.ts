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

export interface SummaryResult {
    content: string;
    usage: ChatResult["usage"];
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
        const response = await this.createResponse({
            input: toResponseInput(request.messages),
            tools: request.tools?.map(toResponseTool),
            tool_choice: request.tools === undefined || request.tools.length === 0 ? undefined : "auto",
            reasoning: { effort: "medium", summary: "auto" },
        }, request.signal);
        return toChatResult(response, this.model);
    }

    async summarize(messages: ChatMessage[], signal?: AbortSignal): Promise<SummaryResult> {
        const response = await this.createResponse({
            input: [
                ...toResponseInput(messages),
                {
                    role: "user",
                    content: "请将以上历史交互压缩为简洁的编程任务摘要。保留任务目标、已修改文件、已完成操作、验证结果、失败尝试、未完成事项和重要约束。只输出摘要正文，不要添加其他说明。",
                },
            ],
            reasoning: { effort: "low", summary: "auto" },
        }, signal);
        const result = toChatResult(response, this.model);
        if (result.message.content === null || result.message.content.trim().length === 0) {
            throw new Error("历史上下文压缩未返回摘要内容");
        }
        return { content: result.message.content, usage: result.usage };
    }

    private async createResponse(
        request: OpenAI.Responses.ResponseCreateParamsNonStreaming,
        signal?: AbortSignal,
    ): Promise<OpenAI.Responses.Response> {
        const startedAt = Date.now();
        try {
            return await this.client.responses.create({ model: this.model, ...request }, { signal });
        } catch (error) {
            if (error instanceof OpenAI.APIError) {
                throw new Error(`模型接口返回 ${error.status}: ${error.message}`);
            }
            throw error;
        } finally {
            this.apiDurationMs += Date.now() - startedAt;
        }
    }
}

function toChatResult(response: OpenAI.Responses.Response, model: string): ChatResult {
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
        model: response.model ?? model,
    };
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
