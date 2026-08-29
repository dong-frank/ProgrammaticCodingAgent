import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { executeAgentProgram } from "../src/executor/code-executor.ts";
import { runShellCommand } from "../src/tools/shell.ts";
import { loadTasks } from "../src/benchmark/task.ts";
import { prepareWorkspace } from "../src/benchmark/runner.ts";
import { CodeProgramSession } from "../src/executor/code-session.ts";
import { execCodeTool } from "../src/tools/exec-code.ts";
import { ContextManager } from "../src/agent/context-manager.ts";

const workspace = process.cwd();

test("Code Mode 允许 catch 变量直接用于日志输出", async () => {
    const outcome = await executeAgentProgram(
        'try { await readFile({ path: "missing-file.txt" }); } catch (error) { console.log(error.message); }',
        workspace,
    );

    assert.equal(outcome.status, "success");
    assert.match(outcome.stdout, /读取失败/);
});

test("Code Mode 报告 Shell 非零退出码", async () => {
    const outcome = await executeAgentProgram(
        'const result = await shell({ command: "node -e \\\"process.exit(7)\\\"" }); console.log(result.ok, result.exitCode);',
        workspace,
    );

    assert.equal(outcome.status, "command-error");
    assert.match(outcome.error ?? "", /退出码：7/);
    assert.match(outcome.stdout, /false 7/);
});

test("Shell 结果包含 ok 字段并保留退出码", async () => {
    const outcome = await runShellCommand("node -e \"process.exit(9)\"", workspace);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.exitCode, 9);
    assert.equal(outcome.timedOut, false);
});

test("Shell 命令超时时返回失败状态", async () => {
    const outcome = await runShellCommand("node -e \"setTimeout(() => {}, 1000)\"", workspace, 10);

    assert.equal(outcome.ok, false);
    assert.equal(outcome.timedOut, true);
    assert.equal(outcome.exitCode, 124);
});

test("Code Mode 将运行时异常标记为 runtime-error", async () => {
    const outcome = await executeAgentProgram("throw new Error('runtime failure');", workspace);

    assert.equal(outcome.status, "runtime-error");
    assert.equal(outcome.error, "runtime failure");
});

test("Code Mode 的 Glob 不允许访问工作目录父级", async () => {
    const outcome = await executeAgentProgram(
        'const files = await glob({ pattern: "../**/*" }); console.log(files);',
        workspace,
    );

    assert.equal(outcome.status, "runtime-error");
    assert.match(outcome.error ?? "", /匹配模式超出工作目录范围/);
});

test("空初始文件任务也会创建工作目录", async () => {
    const tasks = await loadTasks();
    const task = tasks.find((item) => item.id === "calculator-scaffold");
    assert.ok(task);

    const target = path.join(workspace, ".workspace", "test-execution", "calculator-scaffold", "code");
    const prepared = await prepareWorkspace(task, path.dirname(path.dirname(target)), "code");

    assert.equal(prepared, target);
});

test("Code Mode 在同一任务中增量维护唯一程序", async () => {
    const tool = execCodeTool(new CodeProgramSession());
    const context = { cwd: workspace };
    const created = await tool.execute({ action: "create", code: "console.log('v1');" }, context);
    assert.match(created.content, /程序版本：1/);

    const edited = await tool.execute(
        {
            action: "edit",
            baseRevision: 1,
            edits: [{ old_string: "v1", new_string: "v2" }],
        },
        context,
    );
    assert.match(edited.content, /程序版本：2/);

    const read = await tool.execute({ action: "read", startLine: 1, endLine: 1 }, context);
    assert.match(read.content, /console\.log\('v2'\)/);
});

test("模型上下文压缩 Code Mode 源码，完整轨迹保留原始内容", () => {
    const context = new ContextManager();
    context.append({
        role: "assistant",
        content: null,
        tool_calls: [
            {
                id: "call-1",
                type: "function",
                function: { name: "exec_code", arguments: '{"action":"create","code":"长程序源码"}' },
            },
        ],
    });
    context.append({ role: "tool", tool_call_id: "call-1", content: "程序版本：1\n程序状态：正常" });
    context.compactLastToolInteraction("exec_code", '{"action":"run"}', "程序版本：1\n程序状态：正常");

    assert.equal(context.getMessages()[0]?.tool_calls?.[0]?.function.arguments, '{"action":"run"}');
    assert.equal(context.getTranscript()[0]?.tool_calls?.[0]?.function.arguments, '{"action":"create","code":"长程序源码"}');
});
