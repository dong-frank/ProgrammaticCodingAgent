import type { ChatMessage } from "../llm/types.ts";

export const MAX_HISTORY_MESSAGES = 200;

export class ContextManager {
    private readonly messages: ChatMessage[] = [];

    constructor(systemPrompt: string) {
        this.messages.push({ role: "system", content: systemPrompt });
    }

    append(message: ChatMessage): void {
        this.messages.push(message);
        if (this.messages.length > MAX_HISTORY_MESSAGES) {
            this.trim();
        }
    }

    getMessages(): ChatMessage[] {
        return this.messages;
    }

    private trim(): void {
        // 保留 system 消息，从最早的非 system 消息开始裁剪，并清除悬空的工具调用对
        while (this.messages.length > MAX_HISTORY_MESSAGES) {
            const index = this.messages.findIndex((message) => message.role !== "system");
            if (index === -1) {
                break;
            }
            this.messages.splice(index, 1);
        }
        this.removeDanglingToolCalls();
    }

    private removeDanglingToolCalls(): void {
        // 工具结果消息必须紧跟对应的 assistant 工具调用消息
        for (let i = 0; i < this.messages.length; i += 1) {
            const message = this.messages[i];
            if (message === undefined) {
                continue;
            }
            if (message.role === "tool") {
                const previous = this.messages[i - 1];
                if (previous === undefined || previous.role !== "assistant" || previous.tool_calls === undefined) {
                    this.messages.splice(i, 1);
                    i -= 1;
                }
            }
        }
    }
}