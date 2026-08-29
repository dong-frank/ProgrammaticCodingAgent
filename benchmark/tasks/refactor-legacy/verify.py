import pathlib
import sys

workspace = pathlib.Path(sys.argv[1])
sys.path.insert(0, str(workspace))

assert not (workspace / "src" / "legacy.py").exists(), "legacy.py 应已删除"
from src.use_a import sum_pair
from src.use_b import double
from src.use_c import outer_product

assert sum_pair(2, 3) == 5
assert double(4) == 8
assert outer_product(2, 3) == [5, 6]

for path in (workspace / "src").glob("*.py"):
    if "legacy_calc" in path.read_text(encoding="utf-8"):
        raise AssertionError(f"{path.name} 仍然引用 legacy_calc")

print("refactor-legacy 验收通过")
