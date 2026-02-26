import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { SkillScanner } from "./services/SkillScanner";
import { GapAnalyzer } from "./services/GapAnalyzer";
import { ConfigService } from "./services/ConfigService";
import { SkillHoverProvider, SkillDecorationProvider } from "./decorations/SkillHoverProvider";
import { SkillTreeProvider, SkillTreeItem } from "./providers/SkillTreeProvider";
import { runOnboardingWizard } from "./onboarding/OnboardingWizard";
import { showAboutPanel } from "./webviews/AboutPanel";
import { GapAnalysisPanel } from "./webviews/GapAnalysisPanel";
import { SkillDefinition } from "./types";

import { DEFAULT_SCAN_PATHS } from "./constants";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	let skills: SkillDefinition[] = [];

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return;
	}
	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	const configService = new ConfigService(context.globalState);
	const config = configService.getConfig();

	function resolveGlobalPath(pathStr: string): string {
		if (pathStr.startsWith("~")) {
			return path.join(os.homedir(), pathStr.slice(1));
		}
		return pathStr;
	}

	const globalSkillsPath = resolveGlobalPath(config.globalSkillsPath);

	const skillScanner = new SkillScanner(workspaceRoot, config.customScanPaths, globalSkillsPath);
	const gapAnalyzer = new GapAnalyzer(workspaceRoot);
	const treeProvider = new SkillTreeProvider();
	const hoverProvider = new SkillHoverProvider();
	const decorationProvider = new SkillDecorationProvider();

	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		90
	);
	statusBarItem.command = "open-skills.openGapAnalysis";
	statusBarItem.tooltip = "Open Skills — click to view gap analysis";
	context.subscriptions.push(statusBarItem);

	if (config.showStatusBar) {
		statusBarItem.show();
	}

	vscode.window.registerTreeDataProvider("openSkillsView", treeProvider);

	context.subscriptions.push(
		vscode.languages.registerHoverProvider({ scheme: "file" }, hoverProvider)
	);

	let isScanning = false;
	let scanQueued = false;

	async function performScan(): Promise<void> {
		if (isScanning) {
			scanQueued = true;
			return;
		}
		isScanning = true;
		try {
			await doScan();
		} finally {
			isScanning = false;
			if (scanQueued) {
				scanQueued = false;
				performScan();
			}
		}
	}

	async function doScan(): Promise<void> {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Open Skills",
				cancellable: false
			},
			async (progress) => {
				progress.report({ message: "Scanning workspace for skills..." });

				const scanResult = await skillScanner.scan();
				const rawSkills = scanResult.skills;

				const activeSkillsRaw = rawSkills.filter(s => s.status === "active");
				const globalSkillsRaw = rawSkills.filter(s => s.status === "imported");

				const activeSkills = Array.from(new Map(activeSkillsRaw.map(s => [s.normalizedName, s])).values());
				const globalSkills = Array.from(new Map(globalSkillsRaw.map(s => [s.normalizedName, s])).values());

				const globalKeys = new Set(globalSkills.map(s => s.normalizedName));
				for (const local of activeSkills) {
					local.isSynced = globalKeys.has(local.normalizedName);
				}

				const gapResult = gapAnalyzer.analyze(activeSkills, globalSkills);
				skills = [...activeSkills, ...globalSkills, ...gapResult.missing];

				hoverProvider.updateSkills(skills);
				decorationProvider.updateSkills(skills);
				treeProvider.refresh(skills);

				const currentConfig = configService.getConfig();
				if (currentConfig.showStatusBar) {
					const activeCount = activeSkills.length;
					const missingCount = gapResult.missing.length;

					statusBarItem.text = missingCount > 0
						? `$(warning) Skills: ${activeCount} active, ${missingCount} missing`
						: `$(pass) Skills: ${activeCount} active`;

					statusBarItem.show();
				}

				if (vscode.window.activeTextEditor) {
					decorationProvider.updateDecorations(vscode.window.activeTextEditor);
				}
			}
		);
	}

	async function importSkill(skill: SkillDefinition): Promise<void> {
		if (skill.status === "missing") {
			const currentConfig = configService.getConfig();
			const targetPath: string = currentConfig.targetImportPath || ".agent/skills";
			const targetDir = path.join(workspaceRoot, targetPath);
			const success = await gapAnalyzer.importSkill(skill, targetDir);
			if (success) {
				vscode.window.showInformationMessage(`Skill "${skill.name}" imported to workspace!`);
				await performScan();
			}
		} else {
			const globalDir = resolveGlobalPath(configService.getConfig().globalSkillsPath);
			const success = await gapAnalyzer.importSkill(skill, globalDir);
			if (success) {
				vscode.window.showInformationMessage(`Skill "${skill.name}" copied to My Skills!`);
				await performScan();
			}
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.rescan", async () => {
			await performScan();
		})
	);

	function extractSkill(arg: unknown): SkillDefinition | undefined {
		let candidate: any = undefined;
		if (typeof arg === "object" && arg !== null) {
			if ("skill" in arg && typeof (arg as any).skill?.path === "string") {
				candidate = (arg as any).skill;
			} else if ("path" in arg && typeof (arg as any).path === "string") {
				candidate = arg;
			} else if (Array.isArray(arg) && arg[0] && typeof arg[0].path === "string") {
				candidate = arg[0];
			}
		}

		if (candidate && typeof candidate.path === "string") {
			const testPath = candidate.path;
			const relWorkspace = path.relative(workspaceRoot, testPath);
			const relGlobal = path.relative(globalSkillsPath, testPath);
			const isWorkspace = !relWorkspace.startsWith("..") && !path.isAbsolute(relWorkspace);
			const isGlobal = !relGlobal.startsWith("..") && !path.isAbsolute(relGlobal);

			if (isWorkspace || isGlobal) {
				return candidate as SkillDefinition;
			}
		}
		return undefined;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.viewSkill", async (arg: any) => {
			const skill = extractSkill(arg);
			if (!skill) {
				return;
			}
			try {
				const doc = await vscode.workspace.openTextDocument(
					vscode.Uri.file(skill.path)
				);
				await vscode.window.showTextDocument(doc);
			} catch (e) {
				vscode.window.showErrorMessage(`Failed to open skill: ${skill.name}`);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"open-skills.importSkillFromHover",
			async (arg: any) => {
				const skill = extractSkill(arg);
				if (skill) {
					await importSkill(skill);
				}
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"open-skills.importAllMissingSkills",
			async () => {
				const missingSkills = skills.filter(s => s.status === "missing");
				if (missingSkills.length === 0) {
					return;
				}

				const currentConfig = configService.getConfig();
				const targetPath: string = currentConfig.targetImportPath || ".agent/skills";
				const targetDir = path.join(workspaceRoot, targetPath);

				const results = await Promise.all(
					missingSkills.map(skill => gapAnalyzer.importSkill(skill, targetDir))
				);

				const imported = results.filter(Boolean).length;

				if (imported > 0) {
					vscode.window.showInformationMessage(`Successfully imported ${imported} missing skill${imported > 1 ? 's' : ''}!`);
					await performScan();
				}
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"open-skills.importSkillFromTree",
			async (arg: any) => {
				const skill = extractSkill(arg);
				if (skill) {
					await importSkill(skill);
				}
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"open-skills.deleteSkill",
			async (arg: any) => {
				const skill = extractSkill(arg);
				if (skill) {
					const success = await gapAnalyzer.deleteSkill(skill);
					if (success) {
						vscode.window.showInformationMessage(
							`Skill "${skill.name}" deleted successfully.`
						);
						await performScan();
					}
				}
			}
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.openGapAnalysis", () => {
			const activeSkills = skills.filter(s => s.status === "active");
			const globalSkills = skills.filter(s => s.status === "imported");
			const gapResult = gapAnalyzer.analyze(activeSkills, globalSkills);
			GapAnalysisPanel.createOrShow(context, gapResult, importSkill);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.openAbout", () => {
			showAboutPanel(context);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.openSettings", () => {
			vscode.commands.executeCommand(
				"workbench.action.openSettings",
				"open-skills"
			);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.resetOnboarding", async () => {
			await configService.resetOnboarding();
			vscode.window
				.showInformationMessage(
					"Open Skills: Onboarding reset. Reload to restart setup.",
					"Reload"
				)
				.then((action) => {
					if (action === "Reload") {
						vscode.commands.executeCommand("workbench.action.reloadWindow");
					}
				});
		})
	);

	context.subscriptions.push(decorationProvider);

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor) {
			decorationProvider.updateDecorations(editor);
		}
	});

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	const debouncedScan = (): void => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(performScan, 1200);
	};

	const allScanPaths = [...DEFAULT_SCAN_PATHS, ...config.customScanPaths];
	for (const scanPath of allScanPaths) {
		const pattern = new vscode.RelativePattern(workspaceRoot, `${scanPath}/**/*.md`);
		const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false);
		watcher.onDidCreate(debouncedScan);
		watcher.onDidChange(debouncedScan);
		watcher.onDidDelete(debouncedScan);
		context.subscriptions.push(watcher);
		context.subscriptions.push(watcher);
	}

	try {
		if (!config.onboardingCompleted) {
			const result = await runOnboardingWizard(configService);
			if (!result.completed) {
				return;
			}
		}
		if (config.scanOnStartup) {
			await performScan();
		}
	} catch (error) {
		console.error("Open Skills failed to initialize properly:", error);
	}
}

export function deactivate(): void { }
