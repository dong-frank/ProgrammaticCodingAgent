import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = process.argv[2];
if (workspace === undefined) {
    throw new Error("缺少 workspace 参数");
}

const pkgText = await readFile(path.resolve(workspace, "package.json"), "utf8");
const pkg = JSON.parse(pkgText);
assert.equal(pkg.type, "module", "package.json 应声明 type: module");

const { add, subtract, multiply, divide } = await import(
    pathToFileURL(path.resolve(workspace, "src/calculator.js")).href
);

assert.equal(add(2, 3), 5);
assert.equal(subtract(5, 3), 2);
assert.equal(multiply(2, 3), 6);
assert.equal(divide(6, 3), 2);
assert.throws(() => divide(1, 0));

console.log("calculator-scaffold 验收通过");