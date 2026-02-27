import * as vscode from "vscode";
import * as path from "path";
import { SkillDefinition, SkillStatus, GapAnalysisResult } from "../types";

export class GapAnalyzer {
    private readonly workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    analyze(
        localSkills: SkillDefinition[],
        referenceSkills: SkillDefinition[]
    ): GapAnalysisResult {
        const localNames = new Set(localSkills.map((s) => s.normalizedName));

        const present: SkillDefinition[] = [];
        const missing: SkillDefinition[] = [];

        for (const skill of referenceSkills) {
            if (localNames.has(skill.normalizedName)) {
                present.push({ ...skill, status: SkillStatus.Active });
            } else {
                missing.push({ ...skill, status: SkillStatus.Missing });
            }
        }

        const totalAvailable = referenceSkills.length;
        const coveragePercentage = totalAvailable > 0
            ? Math.round((present.length / totalAvailable) * 100)
            : 100;

        return { present, missing, totalAvailable, coveragePercentage };
    }

    async importSkill(skill: SkillDefinition, targetDir: string): Promise<boolean> {
        try {
            const sourceDir = path.dirname(skill.path);
            const skillFolderName = path.basename(sourceDir);
            const targetPath = path.join(targetDir, skillFolderName);

            await vscode.workspace.fs.copy(
                vscode.Uri.file(sourceDir),
                vscode.Uri.file(targetPath),
                { overwrite: false }
            );

            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error occurred";
            vscode.window.showErrorMessage(
                `Failed to import skill "${skill.name}": ${message}`
            );
            return false;
        }
    }

    async deleteSkill(skill: SkillDefinition): Promise<boolean> {
        try {
            const sourceDir = path.dirname(skill.path);
            await vscode.workspace.fs.delete(vscode.Uri.file(sourceDir), {
                recursive: true,
                useTrash: true,
            });
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error occurred";
            vscode.window.showErrorMessage(
                `Failed to delete skill "${skill.name}": ${message}`
            );
            return false;
        }
    }

    findMissingDependencies(
        skill: SkillDefinition,
        allSkills: SkillDefinition[]
    ): string[] {
        const available = new Set(allSkills.map((s) => s.normalizedName));
        return skill.dependencies.filter(
            (dep) => !available.has(dep.toLowerCase().replace(/\s+/g, ""))
        );
    }
}
