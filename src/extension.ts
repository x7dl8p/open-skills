import * as vscode from "vscode";
import * as path from "path";
import { SkillScanner, resolveHomePath } from "./services/SkillScanner";
import { GapAnalyzer } from "./services/GapAnalyzer";
import { ConfigService } from "./services/ConfigService";
import { SkillHoverProvider, SkillDecorationProvider } from "./decorations/SkillHoverProvider";
import { SkillTreeProvider } from "./providers/SkillTreeProvider";
import { MarketplaceTreeProvider, resolveGlobalSkillsPath } from "./providers/MarketplaceTreeProvider";
import { GitHubSkillsClient } from "./github/GitHubSkillsClient";
import { runOnboardingWizard } from "./onboarding/OnboardingWizard";
import { showAboutPanel } from "./webviews/AboutPanel";
import { GapAnalysisPanel } from "./webviews/GapAnalysisPanel";
import { SkillDefinition, MarketplaceSkill } from "./types";

import { DEFAULT_SCAN_PATHS } from "./constants";

const ANALYTICS_KEY = "openSkills.analytics";

interface SkillAnalytics {
	totalInstalled: number;
	totalDeleted: number;
	totalImported: number;
	lastScanDate: string;
}

function loadAnalytics(state: vscode.Memento): SkillAnalytics {
	return state.get<SkillAnalytics>(ANALYTICS_KEY, {
		totalInstalled: 0,
		totalDeleted: 0,
		totalImported: 0,
		lastScanDate: "",
	});
}

async function saveAnalytics(state: vscode.Memento, analytics: SkillAnalytics): Promise<void> {
	await state.update(ANALYTICS_KEY, analytics);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	let skills: SkillDefinition[] = [];

	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return;
	}
	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	const configService = new ConfigService(context.globalState);
	const config = configService.getConfig();

	const globalSkillsPath = resolveGlobalSkillsPath();

	const skillScanner = new SkillScanner(
		workspaceRoot,
		config.customScanPaths,
		globalSkillsPath,
		config.folderStructure
	);
	const gapAnalyzer = new GapAnalyzer(workspaceRoot);
	const treeProvider = new SkillTreeProvider();
	const hoverProvider = new SkillHoverProvider();
	const decorationProvider = new SkillDecorationProvider();

	const githubClient = new GitHubSkillsClient(context);
	const marketplaceProvider = new MarketplaceTreeProvider(githubClient, context);
	const analytics = loadAnalytics(context.globalState);

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
		vscode.window.createTreeView("openSkillsMarketplaceView", {
			treeDataProvider: marketplaceProvider,
			showCollapseAll: true,
		})
	);
	marketplaceProvider.prefetchAll();

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

				const installedSet = new Set(skills.filter(s => s.status !== "missing").map(s => s.name));
				marketplaceProvider.setInstalledSkills(installedSet);

				hoverProvider.updateSkills(skills);
				decorationProvider.updateSkills(skills);
				treeProvider.refresh(skills);

				analytics.lastScanDate = new Date().toISOString();
				await saveAnalytics(context.globalState, analytics);

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
				analytics.totalImported++;
				await saveAnalytics(context.globalState, analytics);
				vscode.window.showInformationMessage(`Skill "${skill.name}" imported to workspace!`);
				await performScan();
			}
		} else {
			const globalDir = resolveGlobalSkillsPath();
			const success = await gapAnalyzer.importSkill(skill, globalDir);
			if (success) {
				analytics.totalImported++;
				await saveAnalytics(context.globalState, analytics);
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
		vscode.commands.registerCommand("open-skills.previewSkill", async (arg: any) => {
			const skill = extractSkill(arg);
			if (!skill) { return; }
			try {
				await vscode.commands.executeCommand("markdown.showPreview", vscode.Uri.file(skill.path));
			} catch {
				vscode.window.showErrorMessage(`Failed to open skill: ${skill.name}`);
			}
		})
	);

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
			} catch {
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
					analytics.totalImported += imported;
					await saveAnalytics(context.globalState, analytics);
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
						analytics.totalDeleted++;
						await saveAnalytics(context.globalState, analytics);
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
		vscode.commands.registerCommand("open-skills.refreshMarketplace", async () => {
			await marketplaceProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.searchMarketplace", async () => {
			const query = await vscode.window.showInputBox({
				prompt: "Filter marketplace skills",
				value: marketplaceProvider.currentSearch(),
				placeHolder: "e.g. typescript, react, agent…",
			});
			if (query !== undefined) {
				marketplaceProvider.setSearchQuery(query);
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.clearMarketplaceSearch", () => {
			marketplaceProvider.clearSearch();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.installMarketplaceSkill", async (arg: any) => {
			const skill: MarketplaceSkill = arg?.skill || arg;
			if (!skill) {
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Installing ${skill.name}...`,
				cancellable: false
			}, async () => {
				try {
					const files = await githubClient.fetchSkillFiles(skill);

					const currentConfig = configService.getConfig();
					const targetPath = path.normalize(currentConfig.targetImportPath || ".agent/skills");

					const skillDir = vscode.Uri.file(path.join(workspaceRoot, targetPath, skill.name));
					await vscode.workspace.fs.createDirectory(skillDir);

					for (const file of files) {
						const relativeParts = file.path.split("/");
						const fileUri = vscode.Uri.file(path.join(skillDir.fsPath, ...relativeParts));
						const dirUri = vscode.Uri.file(path.dirname(fileUri.fsPath));

						await vscode.workspace.fs.createDirectory(dirUri);
						await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, "utf-8"));
					}

					analytics.totalInstalled++;
					await saveAnalytics(context.globalState, analytics);

					vscode.window.showInformationMessage(`Successfully installed ${skill.name}!`);
					await performScan();

					const installedSet = new Set(skills.filter(s => s.status !== "missing").map(s => s.name));
					marketplaceProvider.setInstalledSkills(installedSet);

				} catch (error) {
					console.error("Installation failed:", error);
					vscode.window.showErrorMessage(`Failed to install ${skill.name}`);
				}
			});
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.viewMarketplaceSkill", async (arg: any) => {
			let skill: MarketplaceSkill = arg?.skill || arg;
			if (!skill) { return; }

			if (!skill.fullContent) {
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: `Loading ${skill.name}...`,
					cancellable: false
				}, async () => {
					const full = await githubClient.fetchSkillMetadata(skill.source, skill.name, skill.skillPath);
					if (full) { skill = full; }
				});
			}

			const doc = await vscode.workspace.openTextDocument({
				content: skill.fullContent || `# ${skill.name}\n\n${skill.description}`,
				language: 'markdown',
			});
			await vscode.commands.executeCommand('markdown.showPreview', doc.uri);

			const isInstalled = skills.some(s => s.normalizedName === skill.name.toLowerCase().replace(/\s+/g, "") && s.status !== "missing");
			if (!isInstalled) {
				const action = await vscode.window.showInformationMessage(
					`Install "${skill.name}" to workspace?`,
					'Install'
				);
				if (action === 'Install') {
					await vscode.commands.executeCommand('open-skills.installMarketplaceSkill', skill);
				}
			}
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.addCustomRepository", async () => {
			const owner = await vscode.window.showInputBox({
				prompt: "Enter the GitHub owner or organization name.",
				placeHolder: "Example: x7dl8p (from github.com/x7dl8p/open-skills)"
			});
			if (!owner) {
				return;
			}
			const repo = await vscode.window.showInputBox({
				prompt: "Enter the repository name.",
				placeHolder: "Example: open-skills (from github.com/x7dl8p/open-skills)"
			});
			if (!repo) {
				return;
			}
			const skillPath = await vscode.window.showInputBox({
				prompt: "Relative path to the skills directory within the repository.",
				placeHolder: "Example: skills or .agent/skills",
				value: "skills"
			});
			if (!skillPath) {
				return;
			}
			const branch = await vscode.window.showInputBox({
				prompt: "The branch name to fetch skills from.",
				placeHolder: "main",
				value: "main"
			});
			if (!branch) {
				return;
			}

			const wsConfig = vscode.workspace.getConfiguration("open-skills");
			const repos = wsConfig.get<any[]>("skillRepositories", []);
			repos.push({ owner, repo, path: skillPath, branch });
			await wsConfig.update("skillRepositories", repos, vscode.ConfigurationTarget.Global);

			vscode.window.showInformationMessage(`Repository ${owner}/${repo} added. Refreshing marketplace...`);
			await marketplaceProvider.refresh();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.openGapAnalysis", () => {
			const activeSkills = skills.filter(s => s.status === "active");
			const globalSkills = skills.filter(s => s.status === "imported");
			const gapResult = gapAnalyzer.analyze(activeSkills, globalSkills);
			const marketplaceCount = marketplaceProvider.getSkills().length;
			GapAnalysisPanel.createOrShow(context, gapResult, importSkill, analytics, marketplaceCount);
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
	}

	try {
		if (!config.onboardingCompleted) {
			await runOnboardingWizard(configService);
		}



		if (config.scanOnStartup) {
			await performScan();
		}
	} catch (error) {
		console.error("Open Skills failed to initialize properly:", error);
	}
}

export function deactivate(): void { }
