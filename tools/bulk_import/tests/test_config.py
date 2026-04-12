from pathlib import Path
import json
from bulk_import.config import load_config

def test_load_config_expands_tilde(tmp_path):
    cfg_file = tmp_path / "config.json"
    cfg_file.write_text(json.dumps({
        "vaultPath": "~/CrossingVault",
        "sqlitePath": "~/CrossingVault/.index/refs.sqlite",
        "importSources": {"xlsxDir": "/tmp/x", "htmlDir": "/tmp/h"},
        "modelAdapter": {"defaultCli": "claude", "fallbackCli": "codex"}
    }))
    cfg = load_config(cfg_file)
    assert cfg.vault_path == Path.home() / "CrossingVault"
    assert cfg.sqlite_path == Path.home() / "CrossingVault/.index/refs.sqlite"
    assert cfg.xlsx_dir == Path("/tmp/x")
    assert cfg.html_dir == Path("/tmp/h")
    assert cfg.default_cli == "claude"
