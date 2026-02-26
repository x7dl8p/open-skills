import * as vscode from "vscode";
import { SkillDefinition } from "../types";

export class SkillHoverProvider implements vscode.HoverProvider {
    private skills: SkillDefinition[] = [];

    updateSkills(skills: SkillDefinition[]): void {
        this.skills = skills;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Hover | null {
        const wordRange = document.getWordRangeAtPosition(
            position,
            /[a-zA-Z0-9_-]+/
        );
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        const skill = this.skills.find(
            (s) => s.name.toLowerCase() === word.toLowerCase()
        );

        if (!skill) {
            return null;
        }

        const md = new vscode.MarkdownString(undefined, true);
        md.isTrusted = true;

        const importArgs = encodeURIComponent(JSON.stringify(skill));
        const importCmd = vscode.Uri.parse(
            `command:open-skills.importSkillFromHover?${importArgs}`
        );
        const viewCmd = vscode.Uri.parse(
            `command:open-skills.viewSkill?${importArgs}`
        );

        md.appendMarkdown(`**$(symbol-misc) ${skill.name}**\n\n`);

        if (skill.description) {
            md.appendMarkdown(`${skill.description}\n\n`);
        }

        md.appendMarkdown(`---\n\n`);
        md.appendMarkdown(`$(circle-filled) **Status:** ${skill.status}  \n`);
        md.appendMarkdown(`$(folder) **Source:** \`${skill.source}\`  \n`);

        if (skill.dependencies.length > 0) {
            md.appendMarkdown(
                `$(references) **Deps:** ${skill.dependencies.join(", ")}\n\n`
            );
        }

        md.appendMarkdown(`---\n\n`);
        md.appendMarkdown(
            `[$(add) Import Skill](${importCmd})  [$(go-to-file) View](${viewCmd})`
        );

        return new vscode.Hover(md, wordRange);
    }
}

export class SkillDecorationProvider {
    private readonly decorationType: vscode.TextEditorDecorationType;
    private skills: SkillDefinition[] = [];

    constructor() {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: " ⊕",
                color: new vscode.ThemeColor("editorInfo.foreground"),
                margin: "0 0 0 2px",
                fontStyle: "normal",
            },
        });
    }

    updateSkills(skills: SkillDefinition[]): void {
        this.skills = skills;
    }

    updateDecorations(editor: vscode.TextEditor): void {
        const text = editor.document.getText();
        const decorations: vscode.DecorationOptions[] = [];

        for (const skill of this.skills) {
            const regex = new RegExp(`\\b${this.escapeRegex(skill.name)}\\b`, "gi");
            let match: RegExpExecArray | null;

            while ((match = regex.exec(text)) !== null) {
                const startPos = editor.document.positionAt(match.index);
                const endPos = editor.document.positionAt(
                    match.index + match[0].length
                );
                decorations.push({ range: new vscode.Range(startPos, endPos) });
            }
        }

        editor.setDecorations(this.decorationType, decorations);
    }

    dispose(): void {
        this.decorationType.dispose();
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
