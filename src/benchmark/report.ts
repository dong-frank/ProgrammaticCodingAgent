import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pc from "picocolors";
import { projectRoot } from "../paths.ts";
import type { BenchmarkRunResult } from "./runner.ts";

export function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} 毫秒`;
    }
    return `${(ms / 1000).toFixed(1)} 秒`;
}

function pickBetter(runs: BenchmarkRunResult[]): { mode: string; reason: string } | null {
    const succeeded = runs.filter((run) => run.success);
    if (succeeded.length === 0) {
        return null;
    }
    if (succeeded.length === 1) {
        const only = succeeded[0];
        if (only !== undefined) {
            return { mode: only.mode, reason: "另一模式未通过验收" };
        }
    }
    const sorted = [...succeeded].sort(
        (a, b) => a.llmCalls - b.llmCalls || a.totalTokens - b.totalTokens || a.durationMs - b.durationMs,
    );
    const best = sorted[0];
    const second = sorted[1];
    if (
        best !== undefined &&
        second !== undefined &&
        best.llmCalls === second.llmCalls &&
        best.totalTokens === second.totalTokens &&
        best.durationMs === second.durationMs
    ) {
        return null;
    }
    if (best === undefined) {
        return null;
    }
    return { mode: best.mode, reason: `模型调用 ${best.llmCalls} 次为最小` };
}

export function summarize(results: BenchmarkRunResult[]): string {
    const byTask = new Map<string, BenchmarkRunResult[]>();
    for (const result of results) {
        const bucket = byTask.get(result.taskId) ?? [];
        bucket.push(result);
        byTask.set(result.taskId, bucket);
    }

    const lines: string[] = [];
    for (const [taskId, runs] of [...byTask.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(pc.bold(taskId));
        for (const run of runs) {
            const status = run.success ? pc.green("成功") : pc.red("失败");
            lines.push(
                `  ${run.mode}: ${status} · 模型调用 ${run.llmCalls} 次 · 工具 ${run.toolCalls} 次 · 恢复 ${run.errorRecoveryEvents} 次 · token ${run.totalTokens} · 端到端 ${formatDuration(run.durationMs)} · 模型 API ${formatDuration(run.apiDurationMs)}`,
            );
        }
        const better = pickBetter(runs);
        if (better !== null) {
            lines.push(`  → ${better.mode} 更优：${better.reason}`);
        }
    }
    return lines.join("\n");
}

export async function saveResults(results: BenchmarkRunResult[], resultsDir?: string): Promise<string> {
    const dir = resultsDir ?? path.join(projectRoot(), "benchmark", "results");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `benchmark-${new Date().toISOString().replaceAll(":", "-")}.json`);
    await writeFile(file, JSON.stringify(results, null, 2), "utf8");
    return file;
}