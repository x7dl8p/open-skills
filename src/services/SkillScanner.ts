import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import {
    SkillDefinition,
    SkillSource,
    SkillStatus,
    SkillScanResult,
    DEFAULT_SCAN_PATHS,
    SKILL_FILE_NAME,
} from "../types";

const SOURCE_PATTERNS: ReadonlyArray<{ match: string; source: SkillSource }> = [
    { match: path.join(".cursor", "rules"), source: SkillSource.CursorRules },
    { match: path.join(".cursor", "skills"), source: SkillSource.CursorSkills },
    { match: `.agent`, source: SkillSource.Agent },
];

function normalizePath(p: string): string {
    return p.split(path.sep).join("/").toLowerCase();
}

export class SkillScanner {
    private readonly workspaceRoot: string;
    private readonly customPaths: string[];
    private readonly globalPath: string;
    private cachedResult: SkillScanResult | null = null;

    constructor(workspaceRoot: string, customPaths: string[] = [], globalPath: string) {
        this.workspaceRoot = workspaceRoot;
        this.customPaths = customPaths;
        this.globalPath = path.normalize(globalPath);
    }

    async scan(): Promise<SkillScanResult> {
        const scanPaths = this.resolveScanPaths();

        const results = await Promise.allSettled(
            scanPaths.map((p) => this.scanDirectory(p))
        );

        const skills = results.flatMap((r) =>
            r.status === "fulfilled" ? r.value : []
        );

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
        const resolved = allPaths.map((p) => path.join(this.workspaceRoot, p));
        resolved.push(this.globalPath);
        return resolved;
    }

    private async scanDirectory(dirPath: string): Promise<SkillDefinition[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(
                vscode.Uri.file(dirPath)
            );

            const promises = entries.map(([name, type]) => {
                if (type === vscode.FileType.Directory) {
                    return this.parseSkillFile(
                        path.join(dirPath, name, SKILL_FILE_NAME),
                        name,
                        dirPath
                    );
                }
                if (name === SKILL_FILE_NAME && type === vscode.FileType.File) {
                    return this.parseSkillFile(
                        path.join(dirPath, name),
                        path.basename(dirPath),
                        dirPath
                    );
                }
                return Promise.resolve(null);
            });

            const results = await Promise.all(promises);
            return results.filter((s): s is SkillDefinition => s !== null);
        } catch {
            return [];
        }
    }

    private async parseSkillFile(
        filePath: string,
        skillName: string,
        basePath: string
    ): Promise<SkillDefinition | null> {
        try {
            const content = await vscode.workspace.fs.readFile(
                vscode.Uri.file(filePath)
            );
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
        const rel = path.relative(this.workspaceRoot, filePath);
        return rel.split(path.sep).join("-").toLowerCase();
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
        const section = content.match(
            /##\s*Dependencies\s*\n([\s\S]*?)(?=\n##|\n$|$)/i
        );
        if (!section) {
            return [];
        }
        return section[1]
            .split("\n")
            .map((line) => line.match(/^[-*]\s+(.+)/))
            .filter((m): m is RegExpMatchArray => m !== null)
            .map((m) => m[1].trim());
    }

    private resolveSource(basePath: string): SkillSource {
        const normalizedBase = path.normalize(basePath);

        if (normalizePath(normalizedBase).startsWith(normalizePath(this.globalPath))) {
            return SkillSource.Global;
        }

        const relative = path.relative(this.workspaceRoot, normalizedBase);
        const normalizedRelative = normalizePath(relative);

        for (const { match, source } of SOURCE_PATTERNS) {
            if (normalizedRelative.includes(normalizePath(match))) {
                return source;
            }
        }

        return SkillSource.Custom;
    }
}

export function resolveHomePath(p: string): string {
    if (p.startsWith("~")) {
        return path.join(os.homedir(), p.slice(1));
    }
    return path.normalize(p);
}
