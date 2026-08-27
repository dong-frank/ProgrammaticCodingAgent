import { mkdir, readFile, readdir, writeFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SessionRecord } from "./types.ts";

function sessionDir(): string {
    const configured = process.env.PCA_SESSION_DIR;
    if (configured !== undefined && configured.length > 0) {
        return configured;
    }
    return path.join(os.homedir(), ".pca", "sessions");
}

function sessionPath(id: string): string {
    return path.join(sessionDir(), `${id}.json`);
}

function generateId(): string {
    const timestamp = Date.now().toString(36);
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${timestamp}-${suffix}`;
}

function isValidId(id: string): boolean {
    return /^[a-z0-9-]+$/.test(id);
}

export class SessionStore {
    async list(): Promise<SessionRecord[]> {
        const dir = sessionDir();
        let entries: string[];
        try {
            entries = await readdir(dir);
        } catch {
            return [];
        }
        const records: SessionRecord[] = [];
        for (const entry of entries) {
            if (!entry.endsWith(".json")) {
                continue;
            }
            try {
                const content = await readFile(path.join(dir, entry), "utf8");
                records.push(JSON.parse(content) as SessionRecord);
            } catch {
                continue;
            }
        }
        records.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return records;
    }

    async get(id: string): Promise<SessionRecord | null> {
        if (!isValidId(id)) {
            return null;
        }
        try {
            const content = await readFile(sessionPath(id), "utf8");
            return JSON.parse(content) as SessionRecord;
        } catch {
            return null;
        }
    }

    async save(record: SessionRecord): Promise<void> {
        await mkdir(sessionDir(), { recursive: true });
        const target = sessionPath(record.id);
        const temporary = `${target}.tmp`;
        await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
        await rename(temporary, target);
    }

    async remove(id: string): Promise<void> {
        if (!isValidId(id)) {
            return;
        }
        try {
            await rm(sessionPath(id));
        } catch {
            return;
        }
    }

    createRecord(params: { workspace: string; mode: SessionRecord["mode"]; model: string }): SessionRecord {
        const now = new Date().toISOString();
        return {
            id: generateId(),
            createdAt: now,
            updatedAt: now,
            workspace: params.workspace,
            mode: params.mode,
            model: params.model,
            messages: [],
        };
    }
}