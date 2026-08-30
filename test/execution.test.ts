import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { executeAgentProgram } from "../src/executor/code-executor.ts";
import { runShellCommand } from "../src/tools/shell.ts";
import { loadTasks } from "../src/benchmark/task.ts";
import { prepareWorkspace } from "../src/benchmark/runner.ts";
import { execCodeTool } from "../src/tools/exec-code.ts";

const workspace = process.cwd();

test("Code Mode 允许 catch 变量直接用于日志输出", async () => {
    const outcome = await executeAgentProgram(
        'try { await tools.readFile({ path: "missing-file.txt" }); } catch (error) { console.log(error.message); }',
        workspace,
    );

    assert.equal(outcome.status, "success");
    assert.match(outcome.stdout, /读取失败/);
});

test("Code Mode 报告 Shell 非零退出码", async () => {
    const outcome = await executeAgentProgram(
        'const result = await tools.shell({ command: "node -e \\\"process.exit(7)\\\"" }); console.log(result.ok, result.exitCode);',
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

test("Code Mode 收到中止信号后终止 Worker", async () => {
    const controller = new AbortController();
    const execution = executeAgentProgram("await new Promise(() => {});", workspace, true, controller.signal);
    controller.abort();
    const outcome = await execution;

    assert.equal(outcome.status, "timeout");
    assert.match(outcome.error ?? "", /已中止/);
});

test("Code Mode 拒绝模块导入并返回明确诊断", async () => {
    const outcome = await executeAgentProgram('const module = await import("./src/csv.js"); return module;', workspace);

    assert.equal(outcome.status, "validation-error");
    assert.match(outcome.error ?? "", /不支持动态 import/);
});

test("Code Mode 的 Glob 不允许访问工作目录父级", async () => {
    const outcome = await executeAgentProgram(
        'const files = await tools.glob({ pattern: "../**/*" }); console.log(files);',
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

test("Code Mode 每次调用都执行传入的完整程序", async () => {
    const tool = execCodeTool();
    const context = { cwd: workspace };
    const result = await tool.execute({ code: "console.log('v1');" }, context);

    assert.equal(result.error, undefined);
    assert.match(result.content, /v1/);
});

test("Code Mode 每次调用之间不保留程序状态", async () => {
    const tool = execCodeTool();
    const context = { cwd: workspace };
    await tool.execute({ code: "console.log('current');" }, context);
    const result = await tool.execute(
        { code: "console.log('next');" },
        context,
    );

    assert.equal(result.error, undefined);
    assert.match(result.content, /next/);
    assert.doesNotMatch(result.content, /current/);
});
