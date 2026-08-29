import importlib.util
import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
source = workspace / "src" / "calculator.py"
spec = importlib.util.spec_from_file_location("calculator", source)
assert spec is not None and spec.loader is not None, "无法加载 calculator.py"
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.add(2, 3) == 5
assert module.subtract(5, 3) == 2
assert module.multiply(2, 3) == 6
assert module.divide(6, 3) == 2
try:
    module.divide(1, 0)
except ZeroDivisionError:
    pass
else:
    raise AssertionError("divide(1, 0) 应抛出 ZeroDivisionError")

print("calculator-scaffold 验收通过")
