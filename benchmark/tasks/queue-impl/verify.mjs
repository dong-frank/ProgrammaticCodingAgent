import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const workspace = process.argv[2];
if (workspace === undefined) {
    throw new Error("缺少 workspace 参数");
}

const { Queue } = await import(pathToFileURL(path.resolve(workspace, "src/queue.js")).href);

const queue = new Queue();
assert.equal(queue.size, 0);
assert.equal(queue.dequeue(), undefined);
assert.equal(queue.peek(), undefined);

queue.enqueue(1);
queue.enqueue(2);
queue.enqueue(3);
assert.equal(queue.size, 3);
assert.equal(queue.dequeue(), 1);
assert.equal(queue.dequeue(), 2);
assert.equal(queue.peek(), 3);
assert.equal(queue.size, 1);
assert.equal(queue.dequeue(), 3);
assert.equal(queue.dequeue(), undefined);

console.log("queue-impl 验收通过");