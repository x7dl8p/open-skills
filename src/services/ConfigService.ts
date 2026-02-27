import * as vscode from "vscode";
import { ExtensionConfig, FolderStructure, EXTENSION_ID, IDE_SIGNATURES } from "../types";

const KEY = {
    ONBOARDING_COMPLETED: `${EXTENSION_ID}.onboardingCompleted`,
    IDE_TYPE: `${EXTENSION_ID}.ideType`,
    FOLDER_STRUCTURE: `${EXTENSION_ID}.folderStructure`,
} as const;

export class ConfigService {
    private readonly state: vscode.Memento;

    constructor(globalState: vscode.Memento) {
        this.state = globalState;
    }

    getConfig(): ExtensionConfig {
        const ws = vscode.workspace.getConfiguration(EXTENSION_ID);
        return {
            onboardingCompleted: this.state.get(KEY.ONBOARDING_COMPLETED, false),
            ideType: this.state.get(KEY.IDE_TYPE, this.detectIde()),
            folderStructure: this.state.get(KEY.FOLDER_STRUCTURE, FolderStructure.AutoDetect),
            customScanPaths: ws.get<string[]>("customScanPaths") ?? [],
            targetImportPath: ws.get<string>("targetImportPath") ?? ".agent/skills",
            globalSkillsPath: ws.get<string>("globalSkillsPath") ?? "~/open-skills",
            showStatusBar: ws.get<boolean>("showStatusBar") ?? true,
            scanOnStartup: ws.get<boolean>("scanOnStartup") ?? true,
        };
    }

    async setOnboardingCompleted(ideType: string, folderStructure: FolderStructure): Promise<void> {
        await this.state.update(KEY.ONBOARDING_COMPLETED, true);
        await this.state.update(KEY.IDE_TYPE, ideType);
        await this.state.update(KEY.FOLDER_STRUCTURE, folderStructure);
    }

    async resetOnboarding(): Promise<void> {
        await this.state.update(KEY.ONBOARDING_COMPLETED, false);
    }

    detectIde(): string {
        const appName = vscode.env.appName.toLowerCase();
        const appHost = (vscode.env.appHost ?? "").toLowerCase();
        const combined = `${appName} ${appHost}`;

        for (const { pattern, label } of IDE_SIGNATURES) {
            if (combined.includes(pattern)) {
                return label;
            }
        }

        return vscode.env.appName || "Unknown IDE";
    }
}
