import * as vscode from "vscode";
import { MarketplaceSkill, SkillRepository, SkillMetadata, CacheEntry, DEFAULT_SKILL_REPOSITORIES } from "../types";

interface GitTreeItem {
    path: string;
    mode: string;
    type: "blob" | "tree";
    sha: string;
    size?: number;
    url?: string;
}

interface GitTreeResponse {
    sha: string;
    url: string;
    tree: GitTreeItem[];
    truncated: boolean;
}

const API_BASE = "https://api.github.com";
const RAW_BASE = "https://raw.githubusercontent.com";

const METADATA_KEYS: ReadonlyArray<{ key: string; field: keyof SkillMetadata }> = [
    { key: "name", field: "name" },
    { key: "description", field: "description" },
    { key: "license", field: "license" },
    { key: "compatibility", field: "compatibility" },
    { key: "allowed-tools", field: "allowedTools" },
];

export class GitHubSkillsClient {
    private readonly cache: Map<string, CacheEntry<unknown>> = new Map();
    private readonly context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async fetchAllSkills(): Promise<MarketplaceSkill[]> {
        const config = vscode.workspace.getConfiguration("open-skills");
        const customRepos = config.get<SkillRepository[]>("skillRepositories", []);
        const repositories = [...DEFAULT_SKILL_REPOSITORIES, ...customRepos];

        const allSkills: MarketplaceSkill[] = [];
        const errors: string[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "Fetching skills...",
        }, async (progress) => {
            const results = await Promise.allSettled(
                repositories.map(async (repo) => {
                    progress.report({ message: `${repo.owner}/${repo.repo}` });
                    return this.fetchSkillsFromRepo(repo);
                })
            );

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                if (result.status === "fulfilled") {
                    allSkills.push(...result.value);
                } else {
                    const repo = repositories[i];
                    errors.push(`${repo.owner}/${repo.repo}: ${result.reason}`);
                }
            }
        });

        if (errors.length > 0 && allSkills.length === 0) {
            vscode.window.showWarningMessage(
                `Failed to fetch some skills: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`
            );
        }

        return allSkills;
    }

    async fetchSkillsFromRepo(repo: SkillRepository): Promise<MarketplaceSkill[]> {
        if (repo.singleSkill) {
            return this.fetchSingleSkill(repo);
        }

        const tree = await this.fetchRepoTree(repo.owner, repo.repo, repo.branch);
        const prefix = repo.path ? (repo.path.endsWith('/') ? repo.path : repo.path + '/') : '';

        // Extract directories containing SKILL.md
        const skillPaths = tree.tree
            .filter((item) =>
                item.type === "blob" &&
                item.path.startsWith(prefix) &&
                (item.path.endsWith("/SKILL.md") || item.path === "SKILL.md")
            )
            .map((item) => {
                const idx = item.path.lastIndexOf("/");
                return idx === -1 ? "" : item.path.substring(0, idx);
            });

        // Dedup paths in case of multiple SKILL.md in hierarchy (rare but possible)
        const uniquePaths = Array.from(new Set(skillPaths));

        const results = await Promise.all(
            uniquePaths.map(async (skillPath) => {
                try {
                    const skillName = skillPath.split("/").pop() || repo.repo;
                    return await this.fetchSkillMetadata(repo, skillName, skillPath);
                } catch {
                    return null;
                }
            })
        );

        return results.filter((s): s is MarketplaceSkill => s !== null);
    }

    private async fetchRepoTree(owner: string, repo: string, branch: string): Promise<GitTreeResponse> {
        const cacheKey = `tree:${owner}/${repo}@${branch}`;
        const cached = this.getFromCache<GitTreeResponse>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
        const response = await this.fetchWithAuth(url);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Repository or branch not found: ${owner}/${repo}@${branch}`);
            }
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        this.checkRateLimit(response);

        const data = await response.json() as GitTreeResponse;
        this.setCache(cacheKey, data);
        return data;
    }

    private async fetchSingleSkill(repo: SkillRepository): Promise<MarketplaceSkill[]> {
        try {
            const skillName = repo.path.split("/").pop() || repo.repo;
            const skill = await this.fetchSkillMetadata(repo, skillName, repo.path);
            return skill ? [skill] : [];
        } catch {
            return [];
        }
    }

    async fetchSkillMetadata(
        repo: SkillRepository,
        skillName: string,
        skillPath: string
    ): Promise<MarketplaceSkill | null> {
        try {
            const content = await this.fetchRawContent(
                repo.owner, repo.repo, skillPath ? `${skillPath}/SKILL.md` : "SKILL.md", repo.branch
            );
            const parsed = this.parseSkillMd(content);

            // Robust: Try to enrich from metadata.json (common in Vercel skill structure)
            if (!parsed.metadata.description) {
                try {
                    const metaRaw = await this.fetchRawContent(repo.owner, repo.repo, skillPath ? `${skillPath}/metadata.json` : "metadata.json", repo.branch);
                    const meta = JSON.parse(metaRaw);
                    if (meta.abstract) {
                        parsed.metadata.description = meta.abstract;
                    }
                    if (meta.organization && !parsed.metadata.name) {
                        parsed.metadata.name = `${meta.organization}: ${skillName}`;
                    }
                } catch {
                    // Squelch: metadata.json is optional
                }
            }

            return {
                name: parsed.metadata.name || skillName,
                description: parsed.metadata.description || "No description available",
                license: parsed.metadata.license,
                compatibility: parsed.metadata.compatibility,
                source: repo,
                skillPath,
                fullContent: content,
                bodyContent: parsed.body,
            };
        } catch {
            return null;
        }
    }

    private async fetchRawContent(
        owner: string,
        repo: string,
        filePath: string,
        branch: string
    ): Promise<string> {
        const cacheKey = `raw:${owner}/${repo}/${filePath}@${branch}`;
        const cached = this.getFromCache<string>(cacheKey);
        if (cached) {
            return cached;
        }

        const url = `${RAW_BASE}/${owner}/${repo}/${branch}/${filePath}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch file: ${response.status}`);
        }

        const content = await response.text();
        this.setCache(cacheKey, content);
        return content;
    }

    async fetchFileContent(
        owner: string,
        repo: string,
        filePath: string,
        branch: string
    ): Promise<string> {
        return this.fetchRawContent(owner, repo, filePath, branch);
    }

    async fetchSkillFiles(skill: MarketplaceSkill): Promise<{ path: string; content: string }[]> {
        const { owner, repo, branch } = skill.source;
        const tree = await this.fetchRepoTree(owner, repo, branch);
        const prefix = skill.skillPath ? skill.skillPath + "/" : "";

        const skillFiles = tree.tree.filter(
            (item) => item.type === "blob" && (prefix ? item.path.startsWith(prefix) : true)
        );

        return this.fetchFilesWithPool(
            skillFiles.map((item) => ({
                remotePath: item.path,
                relativePath: prefix ? item.path.substring(prefix.length) : item.path,
            })),
            owner, repo, branch
        );
    }

    private async fetchFilesWithPool(
        files: { remotePath: string; relativePath: string }[],
        owner: string,
        repo: string,
        branch: string,
        concurrency = 5,
        batchDelayMs = 150
    ): Promise<{ path: string; content: string }[]> {
        const results: { path: string; content: string }[] = [];

        for (let i = 0; i < files.length; i += concurrency) {
            const batch = files.slice(i, i + concurrency);

            const batchResults = await Promise.all(
                batch.map(async ({ remotePath, relativePath }) => {
                    const content = await this.fetchRawContent(owner, repo, remotePath, branch);
                    return { path: relativePath, content };
                })
            );

            results.push(...batchResults);

            if (i + concurrency < files.length) {
                await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
            }
        }

        return results;
    }

    private parseSkillMd(content: string): { metadata: SkillMetadata; body: string } {
        const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

        if (!frontmatterMatch) {
            return {
                metadata: { name: "", description: "" },
                body: content,
            };
        }

        return {
            metadata: this.parseYamlFrontmatter(frontmatterMatch[1]),
            body: frontmatterMatch[2],
        };
    }

    private parseYamlFrontmatter(yaml: string): SkillMetadata {
        const metadata: SkillMetadata = { name: "", description: "" };
        const lines = yaml.split("\n");
        let currentKey = "";
        let multilineValue = "";

        for (const line of lines) {
            const keyMatch = line.match(/^(\w+(?:-\w+)*):\s*(.*)$/);

            if (keyMatch) {
                if (currentKey && multilineValue) {
                    this.applyMetadataField(metadata, currentKey, multilineValue.trim());
                }

                currentKey = keyMatch[1];
                const value = keyMatch[2].trim();

                if (value) {
                    this.applyMetadataField(metadata, currentKey, value);
                    currentKey = "";
                    multilineValue = "";
                } else {
                    multilineValue = "";
                }
            } else if (currentKey && line.startsWith("  ")) {
                multilineValue += line.trim() + " ";
            }
        }

        if (currentKey && multilineValue) {
            this.applyMetadataField(metadata, currentKey, multilineValue.trim());
        }

        return metadata;
    }

    private applyMetadataField(metadata: SkillMetadata, key: string, value: string): void {
        const mapping = METADATA_KEYS.find((m) => m.key === key);
        if (mapping) {
            (metadata as unknown as Record<string, string | undefined>)[mapping.field] = value;
        }
    }

    private async fetchWithAuth(url: string): Promise<Response> {
        const config = vscode.workspace.getConfiguration("open-skills");
        const token = config.get<string>("githubToken", "");

        const headers: Record<string, string> = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        };

        if (token) {
            headers["Authorization"] = `Bearer ${token}`;
        }

        return fetch(url, { headers });
    }

    private checkRateLimit(response: Response): void {
        const remaining = response.headers.get("x-ratelimit-remaining");
        const reset = response.headers.get("x-ratelimit-reset");

        if (remaining && parseInt(remaining) < 10) {
            const resetDate = reset ? new Date(parseInt(reset) * 1000) : new Date();
            vscode.window.showWarningMessage(
                `GitHub API rate limit low (${remaining} remaining). Resets at ${resetDate.toLocaleTimeString()}`
            );
        }
    }

    private getFromCache<T>(key: string): T | null {
        const entry = this.cache.get(key) as CacheEntry<T> | undefined;
        if (!entry) {
            return null;
        }

        const config = vscode.workspace.getConfiguration("open-skills");
        const timeout = config.get<number>("cacheTimeout", 3600) * 1000;

        if (Date.now() - entry.timestamp > timeout) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    private setCache<T>(key: string, data: T): void {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    clearCache(): void {
        this.cache.clear();
    }
}
