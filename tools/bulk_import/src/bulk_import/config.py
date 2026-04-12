from dataclasses import dataclass
from pathlib import Path
import json

@dataclass(frozen=True)
class Config:
    vault_path: Path
    sqlite_path: Path
    xlsx_dir: Path
    html_dir: Path
    default_cli: str
    fallback_cli: str

def _expand(p: str) -> Path:
    return Path(p).expanduser()

def load_config(path: Path) -> Config:
    data = json.loads(Path(path).read_text())
    return Config(
        vault_path=_expand(data["vaultPath"]),
        sqlite_path=_expand(data["sqlitePath"]),
        xlsx_dir=_expand(data["importSources"]["xlsxDir"]),
        html_dir=_expand(data["importSources"]["htmlDir"]),
        default_cli=data["modelAdapter"]["defaultCli"],
        fallback_cli=data["modelAdapter"]["fallbackCli"],
    )
