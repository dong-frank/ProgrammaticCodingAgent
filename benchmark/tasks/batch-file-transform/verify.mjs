import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

const workspace = process.argv[2];
if (workspace === undefined) {
    throw new Error("缺少 workspace 参数");
}

const expected = {
    "a.meta.json": { name: "apple", score: 85, passed: true },
    "b.meta.json": { name: "banana", score: 42, passed: false },
    "c.meta.json": { name: "cherry", score: 90, passed: true },
    "d.meta.json": { name: "date", score: 58, passed: false },
    "e.meta.json": { name: "elderberry", score: 73, passed: true },
    "f.meta.json": { name: "fig", score: 30, passed: false },
    "g.meta.json": { name: "grape", score: 100, passed: true },
    "h.meta.json": { name: "honeydew", score: 61, passed: true },
};

for (const [metaFile, expectedValue] of Object.entries(expected)) {
    await access(path.resolve(workspace, "src", "data", metaFile));
    const text = await readFile(path.resolve(workspace, "src", "data", metaFile), "utf8");
    assert.deepEqual(JSON.parse(text), expectedValue, `${metaFile} 内容不符合预期`);
}

// 原文件应保持未被修改
const original = await readFile(path.resolve(workspace, "src", "data", "a.txt"), "utf8");
assert.equal(original, "apple,85\n");

console.log("batch-file-transform 验收通过");