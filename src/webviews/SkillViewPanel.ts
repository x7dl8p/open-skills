import * as vscode from "vscode";
import * as path from "path";
import { MarketplaceSkill } from "../types";

export class SkillViewPanel {
	private static panels: Map<string, SkillViewPanel> = new Map();

	private readonly panel: vscode.WebviewPanel;
	private readonly extensionPath: string;
	private disposed = false;
	private currentSkill!: MarketplaceSkill;

	private constructor(
		panel: vscode.WebviewPanel,
		extensionPath: string,
		skill: MarketplaceSkill,
		isInstalled: boolean,
	) {
		this.panel = panel;
		this.extensionPath = extensionPath;
		this.currentSkill = skill;
		this.panel.webview.html = this.buildHtml(skill, isInstalled);

		this.panel.onDidDispose(() => {
			this.disposed = true;
			SkillViewPanel.panels.delete(skill.name);
		});
	}

	markInstalled(): void {
		if (!this.disposed) {
			this.panel.webview.html = this.buildHtml(this.currentSkill, true);
		}
	}

	static createOrShow(
		context: vscode.ExtensionContext,
		skill: MarketplaceSkill,
		isInstalled: boolean,
		onInstall: (skill: MarketplaceSkill) => void,
	): SkillViewPanel {
		const existing = SkillViewPanel.panels.get(skill.name);
		if (existing && !existing.disposed) {
			existing.panel.reveal(vscode.ViewColumn.One);
			existing.panel.webview.html = existing.buildHtml(skill, isInstalled);
			return existing;
		}

		const panel = vscode.window.createWebviewPanel(
			"openSkills.skillView",
			skill.name,
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				localResourceRoots: [
					vscode.Uri.file(path.join(context.extensionPath, "assets")),
				],
			},
		);

		panel.iconPath = vscode.Uri.file(
			path.join(context.extensionPath, "assets", "open-skills.png"),
		);

		const instance = new SkillViewPanel(
			panel,
			context.extensionPath,
			skill,
			isInstalled,
		);

		panel.webview.onDidReceiveMessage((msg) => {
			if (msg.type === "install") {
				onInstall(skill);
			}
			if (msg.type === "copy") {
				const repoUrl = `https://github.com/${skill.source.owner}/${skill.source.repo}/tree/${skill.source.branch}/${skill.skillPath}`;
				vscode.env.clipboard.writeText(repoUrl);
				vscode.window.showInformationMessage("Repository URL copied to clipboard!");
			}
		});

		SkillViewPanel.panels.set(skill.name, instance);
		context.subscriptions.push(panel);
		return instance;
	}

	private getLogoUri(): string {
		const logoPath = vscode.Uri.file(
			path.join(this.extensionPath, "assets", "open-skills.png"),
		);
		return this.panel.webview.asWebviewUri(logoPath).toString();
	}

	private buildHtml(skill: MarketplaceSkill, isInstalled: boolean): string {
		const logoUri = this.getLogoUri();
		const repoPath = `${skill.source.owner}/${skill.source.repo}`;
		const fullUrl = `https://github.com/${skill.source.owner}/${skill.source.repo}/tree/${skill.source.branch}/${skill.skillPath}`;
		const rawContent = skill.fullContent || `# ${skill.name}\n\n${skill.description}`;
		const nonce = this.getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} https:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>${esc(skill.name)}</title>
<style nonce="${nonce}">
*{box-sizing:border-box;margin:0;padding:0}
html{height:100%;overflow:hidden}
body{
  height:100%;
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-editor-background);
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

.skill-header{
  position:sticky;
  top:0;
  z-index:100;
  display:flex;
  align-items:center;
  gap:12px;
  padding:6px 10px;
  margin:8px 12px 0;
  border-radius:12px;
  background:color-mix(in srgb, var(--vscode-editor-background) 70%, transparent);
  backdrop-filter:blur(16px);
  -webkit-backdrop-filter:blur(16px);
  border:1px solid var(--vscode-panel-border);
  flex-shrink:0;
}
.skill-header .logo{width:22px;height:22px;object-fit:contain;border-radius:4px}
.skill-header .info{flex:1;min-width:0;display:flex;align-items:center;gap:12px}
.skill-header .skill-name{
  font-size:15px;font-weight:600;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.skill-header .repo-path{
  display:flex;align-items:center;gap:6px;
  font-size:12px;color:var(--vscode-descriptionForeground);
}
.skill-header .repo-path code{
  max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-family:var(--vscode-editor-font-family);
}
.skill-header .actions{display:flex;align-items:center;gap:8px;flex-shrink:0}

.btn{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 14px;border-radius:6px;border:none;
  font-size:12px;font-weight:600;cursor:pointer;
  transition:background .15s,opacity .15s;
  white-space:nowrap;
}
.btn-primary{
  background:var(--vscode-button-background);
  color:var(--vscode-button-foreground);
}
.btn-primary:hover{background:var(--vscode-button-hoverBackground)}
.btn-primary:disabled{opacity:.5;cursor:default}
.btn-secondary{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
}
.btn-secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}

.copy-icon{width:14px;height:14px;vertical-align:middle}

.content{
  flex:1;
  overflow-y:auto;
  padding:24px 32px 48px;
  max-width:820px;
  margin:0 auto;
  width:100%;
  line-height:1.7;
}

.content h1{font-size:24px;font-weight:700;margin:28px 0 12px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px}
.content h2{font-size:20px;font-weight:600;margin:24px 0 10px;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:6px}
.content h3{font-size:16px;font-weight:600;margin:20px 0 8px}
.content h4{font-size:14px;font-weight:600;margin:16px 0 6px}
.content h1:first-child{margin-top:0}

.content p{margin:0 0 12px}
.content ul,.content ol{padding-left:24px;margin:0 0 12px}
.content li{margin-bottom:4px}
.content li>p{margin:0}

.content code{
  font-family:var(--vscode-editor-font-family);
  font-size:0.9em;
  background:var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
  padding:2px 5px;border-radius:4px;
}
.content pre{
  background:var(--vscode-textCodeBlock-background, rgba(127,127,127,.1));
  border:1px solid var(--vscode-panel-border);
  border-radius:8px;
  padding:14px 18px;
  margin:0 0 16px;
  overflow-x:auto;
  line-height:1.5;
}
.content pre code{background:none;padding:0;border-radius:0;font-size:13px}

.content blockquote{
  border-left:3px solid var(--vscode-textBlockQuote-border, var(--vscode-button-background));
  margin:0 0 12px;
  padding:4px 16px;
  color:var(--vscode-descriptionForeground);
}
.content hr{border:none;border-top:1px solid var(--vscode-panel-border);margin:20px 0}

.content a{color:var(--vscode-textLink-foreground);text-decoration:none}
.content a:hover{text-decoration:underline}

.content table{
  border-collapse:collapse;
  margin:0 0 16px;
  width:100%;
}
.content th,.content td{
  border:1px solid var(--vscode-panel-border);
  padding:6px 12px;
  text-align:left;
}
.content th{
  background:var(--vscode-textCodeBlock-background, rgba(127,127,127,.1));
  font-weight:600;
}
.content img{max-width:100%;border-radius:6px}

.content strong{font-weight:600}
.content em{font-style:italic}
</style>
</head>
<body>

<div class="skill-header">
  <img src="${logoUri}" alt="Open Skills" class="logo">
  <div class="info">
    <div class="skill-name">${esc(skill.name)}</div>
    <div class="repo-path">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
      <code title="${esc(fullUrl)}">${esc(repoPath)}</code>
    </div>
  </div>
  <div class="actions">
    <button class="btn btn-secondary" id="copyBtn" title="Copy repository URL">
      <svg class="copy-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h8v8H4z" fill="none"/><path d="M10.5 1h-7a1.5 1.5 0 00-1.5 1.5v9h1v-9a.5.5(0)01.5-.5h7v-1zm2.5 3h-6.5a1.5(1).5 0 00-1.5 1.5v8a1.5(1).5 0 001.5 1.5h6.5a1.5(1).5 0 001.5-1.5v-8a1.5(1).5 0 00-1.5-1.5zm.5 9.5a.5.5 0 01-.5.5h-6.5a.5.5 0 01-.5-.5v-8a.5.5 0 01.5-.5h6.5a.5.5 0 01.5.5v8z"/></svg>
      Copy URL
    </button>
    ${isInstalled
			? `<button class="btn btn-primary" disabled>Installed</button>`
			: `<button class="btn btn-primary" id="installBtn">Install</button>`
		}
  </div>
</div>

<div class="content" id="md">${renderMarkdown(rawContent)}</div>

<script nonce="${nonce}">
(function(){
  const vsc = acquireVsCodeApi();
  const copyBtn = document.getElementById('copyBtn');
  const installBtn = document.getElementById('installBtn');
  if(copyBtn) copyBtn.addEventListener('click', ()=> vsc.postMessage({type:'copy'}));
  if(installBtn) installBtn.addEventListener('click', ()=>{
    installBtn.disabled=true;
    installBtn.textContent='Installing…';
    vsc.postMessage({type:'install'});
  });
})();
</script>
</body>
</html>`;
	}

	private getNonce(): string {
		return [...Array(32)].map(() => Math.random().toString(36)[2]).join("");
	}
}

function esc(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function renderMarkdown(md: string): string {
	md = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
	md = md.replace(/\r\n/g, "\n");

	const lines = md.split("\n");
	const html: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		const fenceMatch = line.match(/^```(\w*)/);
		if (fenceMatch) {
			const lang = fenceMatch[1] || "";
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].startsWith("```")) {
				codeLines.push(lines[i]);
				i++;
			}
			i++;
			html.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(codeLines.join("\n"))}</code></pre>`);
			continue;
		}

		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			const level = headingMatch[1].length;
			html.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
			i++;
			continue;
		}

		if (/^(---|\*\*\*|___)$/.test(line.trim())) {
			html.push("<hr>");
			i++;
			continue;
		}

		if (line.startsWith("> ") || line === ">") {
			const quoteLines: string[] = [];
			while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
				quoteLines.push(lines[i].replace(/^>\s?/, ""));
				i++;
			}
			html.push(`<blockquote>${renderMarkdown(quoteLines.join("\n"))}</blockquote>`);
			continue;
		}

		if (line.includes("|") && i + 1 < lines.length && /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])) {
			const tableLines: string[] = [];
			while (i < lines.length && lines[i].includes("|")) {
				tableLines.push(lines[i]);
				i++;
			}
			html.push(renderTable(tableLines));
			continue;
		}

		if (/^\s*[-*+]\s+/.test(line)) {
			const listItems: string[] = [];
			let currentItem = "";
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
				if (currentItem) { listItems.push(currentItem); }
				currentItem = lines[i].replace(/^\s*[-*+]\s+/, "");
				i++;
				while (i < lines.length && /^\s{2,}/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i])) {
					currentItem += " " + lines[i].trim();
					i++;
				}
			}
			if (currentItem) { listItems.push(currentItem); }
			html.push(`<ul>${listItems.map(li => `<li>${inline(li)}</li>`).join("")}</ul>`);
			continue;
		}

		if (/^\s*\d+\.\s+/.test(line)) {
			const listItems: string[] = [];
			let currentItem = "";
			while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
				if (currentItem) { listItems.push(currentItem); }
				currentItem = lines[i].replace(/^\s*\d+\.\s+/, "");
				i++;
				while (i < lines.length && /^\s{2,}/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
					currentItem += " " + lines[i].trim();
					i++;
				}
			}
			if (currentItem) { listItems.push(currentItem); }
			html.push(`<ol>${listItems.map(li => `<li>${inline(li)}</li>`).join("")}</ol>`);
			continue;
		}

		if (line.trim() === "") {
			i++;
			continue;
		}

		const paraLines: string[] = [];
		while (i < lines.length && lines[i].trim() !== "" &&
			!lines[i].startsWith("#") && !lines[i].startsWith("```") &&
			!lines[i].startsWith("> ") && !/^\s*[-*+]\s+/.test(lines[i]) &&
			!/^\s*\d+\.\s+/.test(lines[i]) && !/^(---|\*\*\*|___)$/.test(lines[i].trim())) {
			paraLines.push(lines[i]);
			i++;
		}
		if (paraLines.length > 0) {
			html.push(`<p>${inline(paraLines.join("\n"))}</p>`);
		}
	}

	return html.join("\n");
}

function inline(text: string): string {
	text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
	text = text.replace(/`([^`]+)`/g, (_, code) => `<code>${esc(code)}</code>`);
	text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
	text = text.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");
	text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
	text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");
	text = text.replace(/_(.+?)_/g, "<em>$1</em>");
	text = text.replace(/\n/g, "<br>");
	return text;
}

function renderTable(tableLines: string[]): string {
	const parseLine = (line: string): string[] =>
		line.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());

	if (tableLines.length < 2) { return ""; }

	const headers = parseLine(tableLines[0]);
	const rows = tableLines.slice(2).map(parseLine);

	return `<table><thead><tr>${headers.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
