from __future__ import annotations
import subprocess

class ClaudeError(Exception):
    pass

def invoke_claude(prompt: str, *, cli: str = "claude", timeout: int = 120) -> str:
    """Call `claude -p <prompt>` subprocess and return stdout text."""
    try:
        proc = subprocess.run(
            [cli, "-p", prompt],
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError as e:
        raise ClaudeError(f"{cli} CLI not found: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise ClaudeError(f"{cli} timed out after {timeout}s") from e
    if proc.returncode != 0:
        raise ClaudeError(f"{cli} exit={proc.returncode}: {proc.stderr[:500]}")
    return proc.stdout
