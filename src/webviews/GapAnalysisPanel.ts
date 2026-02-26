import * as vscode from "vscode";
import { GapAnalysisResult, SkillDefinition, SkillStatus } from "../types";

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
        onImport: (skill: SkillDefinition) => Promise<void>
    ): void {
        if (GapAnalysisPanel.currentPanel) {
            GapAnalysisPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
            GapAnalysisPanel.currentPanel.update(result);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            "openSkills.gapAnalysis",
            "Gap Analysis — Open Skills",
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        GapAnalysisPanel.currentPanel = new GapAnalysisPanel(
            panel,
            context,
            onImport
        );
        GapAnalysisPanel.currentPanel.update(result);
        context.subscriptions.push(panel);
    }

    update(result: GapAnalysisResult): void {
        this.panel.webview.html = this.buildHtml(result);
    }

    private buildHtml(result: GapAnalysisResult): string {
        const { present, missing, coveragePercentage } = result;

        const barColor =
            coveragePercentage >= 75
                ? "var(--vscode-testing-iconPassed)"
                : coveragePercentage >= 40
                    ? "var(--vscode-editorWarning-foreground)"
                    : "var(--vscode-editorError-foreground)";

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
  <title>Gap Analysis</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 24px 32px;
      max-width: 900px;
      margin: 0 auto;
    }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 24px; }
    .coverage-bar-wrap {
      margin-bottom: 24px;
    }
    .coverage-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
    }
    .coverage-bar {
      height: 8px;
      background: var(--vscode-input-background);
      border-radius: 4px;
      overflow: hidden;
    }
    .coverage-fill {
      height: 100%;
      border-radius: 4px;
      background: ${barColor};
      width: ${coveragePercentage}%;
      transition: width 0.3s;
    }
    h2 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--vscode-descriptionForeground);
      margin: 24px 0 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      vertical-align: middle;
    }
    tr:hover td {
      background: var(--vscode-list-hoverBackground);
    }
    code {
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      padding: 1px 5px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 3px;
    }
    .badge-ok {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-editor-background);
      font-weight: 600;
    }
    .vscode-button {
      padding: 4px 12px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      font-size: 12px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
    }
    .vscode-button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .empty {
      text-align: center;
      padding: 24px;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h1>Gap Analysis</h1>
  <p class="subtitle">${present.length} active &nbsp;&middot;&nbsp; ${missing.length} missing &nbsp;&middot;&nbsp; ${result.totalAvailable} total</p>

  <div class="coverage-bar-wrap">
    <div class="coverage-label">
      <span>Coverage</span>
      <span>${coveragePercentage}%</span>
    </div>
    <div class="coverage-bar">
      <div class="coverage-fill"></div>
    </div>
  </div>

  ${missing.length > 0
                ? `<h2>Missing (${missing.length})</h2>
        <table>
          <thead><tr><th>Name</th><th>Source</th><th>Description</th><th></th></tr></thead>
          <tbody>${missingRows}</tbody>
        </table>`
                : `<div class="empty">All skills are present locally.</div>`
            }

  ${present.length > 0
                ? `<h2>Active (${present.length})</h2>
        <table>
          <thead><tr><th>Name</th><th>Source</th><th>Description</th><th>Status</th></tr></thead>
          <tbody>${presentRows}</tbody>
        </table>`
                : ""
            }

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('.vscode-button[data-skill]').forEach(btn => {
      btn.addEventListener('click', () => {
        const skill = JSON.parse(btn.getAttribute('data-skill'));
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
