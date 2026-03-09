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
        this.iconPath = new vscode.ThemeIcon('extensions');
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
    private installedSkillNames: Set<string> = new Set();

    // Trigram search index
    private readonly TSIZE = 17576; // 26^3 alphabet slots
    private trigramIdx: (number[] | null)[] = [];
    private indexedNames: string[] = [];
    private indexDirty = true;

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
                    this.indexDirty = true;
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
        this.indexDirty = true;
        this._onDidChangeTreeData.fire();
        this.prefetchAll();
    }

    setInstalledSkills(names: Set<string>): void {
        this.installedSkillNames = names;
        this._onDidChangeTreeData.fire();
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

    searchSkills(query: string): Array<{ skill: MarketplaceSkill; installed: boolean }> {
        if (!query) { return []; }
        const all = this.getSkills();
        const ranked = this.searchByTrigram(query.toLowerCase());
        if (ranked.length === 0) { return []; }
        const rankMap = new Map(ranked.map((n, i) => [n, i]));
        return all
            .filter(s => rankMap.has(s.name))
            .sort((a, b) => (rankMap.get(a.name) ?? Infinity) - (rankMap.get(b.name) ?? Infinity))
            .map(s => ({ skill: s, installed: this.installedSkillNames.has(s.name) }));
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
                this.indexDirty = true;
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

    private rebuildIndex(): void {
        const names: string[] = [];
        for (const cats of this.treeCache.values()) {
            for (const cat of cats) {
                for (const node of cat.skills) { names.push(node.name); }
            }
        }
        this.indexedNames = names;
        const idx = new Array<number[] | null>(this.TSIZE).fill(null);
        for (let i = 0; i < names.length; i++) {
            const s = names[i].toLowerCase();
            for (let j = 0; j + 2 < s.length; j++) {
                const c0 = s.charCodeAt(j)     - 97;
                const c1 = s.charCodeAt(j + 1) - 97;
                const c2 = s.charCodeAt(j + 2) - 97;
                if (c0 < 0 || c0 > 25 || c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) { continue; }
                const t = c0 * 961 + c1 * 31 + c2;
                if (!idx[t]) { idx[t] = []; }
                idx[t].push(i);
            }
        }
        this.trigramIdx = idx;
        this.indexDirty = false;
    }

    private searchByTrigram(query: string): string[] {
        if (this.indexDirty) { this.rebuildIndex(); }
        const names = this.indexedNames;
        const q = query.toLowerCase();

        // Short query — trigrams need ≥3 chars, fall back to substring
        if (q.length < 3) {
            return names.filter(n => n.toLowerCase().includes(q));
        }

        const scores = new Int16Array(names.length);
        const seen   = new Uint8Array(this.TSIZE);

        for (let i = 0; i + 2 < q.length; i++) {
            const c0 = q.charCodeAt(i)     - 97;
            const c1 = q.charCodeAt(i + 1) - 97;
            const c2 = q.charCodeAt(i + 2) - 97;
            if (c0 < 0 || c0 > 25 || c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) { continue; }
            const t = c0 * 961 + c1 * 31 + c2;
            if (seen[t]) { continue; }
            seen[t] = 1;
            const hits = this.trigramIdx[t];
            if (!hits) { continue; }
            for (let k = 0; k < hits.length; k++) { scores[hits[k]]++; }
        }

        const flat: number[] = [];
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] > 0) { flat.push(i, scores[i]); }
        }
        const pairs = flat.length >> 1;
        const order = Array.from({ length: pairs }, (_, i) => i);
        order.sort((a, b) => flat[b * 2 + 1] - flat[a * 2 + 1]);
        return order.map(i => names[flat[i * 2]]);
    }
}

export function resolveGlobalSkillsPath(): string {
    return path.join(os.homedir(), '.open-skills');
}

export type { AnyItem as MarketplaceTreeItem };