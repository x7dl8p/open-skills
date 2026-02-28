import * as vscode from "vscode";
import * as path from "path";
import {
  EXTENSION_VERSION,
  GITHUB_URL,
  DEVELOPER,
  MARKETPLACE_URL,
} from "../types";

export function showAboutPanel(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    "openSkills.about",
    "About -- Open Skills",
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  const logoPath = vscode.Uri.file(
    path.join(context.extensionPath, "assets", "open-skills.png")
  );
  const logoUri = panel.webview.asWebviewUri(logoPath);

  const detectedIde = vscode.env.appName || "Unknown";
  panel.webview.html = buildAboutHtml(detectedIde, logoUri.toString());
  context.subscriptions.push(panel);
}

function buildAboutHtml(detectedIde: string, logoUri: string): string {
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
      max-width: 660px;
      margin: 40px auto;
      padding: 0 24px;
      line-height: 1.6;
    }

    .header-container {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 8px;
    }

    .logo {
      width: 48px;
      height: 48px;
      object-fit: contain;
    }

    h1 {
      font-size: 28px;
      font-weight: 600;
      margin: 0;
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
      border-radius: 4px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .link-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .link-btn.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .link-btn.primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .ide-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }

    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }

    .feature-item {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-panel-border);
      padding: 16px;
      border-radius: 8px;
    }

    .feature-item strong {
      display: block;
      font-size: 14px;
      margin-bottom: 4px;
      color: var(--vscode-foreground);
    }

    .feature-item span {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .status-badge {
      font-size: 10px;
      background: var(--vscode-testing-iconPassed);
      color: #000;
      padding: 1px 6px;
      border-radius: 10px;
      vertical-align: middle;
      margin-left: 4px;
    }

    footer {
      margin-top: 48px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="header-container">
    <img src="${logoUri}" alt="Open Skills" class="logo">
    <h1>Open Skills <span class="version-badge">v${EXTENSION_VERSION}</span></h1>
  </div>
  <p class="tagline">Intelligent skill manager for AI-assisted development environments.</p>

  <p>Detected IDE: <span class="ide-badge">${esc(detectedIde)}</span></p>

  <hr>

  <h2>About</h2>
  <p>
    Open Skills centralizes the discovery, visualization, and synchronization of modular
    AI skill definitions (<code>SKILL.md</code>) across your project -- whether you use
    VS Code, Cursor, Windsurf, VSCodium, or any compatible fork.
  </p>
  <p>
    It scans standard directories like <code>.agent/skills</code>, <code>.cursor/rules</code>,
    <code>.claude/skills</code>, and custom paths you configure, giving you live status on
    what is active, what is missing, and one-click import for any gap.
  </p>

  <hr>

  <h2>Features</h2>
  <div class="feature-grid">
    <div class="feature-item">
      <strong>Workspace Scanning</strong>
      <span>Non-blocking scan of 16+ standard skill directories with debounced file watchers</span>
    </div>
    <div class="feature-item">
      <strong>Native Tree View</strong>
      <span>Active, Missing, and My Skills groups with inline import, delete, and preview actions</span>
    </div>
    <div class="feature-item">
      <strong>Hover Provider</strong>
      <span>Inline markers with import and navigation actions when hovering skill names in code</span>
    </div>
    <div class="feature-item">
      <strong>Dashboard</strong>
      <span>Coverage percentage, lifetime analytics, and one-click import for missing skills</span>
    </div>
    <div class="feature-item">
      <strong>IDE Detection</strong>
      <span>Auto-detects VS Code, Cursor, Windsurf, VSCodium, Code-OSS, and Insiders</span>
    </div>
    <div class="feature-item">
      <strong>Marketplace <span class="status-badge">Live</span></strong>
      <span>Discover and install skills from GitHub repositories with one click</span>
    </div>
    <div class="feature-item">
      <strong>Global Library</strong>
      <span>Sync skills to a global directory for reuse across all workspaces</span>
    </div>
    <div class="feature-item">
      <strong>Skill Preview</strong>
      <span>Rendered markdown preview panel for local and marketplace skills</span>
    </div>
  </div>

  <hr>

  <h2>Links</h2>
  <div class="links">
    <a class="link-btn primary" href="${GITHUB_URL}" target="_blank">GitHub</a>
    <a class="link-btn" href="${MARKETPLACE_URL}" target="_blank">Marketplace</a>
    <a class="link-btn" href="${GITHUB_URL}/issues/new" target="_blank">Report Issue</a>
    <a class="link-btn" href="${GITHUB_URL}/blob/main/CHANGELOG.md" target="_blank">Changelog</a>
    <a class="link-btn" href="${DEVELOPER}" target="_blank">Developer</a>
  </div>

  <hr>

  <h2>Open Source</h2>
  <p>
    Open Skills is MIT-licensed. Contributions are welcome -- open a PR or file an issue on GitHub.
  </p>
  <ul>
    <li>Star the repo to support the project</li>
    <li>Share it with your team or on social media</li>
    <li>Submit skill templates to the community registry</li>
  </ul>

  <footer>
    Open Skills v${EXTENSION_VERSION} &mdash; MIT License &mdash; Built for the developer community
  </footer>
</body>
</html>`;
}

function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
