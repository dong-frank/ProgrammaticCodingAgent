import json
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
expected = {
    "a.meta.json": {"name": "apple", "score": 85, "passed": True},
    "b.meta.json": {"name": "banana", "score": 42, "passed": False},
    "c.meta.json": {"name": "cherry", "score": 90, "passed": True},
    "d.meta.json": {"name": "date", "score": 58, "passed": False},
    "e.meta.json": {"name": "elderberry", "score": 73, "passed": True},
    "f.meta.json": {"name": "fig", "score": 30, "passed": False},
    "g.meta.json": {"name": "grape", "score": 100, "passed": True},
    "h.meta.json": {"name": "honeydew", "score": 61, "passed": True},
}

for name, value in expected.items():
    target = workspace / "src" / "data" / name
    assert target.exists(), f"缺少 {name}"
    assert json.loads(target.read_text(encoding="utf-8")) == value, f"{name} 内容不符合预期"

assert (workspace / "src" / "data" / "a.txt").read_text(encoding="utf-8") == "apple,85\n"
print("batch-file-transform 验收通过")
