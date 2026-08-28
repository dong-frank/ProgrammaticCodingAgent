import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const workspace = process.argv[2];
if (workspace === undefined) {
    throw new Error("缺少 workspace 参数");
}

const { add } = await import(pathToFileURL(path.resolve(workspace, "src/math.js")).href);

assert.equal(add(2, 3), 5);
assert.equal(add(-1, 1), 0);
assert.equal(add(0, 0), 0);

console.log("single-func-fix 验收通过");