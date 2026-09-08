from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / "openapi" / "boxcompute-v2.json"
output = (
    ROOT / "packages" / "python" / "src" / "boxcompute" / "_generated" / "models.py"
)
output.parent.mkdir(parents=True, exist_ok=True)

subprocess.run(
    [
        sys.executable,
        "-m",
        "datamodel_code_generator",
        "--input",
        str(source),
        "--input-file-type",
        "openapi",
        "--output",
        str(output),
        "--output-model-type",
        "pydantic_v2.BaseModel",
        "--target-python-version",
        "3.10",
        "--use-standard-collections",
        "--use-union-operator",
        "--snake-case-field",
        "--use-field-description",
        "--extra-fields",
        "ignore",
        "--reuse-model",
        "--formatters",
        "builtin",
        "--disable-timestamp",
    ],
    check=True,
)
generated = output.read_text(encoding="utf-8")
output.write_text(f"# mypy: ignore-errors\n{generated}", encoding="utf-8")
print(f"Generated {output}")
