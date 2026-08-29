import importlib.util
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
source = workspace / "src" / "math.py"
spec = importlib.util.spec_from_file_location("math_task", source)
assert spec is not None and spec.loader is not None, "无法加载 math.py"
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.add(2, 3) == 5
assert module.add(-1, 1) == 0
assert module.add(0, 0) == 0

print("single-func-fix 验收通过")
