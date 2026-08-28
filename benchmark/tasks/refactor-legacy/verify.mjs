import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";

const workspace = process.argv[2];
if (workspace === undefined) {
    throw new Error("缺少 workspace 参数");
}

// legacy.js 应被删除
await assert.rejects(access(path.resolve(workspace, "src/legacy.js")), "legacy.js 应已删除");

const { sumPair } = await import(pathToFileURL(path.resolve(workspace, "src/use-a.js")).href);
const { double } = await import(pathToFileURL(path.resolve(workspace, "src/use-b.js")).href);
const { outerProduct } = await import(pathToFileURL(path.resolve(workspace, "src/use-c.js")).href);

assert.equal(sumPair(2, 3), 5);
assert.equal(double(4), 8);
assert.deepEqual(outerProduct(2, 3), [5, 6]);

console.log("refactor-legacy 验收通过");