import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../paths.ts";

export interface BenchmarkTask {
    id: string;
    name: string;
    description: string;
    files: Record<string, string>;
    verifyCommand: string;
    timeoutMs: number;
    maxRounds: number;
    verifyPath: string;
}

interface TaskFileContents {
    id: string;
    name: string;
    description: string;
    files: Record<string, string>;
    verifyCommand: string;
    timeoutMs: number;
    maxRounds: number;
}

export async function loadTasks(tasksDir?: string): Promise<BenchmarkTask[]> {
    const root = tasksDir ?? path.join(projectRoot(), "benchmark", "tasks");
    let entries: string[];
    try {
        entries = await readdir(root);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法读取任务目录 ${root}：${message}`);
    }

    const tasks: BenchmarkTask[] = [];
    for (const entry of entries) {
        const dir = path.join(root, entry);
        const entryStat = await stat(dir);
        if (!entryStat.isDirectory()) {
            continue;
        }
        const taskFile = path.join(dir, "task.json");
        let raw: string;
        try {
            raw = await readFile(taskFile, "utf8");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`任务 ${entry} 缺少有效的 task.json：${message}`);
        }
        const data = JSON.parse(raw) as TaskFileContents;
        tasks.push({
            ...data,
            verifyPath: path.join(dir, "verify.mjs"),
        });
    }
    tasks.sort((a, b) => a.id.localeCompare(b.id));
    return tasks;
}