#!/usr/bin/env python3
"""Generate or check published V7 schemas against the backend's runtime definitions."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/science"))

from science_backend.research_contracts import SCHEMAS  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    for name, schema in SCHEMAS.items():
        path = ROOT / "contracts" / name
        if args.check:
            if json.loads(path.read_text()) != schema:
                raise SystemExit(f"Generated research schema differs: {name}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(schema, indent=2) + "\n")


if __name__ == "__main__":
    main()
