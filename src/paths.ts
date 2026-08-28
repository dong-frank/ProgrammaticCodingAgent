import { fileURLToPath } from "node:url";
import path from "node:path";

export function projectRoot(): string {
    return path.resolve(fileURLToPath(new URL("..", import.meta.url)));
}