#!/usr/bin/env bash
# Smoke-test the importer on a single account. Usage: ./smoke.sh [account_name]
set -euo pipefail
ACCOUNT="${1:-AGI Hunt}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT/tools/bulk_import"

TMP_XLSX_DIR="$(mktemp -d)"
cp "/Users/zeoooo/Downloads/60-表格/${ACCOUNT}.xlsx" "$TMP_XLSX_DIR/"

SMOKE_SQLITE="$HOME/CrossingVault/.index/refs-smoke.sqlite"
rm -f "$SMOKE_SQLITE"

.venv/bin/python - <<PY
from dataclasses import replace
from pathlib import Path
from bulk_import.config import load_config
from bulk_import.importer import run_import
cfg = load_config(Path("$REPO_ROOT/config.json"))
cfg = replace(
    cfg,
    sqlite_path=Path("$SMOKE_SQLITE"),
    xlsx_dir=Path("$TMP_XLSX_DIR"),
)
stats = run_import(cfg)
print(stats)
PY

rm -rf "$TMP_XLSX_DIR"
echo "Smoke sqlite: $SMOKE_SQLITE"
