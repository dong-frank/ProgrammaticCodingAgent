import importlib.util
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
source = workspace / "src" / "csv.py"
spec = importlib.util.spec_from_file_location("csv_task", source)
assert spec is not None and spec.loader is not None, "无法加载 csv.py"
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.parse_csv("a,b,c") == [["a", "b", "c"]]
assert module.parse_csv('a,"b,c",d') == [["a", "b,c", "d"]]
assert module.parse_csv('a,"b\nc",d') == [["a", "b\nc", "d"]]
assert module.parse_csv('"a""b",c') == [["a\"b", "c"]]
assert module.parse_csv(",b,") == [["", "b", ""]]
assert module.parse_csv("a,b\nc,d") == [["a", "b"], ["c", "d"]]

print("csv-parser 验收通过")
