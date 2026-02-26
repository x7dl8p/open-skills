import * as vscode from "vscode";
import { SkillDefinition, SkillStatus } from "../types";

type GroupKey = "active" | "missing" | "imported";

interface SkillGroup {
    label: string;
    status: SkillStatus;
    icon: string;
    contextValue: string;
}

const GROUPS: Record<GroupKey, SkillGroup> = {
    active: {
        label: "Active",
        status: SkillStatus.Active,
        icon: "pass",
        contextValue: "skillGroupActive",
    },
    missing: {
        label: "Missing",
        status: SkillStatus.Missing,
        icon: "error",
        contextValue: "skillGroupMissing",
    },
    imported: {
        label: "My Skills",
        status: SkillStatus.Imported,
        icon: "library",
        contextValue: "skillGroupImported",
    },
};

export class SkillTreeItem extends vscode.TreeItem {
    readonly skill?: SkillDefinition;
    readonly groupKey?: GroupKey;

    constructor(skill: SkillDefinition) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        this.skill = skill;
        this.description = skill.source;
        this.tooltip = new vscode.MarkdownString(
            `**${skill.name}**\n\n${skill.description || "_No description_"}\n\n**Source:** ${skill.source}`
        );
        if (skill.status === SkillStatus.Active) {
            this.contextValue = skill.isSynced ? "skillItem.active.synced" : "skillItem.active.unsynced";
        } else {
            this.contextValue = `skillItem.${skill.status}`;
        }
        this.command = {
            command: "open-skills.viewSkill",
            title: "View Skill",
            arguments: [skill],
        };

        const iconMap: Record<SkillStatus, string> = {
            [SkillStatus.Active]: "pass",
            [SkillStatus.Missing]: "error",
            [SkillStatus.Imported]: "library",
        };

        this.iconPath = new vscode.ThemeIcon(iconMap[skill.status]);
    }
}

export class SkillGroupItem extends vscode.TreeItem {
    readonly groupKey: GroupKey;

    constructor(groupKey: GroupKey, count: number) {
        const group = GROUPS[groupKey];
        super(
            `${group.label} (${count})`,
            count > 0
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed
        );
        this.groupKey = groupKey;
        this.contextValue = group.contextValue;
        this.iconPath = new vscode.ThemeIcon(group.icon);
    }
}

export class SkillTreeProvider
    implements vscode.TreeDataProvider<SkillTreeItem | SkillGroupItem> {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<
        SkillTreeItem | SkillGroupItem | undefined | null | void
    >();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private skills: SkillDefinition[] = [];

    refresh(skills: SkillDefinition[]): void {
        this.skills = skills;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SkillTreeItem | SkillGroupItem): vscode.TreeItem {
        return element;
    }

    getChildren(
        element?: SkillTreeItem | SkillGroupItem
    ): (SkillTreeItem | SkillGroupItem)[] {
        if (!element) {
            const keys: GroupKey[] = ["active", "missing", "imported"];
            return keys.map((key) => {
                const count = this.skills.filter(
                    (s) => s.status === GROUPS[key].status
                ).length;
                return new SkillGroupItem(key, count);
            });
        }

        if (element instanceof SkillGroupItem) {
            return this.skills
                .filter((s) => s.status === GROUPS[element.groupKey].status)
                .map((s) => new SkillTreeItem(s));
        }

        return [];
    }
}
