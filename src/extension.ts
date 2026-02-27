import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { SkillScanner } from "./services/SkillScanner";
import { GapAnalyzer } from "./services/GapAnalyzer";
import { ConfigService } from "./services/ConfigService";
import { SkillHoverProvider, SkillDecorationProvider } from "./decorations/SkillHoverProvider";
import { SkillTreeProvider, SkillTreeItem } from "./providers/SkillTreeProvider";
import { MarketplaceTreeProvider } from "./providers/MarketplaceTreeProvider";
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
	vscode.window.registerTreeDataProvider("openSkillsMarketplaceView", marketplaceProvider);

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
			const globalDir = resolveGlobalPath(configService.getConfig().globalSkillsPath);
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
			if (!skill) {
				return;
			}

			try {
				const uri = vscode.Uri.file(skill.path);
				const content = await vscode.workspace.fs.readFile(uri);
				const text = Buffer.from(content).toString("utf-8");

				const panel = vscode.window.createWebviewPanel(
					"openSkills.skillPreview",
					`Skill: ${skill.name}`,
					vscode.ViewColumn.One,
					{ enableScripts: true }
				);

				let renderedHtml = `<pre>${escapeHtml(text)}</pre>`;
				try {
					const rendered: string = await vscode.commands.executeCommand("markdown.api.render", text);
					if (rendered) {
						renderedHtml = rendered;
					}
				} catch {
					// fallback to <pre>
				}

				panel.webview.html = buildSkillPreviewHtml(skill.name, skill.description, skill.source, renderedHtml);
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
					const targetPath = currentConfig.targetImportPath || ".agent/skills";

					const skillDir = vscode.Uri.file(path.join(workspaceRoot, targetPath, skill.name));
					await vscode.workspace.fs.createDirectory(skillDir);

					for (const file of files) {
						const fileUri = vscode.Uri.file(path.join(skillDir.fsPath, file.path));
						const dirUri = vscode.Uri.file(path.dirname(fileUri.fsPath));

						await vscode.workspace.fs.createDirectory(dirUri);
						await vscode.workspace.fs.writeFile(fileUri, Buffer.from(file.content, 'utf-8'));
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
			const skill: MarketplaceSkill = arg?.skill || arg;
			if (!skill) {
				return;
			}

			const panel = vscode.window.createWebviewPanel(
				'marketplaceSkillDetails',
				`Skill: ${skill.name}`,
				vscode.ViewColumn.One,
				{ enableScripts: true }
			);

			let renderedHtml = `<pre>${escapeHtml(skill.fullContent)}</pre>`;
			try {
				const rendered: string = await vscode.commands.executeCommand('markdown.api.render', skill.fullContent);
				if (rendered) {
					renderedHtml = rendered;
				}
			} catch {
				// fallback
			}

			const isInstalled = skills.some(s => s.normalizedName === skill.name.toLowerCase().replace(/\s+/g, "") && s.status !== "missing");

			panel.webview.html = buildMarketplaceSkillViewHtml(skill, renderedHtml, isInstalled);

			panel.webview.onDidReceiveMessage(async (msg) => {
				if (msg.type === "install") {
					await vscode.commands.executeCommand("open-skills.installMarketplaceSkill", skill);
					panel.dispose();
				}
			});
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("open-skills.addCustomRepository", async () => {
			const owner = await vscode.window.showInputBox({ prompt: "GitHub owner/org name", placeHolder: "e.g. anthropics" });
			if (!owner) {
				return;
			}
			const repo = await vscode.window.showInputBox({ prompt: "Repository name", placeHolder: "e.g. skills" });
			if (!repo) {
				return;
			}
			const skillPath = await vscode.window.showInputBox({ prompt: "Path to skills directory", placeHolder: "e.g. skills", value: "skills" });
			if (!skillPath) {
				return;
			}
			const branch = await vscode.window.showInputBox({ prompt: "Branch name", placeHolder: "main", value: "main" });
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
			const result = await runOnboardingWizard(configService);
			if (!result.completed) {
				return;
			}
		}

		marketplaceProvider.loadSkills();

		if (config.scanOnStartup) {
			await performScan();
		}
	} catch (error) {
		console.error("Open Skills failed to initialize properly:", error);
	}
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function buildSkillPreviewHtml(name: string, description: string, source: string, renderedContent: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(name)}</title>
	<style>
		body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
		.header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 16px; margin-bottom: 20px; }
		h1 { font-size: 22px; margin: 0 0 4px; }
		.meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
		a { color: var(--vscode-textLink-foreground); }
		pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; }
		code { font-family: var(--vscode-editor-font-family); }
	</style>
</head>
<body>
	<div class="header">
		<h1>${escapeHtml(name)}</h1>
		<p class="meta">${escapeHtml(description || "")}</p>
		<p class="meta">Source: <code>${escapeHtml(source)}</code></p>
	</div>
	${renderedContent}
</body>
</html>`;
}

function buildMarketplaceSkillViewHtml(skill: MarketplaceSkill, renderedContent: string, isInstalled: boolean): string {
	const installButton = isInstalled
		? `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:4px;font-size:13px;background:var(--vscode-testing-iconPassed);color:var(--vscode-editor-background);font-weight:600;">$(check) Installed</span>`
		: `<button id="installBtn" style="display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:4px;font-size:13px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;cursor:pointer;font-weight:600;">$(cloud-download) Install to Workspace</button>`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${escapeHtml(skill.name)}</title>
	<style>
		body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
		.header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 16px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: flex-start; }
		.header-left h1 { font-size: 22px; margin: 0 0 6px; }
		.meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 2px 0; }
		.badge { display:inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
		a { color: var(--vscode-textLink-foreground); }
		pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; overflow-x: auto; }
		code { font-family: var(--vscode-editor-font-family); }
		#installBtn:hover { background: var(--vscode-button-hoverBackground); }
	</style>
</head>
<body>
	<div class="header">
		<div class="header-left">
			<h1>${escapeHtml(skill.name)}</h1>
			<p class="meta">${escapeHtml(skill.description)}</p>
			<p class="meta">Source: <code>${escapeHtml(skill.source.owner)}/${escapeHtml(skill.source.repo)}</code></p>
			${skill.license ? `<p class="meta">License: <span class="badge">${escapeHtml(skill.license)}</span></p>` : ""}
		</div>
		<div class="header-right" style="padding-top:4px;">
			${installButton}
		</div>
	</div>
	${renderedContent}
	<script>
		const vscode = acquireVsCodeApi();
		const btn = document.getElementById('installBtn');
		if (btn) {
			btn.addEventListener('click', () => {
				btn.disabled = true;
				btn.textContent = 'Installing...';
				vscode.postMessage({ type: 'install' });
			});
		}
	</script>
</body>
</html>`;
}

export function deactivate(): void { }
