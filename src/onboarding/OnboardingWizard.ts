import * as vscode from "vscode";
import { FolderStructure } from "../types";
import { ConfigService } from "../services/ConfigService";

interface OnboardingResult {
    completed: boolean;
    ideType: string;
    folderStructure: FolderStructure;
}

const DEFAULT_RESULT: OnboardingResult = {
    completed: false,
    ideType: "",
    folderStructure: FolderStructure.AutoDetect,
};

const STRUCTURE_OPTIONS = [
    {
        label: "$(folder) Auto-detect",
        description: "Recommended",
        detail: "Detect the best structure for your project automatically",
        value: FolderStructure.AutoDetect,
    },
    {
        label: "$(list-flat) Flat",
        description: "All skills in a single directory",
        detail: "Best for smaller projects with a handful of skills",
        value: FolderStructure.Flat,
    },
    {
        label: "$(list-tree) Hierarchical",
        description: "Skills organized in nested folders",
        detail: "Best for large projects with categorized skills",
        value: FolderStructure.Hierarchical,
    },
] as const;

const STRUCTURE_DESCRIPTIONS: Record<FolderStructure, string> = {
    [FolderStructure.AutoDetect]:
        "Will scan .agent/skills, .cursor/rules, .cursor/skills, .claude/skills and any configured custom paths.",
    [FolderStructure.Flat]:
        "All skills will be stored flat inside your target import directory.",
    [FolderStructure.Hierarchical]:
        "Skills will be organized by category in nested subfolders.",
};

export async function runOnboardingWizard(
    configService: ConfigService
): Promise<OnboardingResult> {
    const ideType = configService.detectIde();

    const welcome = await vscode.window.showInformationMessage(
        `Welcome to Open Skills -- your AI skill manager. Detected IDE: ${ideType}. Run quick setup?`,
        { modal: true },
        "Get Started",
        "Skip"
    );

    if (welcome !== "Get Started") {
        return { ...DEFAULT_RESULT, ideType };
    }

    const structurePick = await vscode.window.showQuickPick(
        [...STRUCTURE_OPTIONS],
        {
            title: "Open Skills Setup (2/3) -- Folder Structure",
            placeHolder: "Choose your preferred skill organization",
            ignoreFocusOut: true,
        }
    );

    if (!structurePick) {
        return { ...DEFAULT_RESULT, ideType };
    }

    const folderStructure = structurePick.value;

    const confirm = await vscode.window.showInformationMessage(
        `Recommendation for ${folderStructure}: ${STRUCTURE_DESCRIPTIONS[folderStructure]} Ready to finish setup?`,
        { modal: true },
        "Finish",
        "Back"
    );

    if (confirm !== "Finish") {
        return { completed: false, ideType, folderStructure };
    }

    await configService.setOnboardingCompleted(ideType, folderStructure);

    vscode.window.showInformationMessage(
        "Open Skills is ready. Your workspace will be scanned now.",
        "Open Skill Tree"
    ).then((action) => {
        if (action === "Open Skill Tree") {
            vscode.commands.executeCommand("openSkillsView.focus");
        }
    });

    return { completed: true, ideType, folderStructure };
}
