import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { MarketplaceSkill, SkillRepository } from '../types';
import { GitHubSkillsClient } from '../github/GitHubSkillsClient';

export class MarketplaceSkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skill: MarketplaceSkill,
        public readonly isInstalled: boolean = false
    ) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);

        this.description = MarketplaceSkillTreeItem.truncate(skill.description, 60);
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${skill.name}**\n\n`);
        this.tooltip.appendMarkdown(`${skill.description}\n\n`);
        if (skill.license) {
            this.tooltip.appendMarkdown(`*License: ${skill.license}*\n\n`);
        }
        this.tooltip.appendMarkdown(`Source: \`${skill.source.owner}/${skill.source.repo}\``);
        this.iconPath = new vscode.ThemeIcon(isInstalled ? 'check' : 'extensions');
        this.contextValue = isInstalled ? 'marketplaceSkillInstalled' : 'marketplaceSkill';
        this.command = {
            command: 'open-skills.viewMarketplaceSkill',
            title: 'View Details',
            arguments: [skill]
        };
    }

    private static truncate(text: string, max: number): string {
        return text.length <= max ? text : text.substring(0, max - 3) + '...';
    }
}

export class RepoTreeItem extends vscode.TreeItem {
    constructor(
        public readonly repo: SkillRepository,
        public state: 'idle' | 'loading' | 'loaded' | 'error' = 'idle',
        public skillCount: number = 0
    ) {
        super(
            `${repo.owner}/${repo.repo}`,
            vscode.TreeItemCollapsibleState.Collapsed
        );
        this.iconPath = new vscode.ThemeIcon('github');
        this.contextValue = 'marketplaceSource';
        this.updateDescription();
    }

    updateDescription(): void {
        if (this.state === 'loading') {
            this.description = 'loading...';
            this.iconPath = new vscode.ThemeIcon('loading~spin');
        } else if (this.state === 'loaded') {
            this.description = `${this.skillCount} skill${this.skillCount !== 1 ? 's' : ''}`;
            this.iconPath = new vscode.ThemeIcon('github');
        } else if (this.state === 'error') {
            this.description = 'failed to load';
            this.iconPath = new vscode.ThemeIcon('error');
        } else {
            this.description = this.repo.path || '/';
            this.iconPath = new vscode.ThemeIcon('github');
        }
    }
}

type AnyItem = RepoTreeItem | MarketplaceSkillTreeItem;

export class MarketplaceTreeProvider implements vscode.TreeDataProvider<AnyItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AnyItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private repos: SkillRepository[] = [];
    private repoItems: RepoTreeItem[] = [];
    private skillCache: Map<string, MarketplaceSkill[]> = new Map();
    private searchQuery: string = '';
    private installedSkillNames: Set<string> = new Set();

    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) {
        this.repos = this.githubClient.getRepositories();
        this.repoItems = this.repos.map(r => new RepoTreeItem(r));
    }

    refresh(): void {
        this.skillCache.clear();
        this.githubClient.clearCache();
        this.repoItems = this.repos.map(r => new RepoTreeItem(r));
        this._onDidChangeTreeData.fire();
    }

    setInstalledSkills(names: Set<string>): void {
        this.installedSkillNames = names;
        this._onDidChangeTreeData.fire();
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this._onDidChangeTreeData.fire();
        vscode.commands.executeCommand('setContext', 'openSkills:searchActive', query.length > 0);
    }

    clearSearch(): void {
        this.setSearchQuery('');
    }

    isSearchActive(): boolean {
        return this.searchQuery.length > 0;
    }

    getSkills(): MarketplaceSkill[] {
        const all: MarketplaceSkill[] = [];
        for (const skills of this.skillCache.values()) {
            all.push(...skills);
        }
        return all;
    }

    getSkillByName(name: string): MarketplaceSkill | undefined {
        for (const skills of this.skillCache.values()) {
            const found = skills.find(s => s.name === name);
            if (found) { return found; }
        }
        return undefined;
    }

    getTreeItem(element: AnyItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AnyItem): Promise<AnyItem[]> {
        if (!element) {
            if (this.repoItems.length === 0) {
                const empty = new vscode.TreeItem('No repositories configured', vscode.TreeItemCollapsibleState.None);
                empty.iconPath = new vscode.ThemeIcon('info');
                return [empty as unknown as AnyItem];
            }

            if (this.searchQuery) {
                return this.getSearchResults();
            }

            return this.repoItems;
        }

        if (element instanceof RepoTreeItem) {
            return this.getSkillsForRepo(element);
        }

        return [];
    }

    private async getSkillsForRepo(repoItem: RepoTreeItem): Promise<AnyItem[]> {
        const cacheKey = `${repoItem.repo.owner}/${repoItem.repo.repo}@${repoItem.repo.path}`;

        if (this.skillCache.has(cacheKey)) {
            const cached = this.skillCache.get(cacheKey)!;
            return this.skillsToItems(cached);
        }

        repoItem.state = 'loading';
        repoItem.updateDescription();
        this._onDidChangeTreeData.fire(repoItem);

        try {
            const skills = await this.githubClient.fetchSkillsFromRepo(repoItem.repo);
            this.skillCache.set(cacheKey, skills);
            repoItem.state = 'loaded';
            repoItem.skillCount = skills.length;
            repoItem.updateDescription();
            this._onDidChangeTreeData.fire(repoItem);
            return this.skillsToItems(skills);
        } catch {
            repoItem.state = 'error';
            repoItem.updateDescription();
            this._onDidChangeTreeData.fire(repoItem);

            const errItem = new vscode.TreeItem('Failed to load. Check network or token.');
            errItem.iconPath = new vscode.ThemeIcon('warning');
            return [errItem as unknown as AnyItem];
        }
    }

    private skillsToItems(skills: MarketplaceSkill[]): MarketplaceSkillTreeItem[] {
        const filtered = this.searchQuery
            ? skills.filter(s =>
                s.name.toLowerCase().includes(this.searchQuery) ||
                s.description.toLowerCase().includes(this.searchQuery)
            )
            : skills;

        return filtered.map(s => new MarketplaceSkillTreeItem(s, this.installedSkillNames.has(s.name)));
    }

    private getSearchResults(): AnyItem[] {
        const all = this.getSkills();
        const filtered = all.filter(s =>
            s.name.toLowerCase().includes(this.searchQuery) ||
            s.description.toLowerCase().includes(this.searchQuery)
        );

        if (filtered.length === 0) {
            const noRes = new vscode.TreeItem(`No results for "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
            noRes.iconPath = new vscode.ThemeIcon('search-stop');
            return [noRes as unknown as AnyItem];
        }

        return filtered.map(s => new MarketplaceSkillTreeItem(s, this.installedSkillNames.has(s.name)));
    }
}

export function resolveGlobalSkillsPath(): string {
    return path.join(os.homedir(), '.open-skills');
}

export type { AnyItem as MarketplaceTreeItem };
