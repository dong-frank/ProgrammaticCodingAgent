import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const workspace = process.argv[2];
if (workspace === undefined) {
    throw new Error("缺少 workspace 参数");
}

const { parseCsv } = await import(pathToFileURL(path.resolve(workspace, "src/csv.js")).href);

assert.deepEqual(parseCsv("a,b,c"), [["a", "b", "c"]]);
assert.deepEqual(parseCsv("a,\"b,c\",d"), [["a", "b,c", "d"]]);
assert.deepEqual(parseCsv("a,\"b\nc\",d"), [["a", "b\nc", "d"]]);
assert.deepEqual(parseCsv("\"a\"\"b\",c"), [["a\"b", "c"]]);
assert.deepEqual(parseCsv(",b,"), [["", "b", ""]]);
assert.deepEqual(parseCsv("a,b\nc,d"), [
    ["a", "b"],
    ["c", "d"],
]);

console.log("csv-parser 验收通过");