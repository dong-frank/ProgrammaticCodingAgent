import type { ChatMessage } from "../llm/types.ts";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const MAX_HISTORY_MESSAGES = 200;
const TOOL_RESULT_ARCHIVE_CHARS = 4_000;

export class ContextManager {
    private readonly messages: ChatMessage[];
    private readonly transcript: ChatMessage[];

    constructor(initialMessages: ChatMessage[] = []) {
        this.messages = initialMessages.map(cloneMessage);
        this.transcript = initialMessages.map(cloneMessage);
    }

    append(message: ChatMessage): void {
        this.messages.push(cloneMessage(message));
        this.transcript.push(cloneMessage(message));
        if (this.messages.length > MAX_HISTORY_MESSAGES) {
            this.trim();
        }
    }

    updateSystemPrompt(content: string): void {
        const first = this.messages[0];
        if (first !== undefined && first.role === "system") {
            first.content = content;
            const transcriptFirst = this.transcript[0];
            if (transcriptFirst !== undefined && transcriptFirst.role === "system") {
                transcriptFirst.content = content;
            }
        } else {
            const systemMessage = { role: "system" as const, content };
            this.messages.unshift(cloneMessage(systemMessage));
            this.transcript.unshift(cloneMessage(systemMessage));
        }
    }

    getMessages(): ChatMessage[] {
        return this.messages;
    }

    getTranscript(): ChatMessage[] {
        return this.transcript;
    }

    async archiveLargeToolResults(): Promise<void> {
        const archiveDir = path.join(os.homedir(), ".pca", "context-archives");
        await mkdir(archiveDir, { recursive: true });
        let archiveIndex = 0;
        for (const message of this.messages) {
            if (message.role !== "tool" || message.content === null || message.content.length < TOOL_RESULT_ARCHIVE_CHARS) {
                continue;
            }
            if (message.content.startsWith("工具结果已归档：")) {
                continue;
            }
            archiveIndex += 1;
            const filename = `tool-result-${Date.now()}-${archiveIndex}.txt`;
            const archivePath = path.join(archiveDir, filename);
            await writeFile(archivePath, message.content, "utf8");
            message.content = `工具结果已归档：${archivePath}\n原始结果长度：${message.content.length} 字符`;
        }
    }

    replaceHistoryWithSummary(summary: string, keepRecentMessages = 12): void {
        const systemMessages = this.messages.filter((message) => message.role === "system");
        const nonSystemMessages = this.messages.filter((message) => message.role !== "system");
        let recentStart = Math.max(0, nonSystemMessages.length - keepRecentMessages);
        while (recentStart > 0 && nonSystemMessages[recentStart]?.role === "tool") {
            recentStart -= 1;
        }
        const recentMessages = nonSystemMessages.slice(recentStart).map(cloneMessage);
        const summaryMessage: ChatMessage = {
            role: "user",
            content: `历史上下文摘要（早期交互已归档）：\n${summary}`,
        };
        this.messages.splice(0, this.messages.length, ...systemMessages.map(cloneMessage), summaryMessage, ...recentMessages);
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

function cloneMessage(message: ChatMessage): ChatMessage {
    return {
        ...message,
        tool_calls: message.tool_calls?.map((call) => ({
            ...call,
            function: { ...call.function },
        })),
        response_output_items: message.response_output_items === undefined
            ? undefined
            : structuredClone(message.response_output_items),
    };
}
