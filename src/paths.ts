import { fileURLToPath } from "node:url";
import path from "node:path";

export function resolveWorkspacePath(filePath: string, cwd: string, restrictToWorkspace = true): string {
    const absolutePath = path.resolve(cwd, filePath);
    if (restrictToWorkspace) {
        const relativePath = path.relative(cwd, absolutePath);
        if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
            throw new Error(`路径超出工作目录范围：${filePath}`);
        }
    }
    return absolutePath;
}

export function validateWorkspaceGlob(pattern: string, restrictToWorkspace = true): void {
    if (!restrictToWorkspace) {
        return;
    }
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]+/).includes("..")) {
        throw new Error(`匹配模式超出工作目录范围：${pattern}`);
    }
}

export function projectRoot(): string {
    return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}
