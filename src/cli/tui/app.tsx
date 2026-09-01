import React, { useEffect, useRef, useState } from "react";
import { inspect } from "node:util";
import { Box, Text, useApp, useInput, useStdout, render } from "ink";
import TextInput from "ink-text-input";
import { marked } from "marked";
import TerminalRenderer from "marked-terminal";
import { runAgent, type AgentObserver, type AgentMetrics } from "../../agent/agent-loop.ts";
import { ContextManager } from "../../agent/context-manager.ts";
import { SessionStore, saveSession } from "../../session/store.ts";
import type { SessionRecord } from "../../session/types.ts";
import type { LlmClient } from "../../llm/client.ts";
import type { Mode } from "../../modes/types.ts";
import { formatArgs } from "../ui.ts";
import { MODEL_CONTEXT_WINDOW } from "../../llm/types.ts";

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
    kind: "user" | "model" | "reasoning" | "event" | "tool-call" | "tool-result" | "done" | "error" | "info";
    text: string;
}

const TYPEWRITER_DELAY_MS = 12;

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} 毫秒`;
    }
    return `${(ms / 1000).toFixed(1)} 秒`;
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? (error.message || "未知错误");
    }
    if (typeof error === "string") {
        return error.length > 0 ? error : "未知错误";
    }
    return inspect(error, { depth: null, colors: false });
}

function metricsSummary(metrics: AgentMetrics): string {
    return `模型调用 ${metrics.llmCalls} 次 · 工具调用 ${metrics.toolCalls} 次 · 恢复 ${metrics.errorRecoveryEvents} 次 · token ${metrics.totalTokens} · 耗时 ${formatDuration(metrics.durationMs)}`;
}

function contextIndicator(inputTokens: number): string {
    const ratio = Math.min(1, Math.max(0, inputTokens / MODEL_CONTEXT_WINDOW));
    const ring = ["○", "◔", "◑", "◕", "●"][Math.min(4, Math.floor(ratio * 5))];
    return `${ring} 上下文 ${(ratio * 100).toFixed(1)}%`;
}

const HELP_TEXT = [
    "programmatic-coding-agent 是一个本地编程智能体。",
    "它通过 Responses API 理解编程任务，并在当前工作目录中读取、修改文件和执行命令。",
    "项目提供 code 与 tool 两种模式：code 模式通过 exec_code 执行程序，tool 模式逐次调用本地工具。",
    "",
    "可用命令",
    "/help          显示本帮助",
    "/sessions      列出已保存的会话",
    "/session <id>  切换并恢复指定会话",
    "/new           保存当前会话并开始新会话",
    "/mode          在 code 与 tool 模式之间切换",
    "/exit          保存并退出",
].join("\n");

const COMMAND_SUGGESTIONS = [
    { command: "/help", description: "显示帮助" },
    { command: "/sessions", description: "列出已保存的会话" },
    { command: "/session", description: "切换并恢复指定会话" },
    { command: "/new", description: "保存当前会话并开始新会话" },
    { command: "/mode", description: "在 code 与 tool 模式之间切换" },
    { command: "/exit", description: "保存并退出" },
];

function renderMessage(message: MessageEntry, width: number): React.ReactElement {
    const lines = message.text.split("\n");
    const body = (prefix: string): string => lines.map((line, index) => `${index === 0 ? prefix : "  " + line}`).join("\n");
    switch (message.kind) {
        case "user":
            return <Text color="green"><Text bold>❯ </Text>{message.text}</Text>;
        case "model":
            return (
                <Box width={width} flexDirection="column">
                    <Box marginLeft={2}>
                        <Text>{renderMarkdown(message.text, width)}</Text>
                    </Box>
                </Box>
            );
        case "reasoning":
            return <Text color="gray" italic>{message.text}</Text>;
        case "event":
            return <Text color="cyan">{message.text}</Text>;
        case "tool-call":
            return (
                <Box width={width} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
                    <Text color="yellow" bold>工具调用</Text>
                    <Text color="yellow">{message.text.trim().length === 0 ? "（无参数）" : message.text}</Text>
                </Box>
            );
        case "tool-result":
            return (
                <Box width={width} borderStyle="round" borderColor="gray" paddingX={1} flexDirection="column">
                    <Text color="gray" bold>工具结果</Text>
                    <Text color="gray">{message.text.trim().length === 0 ? "（无结果）" : message.text}</Text>
                </Box>
            );
        case "done":
            return <></>;
        case "error":
            return <Text color="red">{body("✘ ")}</Text>;
        case "info":
            return <Text color="gray">{body("  ")}</Text>;
    }
}

function renderMarkdown(content: string, width: number): string {
    const output = marked.parse(content, {
        renderer: new TerminalRenderer({ width: Math.max(20, width - 2) }),
    });
    if (typeof output !== "string") {
        throw new Error("Markdown 渲染返回了异步结果");
    }
    return output.trim();
}

function renderStreamingText(text: string, kind: "model" | "reasoning"): React.ReactElement {
    const prefix = "";
    const lines = text.split("\n").map((line, index) => `${index === 0 ? prefix : "  " + line}`).join("\n");
    return <Text color={kind === "reasoning" ? "gray" : undefined} italic={kind === "reasoning"}>{lines}<Text color="gray">▌</Text></Text>;
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

const PREVIEW_MESSAGES: MessageEntry[] = [
    { id: 1, kind: "user", text: "修复 src/math.py 中 add 函数的实现" },
    { id: 2, kind: "reasoning", text: "先读取目标文件，确认当前实现和需要修改的位置。" },
    { id: 3, kind: "tool-call", text: 'read_file(path: "src/math.py")' },
    { id: 4, kind: "tool-result", text: "def add(a, b):\n    return a * b" },
    { id: 5, kind: "reasoning", text: "函数返回了乘积，需要改为返回两个参数的和。" },
    { id: 6, kind: "tool-call", text: 'edit_file(path: "src/math.py", old_string: "return a * b", new_string: "return a + b")' },
    { id: 7, kind: "tool-result", text: "文件修改成功" },
    { id: 8, kind: "model", text: "已修复 add 函数，并完成文件验证。" },
    { id: 9, kind: "done", text: "任务已完成" },
];

export function PreviewApp(): React.ReactElement {
    const { stdout } = useStdout();
    const [messages, setMessages] = useState<MessageEntry[]>([]);
    const [input, setInput] = useState("");
    const contentWidth = Math.max(40, (stdout.columns ?? 80) - 2);
    const contextTokens = Math.min(MODEL_CONTEXT_WINDOW, messages.length * 7_200);

    useEffect(() => {
        let cancelled = false;
        const replay = async (): Promise<void> => {
            for (const message of PREVIEW_MESSAGES) {
                await new Promise<void>((resolve) => setTimeout(resolve, 650));
                if (cancelled) {
                    return;
                }
                setMessages((previous) => [...previous, message]);
            }
        };
        void replay();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <Box flexDirection="column">
            <Box flexDirection="column" marginBottom={1}>
                <Text color="cyan" bold>programmatic-coding-agent</Text>
                <Text color="gray">界面预览 · code 模式 · 不会调用模型</Text>
            </Box>
            {messages.map((message) => (
                <React.Fragment key={message.id}>{renderMessage(message, contentWidth)}</React.Fragment>
            ))}
            <Box marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
                <Box>
                    <Text color="green" bold>❯ </Text>
                    <TextInput value={input} onChange={setInput} onSubmit={() => setInput("")} focus />
                </Box>
                <Text color="gray">code · preview · {messages.length === PREVIEW_MESSAGES.length ? "演示完成" : "正在演示执行链路"}</Text>
                <Text color="gray">{contextIndicator(contextTokens)}</Text>
                <Text color="gray">模型调用 2 次 · 工具调用 2 次 · 恢复 0 次 · token 1,248 · 耗时 3.2 秒</Text>
                <Text color="gray">按 Ctrl+C 退出预览</Text>
            </Box>
            <Text color="gray">{`预览进度 ${messages.length}/${PREVIEW_MESSAGES.length} · 按 Ctrl+C 退出`}</Text>
        </Box>
    );
}

export async function startPreview(): Promise<void> {
    const app = render(<PreviewApp />);
    await app.waitUntilExit();
}

export function App(props: AppProps): React.ReactElement {
    const { exit } = useApp();
    const { stdout } = useStdout();
    const { client, store, options } = props;
    const contentWidth = Math.max(40, (stdout.columns ?? 80) - 2);

    const [recordId, setRecordId] = useState(props.initialRecord.id);
    const [mode, setMode] = useState<Mode>(props.initialRecord.mode);
    const [workspace, setWorkspace] = useState(props.initialRecord.workspace);
    const [messages, setMessages] = useState<MessageEntry[]>([]);
    const [input, setInput] = useState("");
    const [running, setRunning] = useState(false);
    const [streamingText, setStreamingText] = useState<string | null>(null);
    const [streamingKind, setStreamingKind] = useState<"model" | "reasoning">("model");
    const [contextTokens, setContextTokens] = useState(0);
    const [lastMetrics, setLastMetrics] = useState<AgentMetrics | null>(null);
    const [selectedCommand, setSelectedCommand] = useState(0);

    const commandQuery = input.trim().split(/\s+/)[0] ?? "";
    const commandSuggestions = input.startsWith("/") && !/\s/.test(input)
        ? COMMAND_SUGGESTIONS.filter((item) => item.command.startsWith(commandQuery))
        : [];

    useEffect(() => {
        setSelectedCommand(0);
    }, [input]);

    useInput((_input, key) => {
        if (commandSuggestions.length === 0) {
            return;
        }
        if (key.upArrow) {
            setSelectedCommand((current) => (current - 1 + commandSuggestions.length) % commandSuggestions.length);
        } else if (key.downArrow) {
            setSelectedCommand((current) => (current + 1) % commandSuggestions.length);
        } else if (key.tab) {
            const selected = commandSuggestions[selectedCommand];
            if (selected !== undefined) {
                setInput(`${selected.command} `);
            }
        }
    });

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
        async onReasoningSummary(content) {
            setStreamingKind("reasoning");
            setStreamingText("");
            for (const character of Array.from(content)) {
                setStreamingText((previous) => `${previous ?? ""}${character}`);
                await new Promise<void>((resolve) => setTimeout(resolve, TYPEWRITER_DELAY_MS));
            }
            setStreamingText(null);
            push({ kind: "reasoning", text: content });
        },
        onContextUsage(inputTokens) {
            setContextTokens(inputTokens);
        },
        async onModelText(content) {
            setStreamingKind("model");
            setStreamingText("");
            for (const character of Array.from(content)) {
                setStreamingText((previous) => `${previous ?? ""}${character}`);
                await new Promise<void>((resolve) => setTimeout(resolve, TYPEWRITER_DELAY_MS));
            }
            setStreamingText(null);
            push({ kind: "model", text: content });
        },
        onToolCall(name, rawArguments) {
            push({ kind: "tool-call", text: `${name}(${formatArgs(rawArguments)})` });
        },
        onToolResult(content) {
            push({ kind: "tool-result", text: content });
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
            setLastMetrics(result.metrics);
            if (result.stoppedReason === "completed") {
                push({ kind: "done", text: result.finalMessage });
            } else {
                push({ kind: "error", text: "达到最大轮次未能完成任务" });
            }
        } catch (error) {
            push({ kind: "error", text: `运行失败：\n${formatError(error)}` });
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
                    const nextMode = modeRef.current === "code" ? "tool" : "code";
                    modeRef.current = nextMode;
                    recordRef.current.mode = nextMode;
                    setMode(nextMode);
                    push({ kind: "info", text: `模式已切换为 ${nextMode}` });
                } else {
                    push({ kind: "error", text: "用法：/mode（不需要参数）" });
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
            <Box flexDirection="column" marginBottom={1}>
                <Text color="cyan" bold>programmatic-coding-agent</Text>
            </Box>
            {messages
                .filter((message) => !(streamingText !== null && message.kind === streamingKind && message.text === streamingText))
                .map((message) => (
                <React.Fragment key={message.id}>{renderMessage(message, contentWidth)}</React.Fragment>
                ))}
            {streamingText !== null && (
                renderStreamingText(streamingText, streamingKind)
            )}
            <Box marginTop={1} borderStyle="round" borderColor={running ? "yellow" : "cyan"} paddingX={1} flexDirection="column">
                {commandSuggestions.length > 0 && (
                    <Box flexDirection="column" marginBottom={1}>
                        {commandSuggestions.map((item, index) => (
                            <Text key={item.command} color={index === selectedCommand ? "cyan" : "gray"} bold={index === selectedCommand}>
                                {`${index === selectedCommand ? "›" : " "} ${item.command.padEnd(12)} ${item.description}`}
                            </Text>
                        ))}
                    </Box>
                )}
                <Box>
                    <Text color={running ? "yellow" : "green"} bold>{running ? "✳" : "❯"} </Text>
                    <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} focus />
                </Box>
                <Box flexDirection="column" width="100%">
                    <Text color="gray">{`模式 ${mode} · ${running ? "正在处理" : "就绪"}`}</Text>
                    <Text color="gray">{`模型 ${client.getModelName()} · 会话 ${recordId}`}</Text>
                    <Text color="gray">{`工作目录 ${workspace}`}</Text>
                    {lastMetrics !== null && <Text color="gray">{metricsSummary(lastMetrics)}</Text>}
                    <Text color="gray">{contextIndicator(contextTokens)}</Text>
                </Box>
            </Box>
        </Box>
    );
}
