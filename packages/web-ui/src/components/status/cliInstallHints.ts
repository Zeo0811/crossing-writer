export interface CliInstallHint {
  install: string;
  login: string;
}

export const CLI_INSTALL_HINTS: Record<"claude" | "codex", CliInstallHint> = {
  claude: {
    install: "npm i -g @anthropic-ai/claude-code",
    login: "claude /login",
  },
  codex: {
    install: "brew install codex",
    login: "codex login",
  },
};
