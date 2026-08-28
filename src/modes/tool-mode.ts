import type { ModeConfig } from "./types.ts";
import { createDefaultRegistry } from "../tools/registry.ts";
import { buildToolSystemPrompt } from "../agent/system-prompt.ts";

export function createToolModeConfig(): ModeConfig {
    const registry = createDefaultRegistry();
    return {
        registry,
        systemPrompt: (workspace) => buildToolSystemPrompt(workspace, registry.list()),
    };
}