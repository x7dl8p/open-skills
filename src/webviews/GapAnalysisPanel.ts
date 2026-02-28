import * as vscode from "vscode";
import * as path from "path";
import { GapAnalysisResult, SkillDefinition, SkillStatus } from "../types";

interface SkillAnalytics {
  totalInstalled: number;
  totalDeleted: number;
  totalImported: number;
  lastScanDate: string;
}

export class GapAnalysisPanel {
  private static currentPanel: GapAnalysisPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly onImport: (skill: SkillDefinition) => Promise<void>;

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    onImport: (skill: SkillDefinition) => Promise<void>
  ) {
    this.panel = panel;
    this.context = context;
    this.onImport = onImport;

    this.panel.onDidDispose(() => {
      GapAnalysisPanel.currentPanel = undefined;
    });

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "import" && msg.skill) {
        await this.onImport(msg.skill as SkillDefinition);
      }
    });
  }

  static createOrShow(
    context: vscode.ExtensionContext,
    result: GapAnalysisResult,
    onImport: (skill: SkillDefinition) => Promise<void>,
    analytics?: SkillAnalytics,
    marketplaceCount?: number
  ): void {
    if (GapAnalysisPanel.currentPanel) {
      GapAnalysisPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      GapAnalysisPanel.currentPanel.update(result, analytics, marketplaceCount);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "openSkills.gapAnalysis",
      "Dashboard — Open Skills",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    GapAnalysisPanel.currentPanel = new GapAnalysisPanel(
      panel,
      context,
      onImport
    );
    GapAnalysisPanel.currentPanel.update(result, analytics, marketplaceCount);
    context.subscriptions.push(panel);
  }

  update(result: GapAnalysisResult, analytics?: SkillAnalytics, marketplaceCount?: number): void {
    this.panel.webview.html = this.buildHtml(result, analytics, marketplaceCount);
  }

  private buildHtml(result: GapAnalysisResult, analytics?: SkillAnalytics, marketplaceCount?: number): string {
    const { present, missing, coveragePercentage } = result;

    const logoPath = vscode.Uri.file(
      path.join(this.context.extensionPath, "assets", "open-skills.png")
    );
    const logoUri = this.panel.webview.asWebviewUri(logoPath);

    const barColor =
      coveragePercentage >= 75
        ? "var(--vscode-testing-iconPassed)"
        : coveragePercentage >= 40
          ? "var(--vscode-editorWarning-foreground)"
          : "var(--vscode-editorError-foreground)";

    const installed = analytics?.totalInstalled ?? 0;
    const deleted = analytics?.totalDeleted ?? 0;
    const imported = analytics?.totalImported ?? 0;
    const lastScan = analytics?.lastScanDate
      ? new Date(analytics.lastScanDate).toLocaleString()
      : "Never";
    const mpCount = marketplaceCount ?? 0;

    const missingRows = missing
      .map(
        (s) => `
		<tr>
		  <td>${this.esc(s.name)}</td>
		  <td><code>${this.esc(s.source)}</code></td>
		  <td>${this.esc(s.description.substring(0, 80))}${s.description.length > 80 ? "…" : ""}</td>
		  <td>
			<button class="vscode-button" data-skill='${JSON.stringify(s).replace(/'/g, "&#39;")}'>
			  Import
			</button>
		  </td>
		</tr>`
      )
      .join("");

    const presentRows = present
      .map(
        (s) => `
		<tr>
		  <td>${this.esc(s.name)}</td>
		  <td><code>${this.esc(s.source)}</code></td>
		  <td>${this.esc(s.description.substring(0, 80))}${s.description.length > 80 ? "…" : ""}</td>
		  <td><span class="badge-ok">Active</span></td>
		</tr>`
      )
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Open Skills Dashboard</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 32px 48px;
      max-width: 960px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 8px;
    }
    .logo {
      width: 40px;
      height: 40px;
      object-fit: contain;
    }
    h1 { font-size: 24px; font-weight: 600; margin: 0; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 32px; font-size: 14px; }
    .analytics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 32px;
    }
    .analytics-card {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px 20px;
      text-align: center;
    }
    .analytics-card .value {
      font-size: 32px;
      font-weight: 700;
      display: block;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }
    .analytics-card .label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .coverage-bar-wrap {
      margin-bottom: 32px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      padding: 16px;
      border-radius: 8px;
    }
    .coverage-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-weight: 600;
      font-size: 14px;
    }
    .bar-bg {
      height: 10px;
      background: var(--vscode-panel-border);
      border-radius: 5px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      background: ${barColor};
      transition: width 0.6s cubic-bezier(0.23, 1, 0.32, 1);
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin: 32px 0 16px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 8px;
    }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; padding: 12px 8px; font-size: 12px; color: var(--vscode-descriptionForeground); }
    td { padding: 14px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
    .vscode-button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
    }
    .vscode-button:hover { background: var(--vscode-button-hoverBackground); }
    .badge-ok {
      background: var(--vscode-testing-iconPassed);
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="${logoUri}" alt="Open Skills" class="logo">
    <h1>Open Skills Dashboard</h1>
  </div>
  <p class="subtitle">Unified view of your workspace skills, gaps, and marketplace analytics.</p>

  <div class="analytics-grid">
    <div class="analytics-card">
      <span class="value">${mpCount}</span>
      <span class="label">Available in Marketplace</span>
    </div>
    <div class="analytics-card">
      <span class="value">${installed}</span>
      <span class="label">Installed Lifetime</span>
    </div>
    <div class="analytics-card">
      <span class="value">${imported}</span>
      <span class="label">Imported Lifetime</span>
    </div>
    <div class="analytics-card">
      <span class="value">${present.length}</span>
      <span class="label">Active in Workspace</span>
    </div>
  </div>

  <div class="coverage-bar-wrap">
    <div class="coverage-label">
      <span>Workspace Skill Coverage</span>
      <span>${coveragePercentage}%</span>
    </div>
    <div class="bar-bg">
      <div class="bar-fill" style="width: ${coveragePercentage}%"></div>
    </div>
    <div style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 12px;">
      Total Available Skills across all sources: ${present.length + missing.length} | Last Scan: ${lastScan}
    </div>
  </div>

  ${missing.length > 0
        ? `
    <div class="section-title">Missing Skills (${missing.length})</div>
    <table>
      <thead>
        <tr>
          <th style="width: 15%">Name</th>
          <th style="width: 25%">Source</th>
          <th style="width: 45%">Description</th>
          <th style="width: 15%">Action</th>
        </tr>
      </thead>
      <tbody>
        ${missingRows}
      </tbody>
    </table>
  `
        : `
    <div class="coverage-bar-wrap" style="text-align: center; background: rgba(76, 175, 80, 0.1); border-color: var(--vscode-testing-iconPassed);">
      <div style="font-size: 16px; font-weight: 600; color: var(--vscode-testing-iconPassed);">
        $(check) All skills are up to date!
      </div>
      <div style="font-size: 13px; color: var(--vscode-foreground); margin-top: 4px;">
        Your workspace matches the global library and standard definitions.
      </div>
    </div>
  `
      }

  <div class="section-title">Active Skills (${present.length})</div>
  <table>
    <thead>
      <tr>
        <th style="width: 15%">Name</th>
        <th style="width: 25%">Source</th>
        <th style="width: 45%">Description</th>
        <th style="width: 15%">Status</th>
      </tr>
    </thead>
    <tbody>
      ${presentRows}
    </tbody>
  </table>

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.vscode-button').forEach(btn => {
      btn.addEventListener('click', () => {
        const skill = JSON.parse(btn.getAttribute('data-skill'));
        btn.disabled = true;
        btn.textContent = 'Importing...';
        vscode.postMessage({ type: 'import', skill });
      });
    });
  </script>
</body>
</html>`;
  }

  private esc(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
