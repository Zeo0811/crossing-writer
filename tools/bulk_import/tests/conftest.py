import pytest
from pathlib import Path

@pytest.fixture
def tmp_sqlite(tmp_path) -> Path:
    return tmp_path / "refs.sqlite"
