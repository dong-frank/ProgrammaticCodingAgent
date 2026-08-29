import importlib.util
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
source = workspace / "src" / "queue.py"
spec = importlib.util.spec_from_file_location("queue_task", source)
assert spec is not None and spec.loader is not None, "无法加载 queue.py"
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

queue = module.Queue()
assert queue.size == 0
assert queue.dequeue() is None
assert queue.peek() is None
queue.enqueue(1)
queue.enqueue(2)
queue.enqueue(3)
assert queue.size == 3
assert queue.dequeue() == 1
assert queue.dequeue() == 2
assert queue.peek() == 3
assert queue.size == 1
assert queue.dequeue() == 3
assert queue.dequeue() is None

print("queue-impl 验收通过")
