import * as vscode from 'vscode';
import { MarketplaceSkill } from '../types';
import { GitHubSkillsClient } from '../github/GitHubSkillsClient';

export class MarketplaceSkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly skill: MarketplaceSkill,
        public readonly isInstalled: boolean = false
    ) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);

        this.description = this.truncateDescription(skill.description, 60);
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

    private truncateDescription(text: string, maxLength: number): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    }
}

export class SourceTreeItem extends vscode.TreeItem {
    constructor(
        public readonly sourceName: string,
        public readonly skills: MarketplaceSkill[],
        collapsed: boolean
    ) {
        super(
            sourceName,
            collapsed
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded
        );
        this.iconPath = new vscode.ThemeIcon('github');
        this.description = `${skills.length} skill${skills.length !== 1 ? 's' : ''}`;
        this.contextValue = 'marketplaceSource';
    }
}

export class MarketplaceTreeProvider implements vscode.TreeDataProvider<MarketplaceSkillTreeItem | SourceTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MarketplaceSkillTreeItem | SourceTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private skills: MarketplaceSkill[] = [];
    private searchQuery: string = '';
    private installedSkillNames: Set<string> = new Set();
    private isLoading: boolean = false;
    private groupBySource: boolean = true;

    constructor(
        private readonly githubClient: GitHubSkillsClient,
        private readonly context: vscode.ExtensionContext
    ) { }

    async refresh(): Promise<void> {
        this.isLoading = true;
        this._onDidChangeTreeData.fire();

        try {
            this.githubClient.clearCache();
            this.skills = await this.githubClient.fetchAllSkills();
        } catch (error) {
            console.error('Failed to refresh marketplace:', error);
            vscode.window.showErrorMessage('Failed to refresh marketplace. Please check your network connection.');
        } finally {
            this.isLoading = false;
            this._onDidChangeTreeData.fire();
        }
    }

    async loadSkills(): Promise<void> {
        if (this.skills.length === 0 && !this.isLoading) {
            this.isLoading = true;
            this._onDidChangeTreeData.fire();

            try {
                this.skills = await this.githubClient.fetchAllSkills();
            } catch (error) {
                console.error('Failed to load skills:', error);
            } finally {
                this.isLoading = false;
                this._onDidChangeTreeData.fire();
            }
        }
    }

    setSearchQuery(query: string): void {
        this.searchQuery = query.toLowerCase();
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    clearSearch(): void {
        this.searchQuery = '';
        this._onDidChangeTreeData.fire();
        this.updateSearchContext();
    }

    isSearchActive(): boolean {
        return this.searchQuery.length > 0;
    }

    private updateSearchContext(): void {
        vscode.commands.executeCommand('setContext', 'openSkills:searchActive', this.isSearchActive());
    }

    setInstalledSkills(names: Set<string>): void {
        this.installedSkillNames = names;
        this._onDidChangeTreeData.fire();
    }

    getSkills(): MarketplaceSkill[] {
        return this.skills;
    }

    getSkillByName(name: string): MarketplaceSkill | undefined {
        return this.skills.find(s => s.name === name);
    }

    getTreeItem(element: MarketplaceSkillTreeItem | SourceTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: MarketplaceSkillTreeItem | SourceTreeItem): vscode.ProviderResult<(MarketplaceSkillTreeItem | SourceTreeItem)[]> {
        if (this.isLoading) {
            return [this.createLoadingItem()];
        }

        if (!element) {
            const filteredSkills = this.getFilteredSkills();

            if (filteredSkills.length === 0 && this.skills.length === 0) {
                return [this.createEmptyItem()];
            }

            if (filteredSkills.length === 0 && this.searchQuery) {
                return [this.createNoResultsItem()];
            }

            if (this.groupBySource) {
                return this.getSourceGroups(filteredSkills);
            } else {
                return filteredSkills.map(skill =>
                    new MarketplaceSkillTreeItem(skill, this.installedSkillNames.has(skill.name))
                );
            }
        }

        if (element instanceof SourceTreeItem) {
            return element.skills.map(skill =>
                new MarketplaceSkillTreeItem(skill, this.installedSkillNames.has(skill.name))
            );
        }

        return [];
    }

    private getFilteredSkills(): MarketplaceSkill[] {
        if (!this.searchQuery) {
            return this.skills;
        }

        return this.skills.filter(skill =>
            skill.name.toLowerCase().includes(this.searchQuery) ||
            skill.description.toLowerCase().includes(this.searchQuery)
        );
    }

    private getSourceGroups(skills: MarketplaceSkill[]): SourceTreeItem[] {
        const groups = new Map<string, MarketplaceSkill[]>();

        for (const skill of skills) {
            const key = `${skill.source.owner}/${skill.source.repo}`;
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(skill);
        }

        let isFirst = true;
        const items: SourceTreeItem[] = [];
        for (const [name, skillList] of groups.entries()) {
            items.push(new SourceTreeItem(name, skillList, !isFirst));
            isFirst = false;
        }
        return items;
    }

    private createLoadingItem(): MarketplaceSkillTreeItem {
        const item = new vscode.TreeItem('Loading skills...', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        return item as unknown as MarketplaceSkillTreeItem;
    }

    private createEmptyItem(): MarketplaceSkillTreeItem {
        const item = new vscode.TreeItem('No skills available', vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('info');
        item.description = 'Click refresh to load skills';
        return item as unknown as MarketplaceSkillTreeItem;
    }

    private createNoResultsItem(): MarketplaceSkillTreeItem {
        const item = new vscode.TreeItem(`No results for "${this.searchQuery}"`, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('search-stop');
        return item as unknown as MarketplaceSkillTreeItem;
    }
}
