export const MODES = ["tool", "code"] as const;

export type Mode = (typeof MODES)[number];

export function isMode(value: string): value is Mode {
    return (MODES as readonly string[]).includes(value);
}