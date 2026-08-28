import React, { useRef, useState } from "react";
import { Box, Text, Static, useApp, render } from "ink";
import TextInput from "ink-text-input";
import { runAgent, type AgentObserver, type AgentMetrics } from "../../agent/agent-loop.ts";
import { ContextManager } from "../../agent/context-manager.ts";
import { SessionStore, saveSession } from "../../session/store.ts";
import type { SessionRecord } from "../../session/types.ts";
import type { LlmClient } from "../../llm/client.ts";
import { isMode, MODES, type Mode } from "../../modes/types.ts";
import { formatArgs } from "../ui.ts";

export interface TuiAppOptions {
    maxRounds: number;
    model?: string;
    workspace: string;
}

interface AppProps {
    client: LlmClient;
    store: SessionStore;
    initialRecord: SessionRecord;
    initialContext: ContextManager;
    options: TuiAppOptions;
}

interface MessageEntry {
    id: number;
    kind: "user" | "model" | "event" | "tool" | "done" | "error" | "info";
    text: string;
}

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} 毫秒`;
    }
    return `${(ms / 1000).toFixed(1)} 秒`;
}

function metricsSummary(metrics: AgentMetrics): string {
    return `模型调用 ${metrics.llmCalls} 次 · 工具调用 ${metrics.toolCalls} 次 · 恢复 ${metrics.errorRecoveryEvents} 次 · token ${metrics.totalTokens} · 耗时 ${formatDuration(metrics.durationMs)}`;
}

const HELP_TEXT = [
    "可用命令",
    "/help          显示本帮助",
    "/sessions      列出已保存的会话",
    "/session <id>  切换并恢复指定会话",
    "/new           保存当前会话并开始新会话",
    "/mode          显示当前模式",
    "/mode tool     切换为 Tool Calling 模式",
    "/mode code     切换为 Code Mode",
    "/quit          保存并退出（等价 /exit）",
].join("\n");

function renderMessage(message: MessageEntry): React.ReactElement {
    switch (message.kind) {
        case "user":
            return <Text color="green">{message.text}</Text>;
        case "model":
            return <Text>{message.text}</Text>;
        case "event":
            return <Text color="cyan">{message.text}</Text>;
        case "tool":
            return <Text color="gray">{message.text}</Text>;
        case "done":
            return <Text color="green" bold>{message.text}</Text>;
        case "error":
            return <Text color="red">{message.text}</Text>;
        case "info":
            return <Text>{message.text}</Text>;
    }
}

export interface StartInteractiveParams {
    client: LlmClient;
    store: SessionStore;
    record: SessionRecord;
    context: ContextManager;
    maxRounds: number;
    model?: string;
    workspace: string;
}

export async function startInteractive(params: StartInteractiveParams): Promise<void> {
    const app = render(
        <App
            client={params.client}
            store={params.store}
            initialRecord={params.record}
            initialContext={params.context}
            options={{
                maxRounds: params.maxRounds,
                model: params.model,
                workspace: params.workspace,
            }}
        />,
    );
    await app.waitUntilExit();
}

export function App(props: AppProps): React.ReactElement {
    const { exit } = useApp();
    const { client, store, options } = props;

    const [recordId, setRecordId] = useState(props.initialRecord.id);
    const [mode, setMode] = useState<Mode>(props.initialRecord.mode);
    const [workspace, setWorkspace] = useState(props.initialRecord.workspace);
    const [messages, setMessages] = useState<MessageEntry[]>([]);
    const [input, setInput] = useState("");
    const [running, setRunning] = useState(false);

    const recordRef = useRef<SessionRecord>(props.initialRecord);
    const contextRef = useRef<ContextManager>(props.initialContext);
    const modeRef = useRef<Mode>(mode);
    const workspaceRef = useRef<string>(workspace);
    const messageId = useRef(0);
    const busyRef = useRef(false);
    const queueRef = useRef<string[]>([]);

    const push = (entry: Omit<MessageEntry, "id">): void => {
        messageId.current += 1;
        const id = messageId.current;
        setMessages((previous) => [...previous, { ...entry, id }]);
    };

    const saveCurrent = async (): Promise<void> => {
        await saveSession(store, recordRef.current, contextRef.current, {
            mode: modeRef.current,
            model: client.getModelName(),
            workspace: workspaceRef.current,
        });
    };

    const observer: AgentObserver = {
        onRoundStart(round, maxRounds) {
            push({ kind: "event", text: `[轮次 ${round}/${maxRounds}]` });
        },
        onModelText(content) {
            push({ kind: "model", text: content });
        },
        onToolCall(name, rawArguments) {
            push({ kind: "event", text: `→ 工具 ${name}(${formatArgs(rawArguments)})` });
        },
        onToolResult(content) {
            push({ kind: "tool", text: content });
        },
    };

    const runTask = async (taskText: string): Promise<void> => {
        busyRef.current = true;
        setRunning(true);
        push({ kind: "user", text: taskText });
        try {
            const result = await runAgent({
                task: taskText,
                mode: modeRef.current,
                maxRounds: options.maxRounds,
                workspace: workspaceRef.current,
                client,
                observer,
                context: contextRef.current,
            });
            if (result.stoppedReason === "completed") {
                push({ kind: "done", text: `${result.finalMessage}\n（${metricsSummary(result.metrics)}）` });
            } else {
                push({ kind: "error", text: `达到最大轮次未能完成任务（${metricsSummary(result.metrics)}）` });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            push({ kind: "error", text: `运行失败：${message}` });
        }
        setRunning(false);
        busyRef.current = false;
        const next = queueRef.current.shift();
        if (next !== undefined) {
            void runTask(next);
        }
    };

    const switchSession = async (loaded: SessionRecord): Promise<void> => {
        await saveCurrent();
        recordRef.current = loaded;
        contextRef.current = new ContextManager(loaded.messages);
        modeRef.current = loaded.mode;
        workspaceRef.current = loaded.workspace;
        setRecordId(loaded.id);
        setMode(loaded.mode);
        setWorkspace(loaded.workspace);
        push({ kind: "info", text: `已切换会话 ${loaded.id}（模式 ${loaded.mode}，工作目录 ${loaded.workspace}）` });
    };

    const handleCommand = async (raw: string): Promise<void> => {
        const [command, ...rest] = raw.split(/\s+/);
        const arg = rest.join(" ");
        switch (command) {
            case "/help":
                push({ kind: "info", text: `${HELP_TEXT}\n当前模式：${modeRef.current}` });
                break;
            case "/mode":
                if (arg.length === 0) {
                    push({ kind: "info", text: `当前模式：${modeRef.current}` });
                } else if (isMode(arg)) {
                    modeRef.current = arg;
                    recordRef.current.mode = arg;
                    setMode(arg);
                    push({ kind: "info", text: `模式已切换为 ${arg}` });
                } else {
                    push({ kind: "error", text: `无效模式：${arg}，有效值为 ${MODES.join(" 或 ")}` });
                }
                break;
            case "/sessions": {
                const records = await store.list();
                if (records.length === 0) {
                    push({ kind: "info", text: "暂无已保存的会话" });
                } else {
                    const lines = records.map((item) => {
                        const marker = item.id === recordRef.current.id ? " *" : "";
                        return `${item.id}${marker}（${item.mode}，消息 ${item.messages.length} 条，更新于 ${new Date(item.updatedAt).toLocaleString()}）\n  ${item.workspace}`;
                    });
                    push({ kind: "info", text: lines.join("\n") });
                }
                break;
            }
            case "/session":
                if (arg.length === 0) {
                    push({ kind: "error", text: "用法：/session <id>" });
                } else {
                    const loaded = await store.get(arg);
                    if (loaded === null) {
                        push({ kind: "error", text: `会话 ${arg} 不存在，/sessions 查看已有会话` });
                    } else {
                        await switchSession(loaded);
                    }
                }
                break;
            case "/new": {
                await saveCurrent();
                const fresh = store.createRecord({
                    workspace: options.workspace,
                    mode: modeRef.current,
                    model: client.getModelName(),
                });
                recordRef.current = fresh;
                contextRef.current = new ContextManager();
                modeRef.current = fresh.mode;
                workspaceRef.current = fresh.workspace;
                setRecordId(fresh.id);
                setMode(fresh.mode);
                setWorkspace(fresh.workspace);
                push({ kind: "info", text: `已开始新会话 ${fresh.id}` });
                break;
            }
            case "/quit":
            case "/exit":
                await saveCurrent();
                exit();
                break;
            default:
                push({ kind: "error", text: `未知命令 ${command}，输入 /help 查看可用命令` });
                break;
        }
    };

    const handleSubmit = (value: string): void => {
        const line = value.trim();
        setInput("");
        if (line.length === 0) {
            return;
        }
        if (line.startsWith("/")) {
            void handleCommand(line);
            return;
        }
        if (busyRef.current) {
            queueRef.current.push(line);
            return;
        }
        void runTask(line);
    };

    return (
        <Box flexDirection="column">
            <Text color="cyan" bold>
                programmatic-coding-agent v0.1.0
            </Text>
            <Static items={messages}>{renderMessage}</Static>
            <Box borderStyle="round" borderColor="cyan" paddingX={1}>
                <Box flexDirection="column" width="100%">
                    <Text color={running ? "yellow" : undefined}>{`${mode}> `}<TextInput value={input} onChange={setInput} onSubmit={handleSubmit} focus /></Text>
                    <Text color="gray">
                        模式 {mode} ｜ 会话 {recordId} ｜ 模型 {client.getModelName()} ｜ 工作目录 {workspace}
                    </Text>
                </Box>
            </Box>
        </Box>
    );
}