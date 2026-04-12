from __future__ import annotations
import subprocess
import tempfile
import os
from pathlib import Path

class ClaudeError(Exception):
    pass

def invoke_claude(prompt: str, *, cli: str = "claude", timeout: int = 180) -> str:
    """Call a local model CLI subprocess and return the clean model response.

    Supports `claude -p <prompt>` and `codex exec --output-last-message <file> <prompt>`.
    """
    if cli == "codex":
        with tempfile.NamedTemporaryFile("r", suffix=".txt", delete=False) as f:
            out_path = f.name
        try:
            cmd = [
                cli, "exec",
                "--skip-git-repo-check", "--color", "never",
                "--ephemeral", "--sandbox", "read-only",
                "--output-last-message", out_path,
                prompt,
            ]
            try:
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=timeout,
                )
            except FileNotFoundError as e:
                raise ClaudeError(f"{cli} CLI not found: {e}") from e
            except subprocess.TimeoutExpired as e:
                raise ClaudeError(f"{cli} timed out after {timeout}s") from e
            if proc.returncode != 0:
                raise ClaudeError(f"{cli} exit={proc.returncode}: {proc.stderr[:500]}")
            return Path(out_path).read_text(encoding="utf-8")
        finally:
            try:
                os.unlink(out_path)
            except OSError:
                pass

    cmd = [cli, "-p", prompt]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError as e:
        raise ClaudeError(f"{cli} CLI not found: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise ClaudeError(f"{cli} timed out after {timeout}s") from e
    if proc.returncode != 0:
        raise ClaudeError(f"{cli} exit={proc.returncode}: {proc.stderr[:500]}")
    return proc.stdout
