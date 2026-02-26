import * as vscode from "vscode";
import {
    EXTENSION_VERSION,
    GITHUB_URL,
    DOCS_URL,
    MARKETPLACE_URL,
} from "../types";

export function showAboutPanel(context: vscode.ExtensionContext): void {
    const panel = vscode.window.createWebviewPanel(
        "openSkills.about",
        "About — Open Skills",
        vscode.ViewColumn.One,
        { enableScripts: false }
    );

    panel.webview.html = buildAboutHtml();
    context.subscriptions.push(panel);
}

function buildAboutHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About Open Skills</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      max-width: 640px;
      margin: 40px auto;
      padding: 0 24px;
      line-height: 1.6;
    }

    h1 {
      font-size: 28px;
      font-weight: 600;
      margin: 0 0 4px;
      color: var(--vscode-foreground);
    }

    .version-badge {
      display: inline-block;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 600;
      letter-spacing: 0.3px;
      vertical-align: middle;
      margin-left: 8px;
    }

    .tagline {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      margin: 8px 0 32px;
    }

    hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 24px 0;
    }

    h2 {
      font-size: 14px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 12px;
    }

    p {
      margin: 0 0 12px;
      color: var(--vscode-foreground);
    }

    ul {
      padding-left: 20px;
      margin: 0 0 12px;
    }

    li {
      margin-bottom: 6px;
    }

    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    .link-btn {
      display: inline-block;
      padding: 6px 14px;
      border: 1px solid var(--vscode-button-secondaryBackground, var(--vscode-panel-border));
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--vscode-foreground);
      text-decoration: none;
      background: var(--vscode-button-secondaryBackground, transparent);
      transition: opacity 0.15s;
    }

    .link-btn:hover {
      opacity: 0.8;
    }

    .link-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 12px;
    }

    .feature-item {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 12px;
    }

    .feature-item strong {
      display: block;
      margin-bottom: 2px;
      font-size: 13px;
    }

    .feature-item span {
      color: var(--vscode-descriptionForeground);
    }

    .coming-soon {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      vertical-align: middle;
      margin-left: 6px;
    }

    footer {
      margin-top: 40px;
      font-size: 11px;
      color: var(--vscode-disabledForeground);
      text-align: center;
    }
  </style>
</head>
<body>
  <h1>Open Skills <span class="version-badge">v${EXTENSION_VERSION}</span></h1>
  <p class="tagline">Intelligent skill manager for AI-assisted development environments.</p>

  <hr>

  <h2>About</h2>
  <p>
    Open Skills centralizes the discovery, visualization, and synchronization of modular
    AI skill definitions (<code>SKILL.md</code>) across your project — whether you use
    VS Code, Cursor, VSCodium, or any compatible fork.
  </p>
  <p>
    It scans standard directories like <code>.agent/skills</code>, <code>.cursor/rules</code>,
    and custom paths you configure, giving you live status on what's active, what's missing,
    and one-click import for any gap.
  </p>

  <hr>

  <h2>Features</h2>
  <div class="feature-grid">
    <div class="feature-item">
      <strong>Workspace Scanning</strong>
      <span>Non-blocking scan of all configured skill directories</span>
    </div>
    <div class="feature-item">
      <strong>Native Tree View</strong>
      <span>Active / Missing / Imported groups in the sidebar</span>
    </div>
    <div class="feature-item">
      <strong>Hover Provider</strong>
      <span>Inline ⊕ markers with import action on hover</span>
    </div>
    <div class="feature-item">
      <strong>Gap Analysis</strong>
      <span>Coverage percentage + one-click import</span>
    </div>
    <div class="feature-item">
      <strong>IDE Detection</strong>
      <span>Auto-detects VS Code, Cursor, VSCodium and more</span>
    </div>
    <div class="feature-item">
      <strong>Marketplace <span class="coming-soon">Soon</span></strong>
      <span>Community skill discovery and sharing</span>
    </div>
  </div>

  <hr>

  <h2>Links</h2>
  <div class="links">
    <a class="link-btn primary" href="${GITHUB_URL}" target="_blank">GitHub</a>
    <a class="link-btn" href="${DOCS_URL}" target="_blank">Documentation</a>
    <a class="link-btn" href="${MARKETPLACE_URL}" target="_blank">Marketplace</a>
    <a class="link-btn" href="${GITHUB_URL}/issues/new" target="_blank">Report Issue</a>
    <a class="link-btn" href="${GITHUB_URL}/blob/main/CHANGELOG.md" target="_blank">Changelog</a>
  </div>

  <hr>

  <h2>Open Source</h2>
  <p>
    Open Skills is MIT-licensed. Contributions are welcome — open a PR or file an issue on GitHub.
  </p>
  <ul>
    <li>Star the repo to support the project</li>
    <li>Share it with your team or on social media</li>
    <li>Submit skill templates to the community registry</li>
  </ul>

  <footer>
    Open Skills v${EXTENSION_VERSION} &mdash; MIT License &mdash; Made with care for the dev community
  </footer>
</body>
</html>`;
}
