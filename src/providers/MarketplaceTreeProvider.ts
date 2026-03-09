import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { MarketplaceSkill, SkillRepository, CategoryNode, SkillNode } from '../types';
import { GitHubSkillsClient } from '../github/GitHubSkillsClient';

export class CategoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly categoryNode: CategoryNode,
        public readonly repo: SkillRepository
    ) {
        super(categoryNode.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.description = `${categoryNode.skills.length} skill${categoryNode.skills.length !== 1 ? 's' : ''}`;
        this.iconPath = new vscode.ThemeIcon('folder');
        this.contextValue = 'marketplaceCategory';
    }
}

export class MarketplaceSkillTreeItem extends vscode.TreeItem {
    public readonly skill: MarketplaceSkill;

    constructor(
        node: SkillNode,
        isInstalled: boolean = false
    ) {
        super(node.name, vscode.TreeItemCollapsibleState.None);
        this.skill = { name: node.name, description: '', source: node.source, skillPath: node.skillPath };
        this.tooltip = `${node.source.owner}/${node.source.repo}: ${node.skillPath}`;
        this.iconPath = new vscode.ThemeIcon(isInstalled ? 'check' : 'extensions');
        this.contextValue = isInstalled ? 'marketplaceSkillInstalled' : 'marketplaceSkill';
        this.command = {
            command: 'open-skills.viewMarketplaceSkill',
            title: 'View Details',
            arguments: [this.skill]
        };
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

type AnyItem = RepoTreeItem | CategoryTreeItem | MarketplaceSkillTreeItem;

export class MarketplaceTreeProvider implements vscode.TreeDataProvider<AnyItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<AnyItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private repos: SkillRepository[] = [];
    private repoItems: RepoTreeItem[] = [];
    private treeCache: Map<string, CategoryNode[]> = new Map();
    private searchQuery: string = '';
    private installedSkillNames: Set<string> = new Set();

    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) {
        this.repos = this.githubClient.getRepositories();
        this.repoItems = this.repos.map(r => new RepoTreeItem(r));
    }

    /** Fire-and-forget: fetch every repo in the background so search works immediately. */
    prefetchAll(): void {
        for (const repoItem of this.repoItems) {
            const cacheKey = `${repoItem.repo.owner}/${repoItem.repo.repo}@${repoItem.repo.branch}`;
            if (this.treeCache.has(cacheKey)) { continue; }

            repoItem.state = 'loading';
            repoItem.updateDescription();
            this._onDidChangeTreeData.fire(repoItem);

            this.githubClient.fetchSkillTreeFromRepo(repoItem.repo)
                .then(categories => {
                    this.treeCache.set(cacheKey, categories);
                    repoItem.state = 'loaded';
                    repoItem.skillCount = categories.reduce((sum, c) => sum + c.skills.length, 0);
                    repoItem.updateDescription();
                    this._onDidChangeTreeData.fire(repoItem);
                })
                .catch(() => {
                    repoItem.state = 'error';
                    repoItem.updateDescription();
                    this._onDidChangeTreeData.fire(repoItem);
                });
        }
    }

    refresh(): void {
        this.treeCache.clear();
        this.githubClient.clearCache();
        this.repoItems = this.repos.map(r => new RepoTreeItem(r));
        this._onDidChangeTreeData.fire();
        this.prefetchAll();
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

    currentSearch(): string {
        return this.searchQuery;
    }

    getSkills(): MarketplaceSkill[] {
        const all: MarketplaceSkill[] = [];
        for (const categories of this.treeCache.values()) {
            for (const cat of categories) {
                for (const node of cat.skills) {
                    all.push({ name: node.name, description: '', source: node.source, skillPath: node.skillPath });
                }
            }
        }
        return all;
    }

    getSkillByName(name: string): MarketplaceSkill | undefined {
        for (const categories of this.treeCache.values()) {
            for (const cat of categories) {
                const node = cat.skills.find(s => s.name === name);
                if (node) {
                    return { name: node.name, description: '', source: node.source, skillPath: node.skillPath };
                }
            }
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
            return this.getChildrenForRepo(element);
        }

        if (element instanceof CategoryTreeItem) {
            return element.categoryNode.skills.map(node =>
                new MarketplaceSkillTreeItem(node, this.installedSkillNames.has(node.name))
            );
        }

        return [];
    }

    private async getChildrenForRepo(repoItem: RepoTreeItem): Promise<AnyItem[]> {
        const cacheKey = `${repoItem.repo.owner}/${repoItem.repo.repo}@${repoItem.repo.branch}`;

        if (!this.treeCache.has(cacheKey)) {
            repoItem.state = 'loading';
            repoItem.updateDescription();
            this._onDidChangeTreeData.fire(repoItem);

            try {
                const categories = await this.githubClient.fetchSkillTreeFromRepo(repoItem.repo);
                this.treeCache.set(cacheKey, categories);
                repoItem.state = 'loaded';
                repoItem.skillCount = categories.reduce((sum, c) => sum + c.skills.length, 0);
                repoItem.updateDescription();
                this._onDidChangeTreeData.fire(repoItem);
            } catch {
                repoItem.state = 'error';
                repoItem.updateDescription();
                this._onDidChangeTreeData.fire(repoItem);
                const errItem = new vscode.TreeItem('Failed to load. Check network or token.');
                errItem.iconPath = new vscode.ThemeIcon('warning');
                return [errItem as unknown as AnyItem];
            }
        }

        const categories = this.treeCache.get(cacheKey)!;

        if (categories.length === 1 && categories[0].name === '') {
            return categories[0].skills.map(node =>
                new MarketplaceSkillTreeItem(node, this.installedSkillNames.has(node.name))
            );
        }

        return categories.map(cat => new CategoryTreeItem(cat, repoItem.repo));
    }

    private getSearchResults(): AnyItem[] {
        const all = this.getSkills();
        const filtered = all.filter(s => s.name.toLowerCase().includes(this.searchQuery));

        if (filtered.length === 0) {
            const noRes = new vscode.TreeItem(`No results for "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
            noRes.iconPath = new vscode.ThemeIcon('search-stop');
            return [noRes as unknown as AnyItem];
        }

        return filtered.map(s =>
            new MarketplaceSkillTreeItem(
                { name: s.name, skillPath: s.skillPath, source: s.source },
                this.installedSkillNames.has(s.name)
            )
        );
    }
}

export function resolveGlobalSkillsPath(): string {
    return path.join(os.homedir(), '.open-skills');
}

export type { AnyItem as MarketplaceTreeItem };