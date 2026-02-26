import * as vscode from "vscode";
import { ExtensionConfig, FolderStructure, EXTENSION_ID } from "../types";

const KEY = {
    ONBOARDING_COMPLETED: `${EXTENSION_ID}.onboardingCompleted`,
    IDE_TYPE: `${EXTENSION_ID}.ideType`,
    FOLDER_STRUCTURE: `${EXTENSION_ID}.folderStructure`,
    CUSTOM_SCAN_PATHS: `${EXTENSION_ID}.customScanPaths`,
    TARGET_IMPORT_PATH: `${EXTENSION_ID}.targetImportPath`,
} as const;

export class ConfigService {
    private readonly globalState: vscode.Memento;

    constructor(globalState: vscode.Memento) {
        this.globalState = globalState;
    }

    getConfig(): ExtensionConfig {
        const ws = vscode.workspace.getConfiguration(EXTENSION_ID);
        return {
            onboardingCompleted: this.globalState.get(KEY.ONBOARDING_COMPLETED, false),
            ideType: this.globalState.get(KEY.IDE_TYPE, this.detectIde()),
            folderStructure: this.globalState.get(
                KEY.FOLDER_STRUCTURE,
                FolderStructure.AutoDetect
            ),
            customScanPaths: ws.get<string[]>("customScanPaths") || [],
            targetImportPath: ws.get<string>("targetImportPath") || ".agent/skills",
            globalSkillsPath: ws.get<string>("globalSkillsPath") || "~/open-skills",
            showStatusBar: ws.get<boolean>("showStatusBar") ?? true,
            scanOnStartup: ws.get<boolean>("scanOnStartup") ?? true,
        };
    }

    async setOnboardingCompleted(
        ideType: string,
        folderStructure: FolderStructure
    ): Promise<void> {
        await this.globalState.update(KEY.ONBOARDING_COMPLETED, true);
        await this.globalState.update(KEY.IDE_TYPE, ideType);
        await this.globalState.update(KEY.FOLDER_STRUCTURE, folderStructure);
    }

    async resetOnboarding(): Promise<void> {
        await this.globalState.update(KEY.ONBOARDING_COMPLETED, false);
    }

    detectIde(): string {
        const name = vscode.env.appName.toLowerCase();
        if (name.includes("cursor")) {
            return "Cursor";
        }
        if (name.includes("codium") || name.includes("vscodium")) {
            return "VSCodium";
        }
        if (name.includes("insiders")) {
            return "VS Code Insiders";
        }
        return "VS Code";
    }
}
