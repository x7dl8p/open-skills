import * as vscode from "vscode";
import * as path from "path";
import {
    SkillDefinition,
    SkillSource,
    SkillStatus,
    SkillScanResult,
    DEFAULT_SCAN_PATHS,
    SKILL_FILE_NAME,
} from "../types";

import * as os from "os";

export class SkillScanner {
    private readonly workspaceRoot: string;
    private readonly customPaths: string[];
    private readonly globalPath: string;
    private cachedResult: SkillScanResult | null = null;

    constructor(workspaceRoot: string, customPaths: string[] = [], globalPath: string) {
        this.workspaceRoot = workspaceRoot;
        this.customPaths = customPaths;
        this.globalPath = globalPath;
    }

    async scan(): Promise<SkillScanResult> {
        const scanPaths = this.resolveScanPaths();
        const skills: SkillDefinition[] = [];

        const results = await Promise.allSettled(
            scanPaths.map((p) => this.scanDirectory(p))
        );

        for (const result of results) {
            if (result.status === "fulfilled") {
                skills.push(...result.value);
            }
        }

        this.cachedResult = {
            skills,
            scanPaths,
            timestamp: Date.now(),
        };

        return this.cachedResult;
    }

    getCachedResult(): SkillScanResult | null {
        return this.cachedResult;
    }

    private resolveScanPaths(): string[] {
        const allPaths = [...DEFAULT_SCAN_PATHS, ...this.customPaths];
        const wsPaths = allPaths.map((p) => path.join(this.workspaceRoot, p));
        wsPaths.push(this.globalPath);
        return wsPaths;
    }

    private async scanDirectory(dirPath: string): Promise<SkillDefinition[]> {
        const skills: SkillDefinition[] = [];

        try {
            const uri = vscode.Uri.file(dirPath);
            const entries = await vscode.workspace.fs.readDirectory(uri);

            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const skillFilePath = path.join(dirPath, name, SKILL_FILE_NAME);
                    const skill = await this.parseSkillFile(skillFilePath, name, dirPath);
                    if (skill) {
                        skills.push(skill);
                    }
                }

                if (name === SKILL_FILE_NAME && type === vscode.FileType.File) {
                    const skill = await this.parseSkillFile(
                        path.join(dirPath, name),
                        path.basename(dirPath),
                        dirPath
                    );
                    if (skill) {
                        skills.push(skill);
                    }
                }
            }
        } catch {
            return skills;
        }

        return skills;
    }

    private async parseSkillFile(
        filePath: string,
        skillName: string,
        basePath: string
    ): Promise<SkillDefinition | null> {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(content).toString("utf-8");

            const source = this.resolveSource(basePath);
            const extractedName = this.extractName(text, skillName);
            return {
                id: this.generateId(filePath),
                name: extractedName,
                normalizedName: extractedName.toLowerCase().replace(/\s+/g, ""),
                path: filePath,
                description: this.extractDescription(text),
                dependencies: this.extractDependencies(text),
                source,
                status: source === SkillSource.Global ? SkillStatus.Imported : SkillStatus.Active,
            };
        } catch {
            return null;
        }
    }

    private generateId(filePath: string): string {
        return filePath
            .replace(this.workspaceRoot, "")
            .replace(/[/\\]/g, "-")
            .replace(/^-/, "")
            .toLowerCase();
    }

    private extractName(content: string, fallback: string): string {
        const h1 = content.match(/^#\s+(.+)$/m);
        if (h1) {
            return h1[1].trim();
        }
        const yaml = content.match(/^name:\s*(.+)$/m);
        if (yaml) {
            return yaml[1].trim();
        }
        return fallback;
    }

    private extractDescription(content: string): string {
        const yaml = content.match(/^description:\s*(.+)$/m);
        if (yaml) {
            return yaml[1].trim();
        }
        const lines = content.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
                return trimmed.substring(0, 200);
            }
        }
        return "";
    }

    private extractDependencies(content: string): string[] {
        const deps: string[] = [];
        const section = content.match(
            /##\s*Dependencies\s*\n([\s\S]*?)(?=\n##|\n$|$)/i
        );
        if (section) {
            for (const line of section[1].split("\n")) {
                const match = line.match(/^[-*]\s+(.+)/);
                if (match) {
                    deps.push(match[1].trim());
                }
            }
        }
        return deps;
    }

    private resolveSource(basePath: string): SkillSource {
        if (basePath.startsWith(this.globalPath)) {
            return SkillSource.Global;
        }
        const relative = basePath.replace(this.workspaceRoot, "");
        if (relative.includes(".cursor/rules")) {
            return SkillSource.CursorRules;
        }
        if (relative.includes(".cursor/skills")) {
            return SkillSource.CursorSkills;
        }
        if (relative.includes(".agent")) {
            return SkillSource.Agent;
        }
        return SkillSource.Custom;
    }
}
