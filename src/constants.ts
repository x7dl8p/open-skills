export const DEFAULT_SCAN_PATHS = [
    ".cursor/rules",
    ".cursor/skills",
    ".clinerules",
    ".cline_skills",
    ".claude/skills",
    "skills",
    ".github/copilot-instructions.md",
    ".github/instructions",
    ".continue/rules",
    ".continue/skills",
    ".amazonq/cli-agents",
    ".kiro",
    ".agent/skills",
    ".agents/skills",
    "_agent/skills",
    "_agents/skills",
];

export const SKILL_FILE_NAME = "SKILL.md";

export const EXTENSION_ID = "open-skills";
export const EXTENSION_VERSION = "0.1.0";
export const GITHUB_URL = "https://github.com/x7dl8p/open-skills";
export const DEVELOPER = "https://github.com/x7dl8p";
export const MARKETPLACE_URL =
    "https://marketplace.visualstudio.com/items?itemName=x7dl8p.open-skills";

export const IDE_SIGNATURES: ReadonlyArray<{ pattern: string; label: string }> = [
    { pattern: "cursor", label: "Cursor" },
    { pattern: "windsurf", label: "Windsurf" },
    { pattern: "vscodium", label: "VSCodium" },
    { pattern: "codium", label: "VSCodium" },
    { pattern: "insiders", label: "VS Code Insiders" },
    { pattern: "code - oss", label: "Code - OSS" },
    { pattern: "code", label: "VS Code" },
    { pattern: "antigravity", label: "Antigravity" }
];

export const DEFAULT_SKILL_REPOSITORIES: ReadonlyArray<{
    owner: string;
    repo: string;
    path: string;
    branch: string;
}> = [
        {
            owner: "x7dl8p",
            repo: "OpenSkill-Marketplace",
            path: "skills",
            branch: "main"
        },
        {
            owner: "anthropics",
            repo: "skills",
            path: "skills",
            branch: "main"
        },
        {
            owner: "vercel-labs",
            repo: "agent-skills",
            path: "skills",
            branch: "main"
        },
        {
            owner: "openai",
            repo: "skills",
            path: "skills/.curated",
            branch: "main"
        },
        {
            owner: "pytorch",
            repo: "pytorch",
            path: ".claude/skills",
            branch: "main"
        },
        {
            owner: "microsoftdocs",
            repo: "mcp",
            path: "skills",
            branch: "main"
        },
    ];
