import type { ToolDefinition } from "./types.ts";

interface ParameterSchema {
    type?: string;
    items?: { type?: string };
}

function parameterSchemaOf(tool: ToolDefinition): { properties?: Record<string, ParameterSchema>; required?: string[] } {
    return tool.parameters as { properties?: Record<string, ParameterSchema>; required?: string[] };
}

export function formatParameterList(tool: ToolDefinition): string {
    const schema = parameterSchemaOf(tool);
    const required = new Set(schema.required ?? []);
    return Object.entries(schema.properties ?? {})
        .map(([name, prop]) => {
            const optional = required.has(name) ? "" : "?";
            const type = prop.type === "array" ? "string[]" : (prop.type ?? "unknown");
            return `${name}${optional}: ${type}`;
        })
        .join(", ");
}

export function renderParametersObjectType(parameters: unknown): string {
    const schema = parameters as
        | { properties?: Record<string, ParameterSchema>; required?: string[] }
        | undefined;
    const required = new Set(schema?.required ?? []);
    const entries = Object.entries(schema?.properties ?? {}).map(([name, prop]) => {
        const optional = required.has(name) ? "" : "?";
        const type = prop.type === "array" ? "string[]" : (prop.type ?? "unknown");
        return `${name}${optional}: ${type}`;
    });
    if (entries.length === 0) {
        return "Record<string, unknown>";
    }
    return `{ ${entries.join("; ")} }`;
}

export function renderToolUsageGuide(tools: ToolDefinition[]): string {
    return tools.map((tool) => `- ${tool.name}(${formatParameterList(tool)})：${tool.description}`).join("\n");
}