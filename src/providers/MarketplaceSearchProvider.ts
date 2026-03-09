import * as vscode from 'vscode';
import { MarketplaceSkill } from '../types';

type SearchEntry = { skill: MarketplaceSkill; installed: boolean };

export class MarketplaceSearchProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private lastResults: SearchEntry[] = [];

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly onSearch: (query: string) => void,
        private readonly onOpen: (skill: MarketplaceSkill) => void,
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
        webviewView.webview.html = this.html();
        webviewView.webview.onDidReceiveMessage(({ type, query, index }: { type: string; query: string; index: number }) => {
            if (type === 'search') this.onSearch(query);
            if (type === 'open' && this.lastResults[index]) this.onOpen(this.lastResults[index].skill);
        });
    }

    showResults(entries: SearchEntry[]): void {
        this.lastResults = entries;
        const items = entries.map(({ skill, installed }, i) => {
            const parts = skill.skillPath.replace(/\/[^/]+$/, '').split('/');
            return { i, name: skill.name, cat: parts[parts.length - 1] || '', ok: installed };
        });
        this.view?.webview.postMessage({ type: 'results', items });
    }

    clearInput(): void {
        this.lastResults = [];
        this.view?.webview.postMessage({ type: 'clear' });
    }

    private nonce(): string {
        return [...Array(32)].map(() => Math.random().toString(36)[2]).join('');
    }

    private html(): string {
        const n = this.nonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}';">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:var(--vscode-sideBar-background);color:var(--vscode-foreground);font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);overflow:hidden}
body{display:flex;flex-direction:column}
.bar{flex-shrink:0;padding:5px 8px}
.pill{display:flex;align-items:center;gap:5px;height:26px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);border-radius:13px;padding:0 10px}
.pill:focus-within{border-color:var(--vscode-focusBorder)}
.ico,.clr{flex-shrink:0;color:var(--vscode-input-placeholderForeground);line-height:0}
input{flex:1;background:none;border:none;outline:none;font-size:inherit;font-family:inherit;color:var(--vscode-input-foreground);min-width:0}
input::placeholder{color:var(--vscode-input-placeholderForeground)}
.clr{background:none;border:none;cursor:pointer;padding:0;display:none;border-radius:2px}
.clr:hover{color:var(--vscode-foreground)}.clr.on{display:block}
#list{flex:1;overflow-y:auto;padding:4px 0}
.item{display:flex;align-items:center;gap:6px;padding:3px 12px;cursor:pointer;user-select:none}
.item:hover{background:var(--vscode-list-hoverBackground)}
.iico{flex-shrink:0;line-height:0}
.iico.ok{color:var(--vscode-gitDecoration-addedResourceForeground)}
.iico.no{color:var(--vscode-icon-foreground)}
.iname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icat{font-size:0.85em;color:var(--vscode-descriptionForeground);flex-shrink:0;max-width:35%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{padding:8px 12px;color:var(--vscode-descriptionForeground)}
</style>
</head>
<body>
<div class="bar">
  <div class="pill">
    <span class="ico"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg></span>
    <input id="q" type="text" placeholder="Search skills…" autocomplete="off" spellcheck="false">
    <button id="clr" class="clr" title="Clear"><svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg></button>
  </div>
</div>
<div id="list"></div>
<script nonce="${n}">
const vsc=acquireVsCodeApi(),inp=document.getElementById('q'),clr=document.getElementById('clr'),list=document.getElementById('list');
let t;
const ICO_EXT='<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5A2.5 2.5 0 0 0 10.5 1 2.5 2.5 0 0 0 8 3.5V5H4a2 2 0 0 0-2 2v3.8h1.5A2.5 2.5 0 0 1 6 13.3a2.5 2.5 0 0 1-2.5 2.5H2V19a2 2 0 0 0 2 2h3.8v-1.5A2.5 2.5 0 0 1 10.3 17a2.5 2.5 0 0 1 2.5 2.5V21H17a2 2 0 0 0 2-2v-4h1.5A2.5 2.5 0 0 0 23 12.5 2.5 2.5 0 0 0 20.5 11z"/></svg>';
const ICO_CHK='<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>';

inp.addEventListener('input',()=>{
  clr.classList.toggle('on',inp.value.length>0);
  clearTimeout(t);
  t=setTimeout(()=>vsc.postMessage({type:'search',query:inp.value.trim()}),200);
});
clr.addEventListener('click',()=>{
  inp.value='';clr.classList.remove('on');clearTimeout(t);list.innerHTML='';
  vsc.postMessage({type:'search',query:''});inp.focus();
});
window.addEventListener('message',({data})=>{
  if(data.type==='clear'){inp.value='';clr.classList.remove('on');list.innerHTML='';}
  if(data.type==='results')render(data.items);
});
function open(i){vsc.postMessage({type:'open',index:i});}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function render(items){
  if(!items.length){list.innerHTML=inp.value?'<div class="empty">No results found</div>':'';return;}
  list.innerHTML=items.map(({i,name,cat,ok})=>
    \`<div class="item" onclick="open(\${i})"><span class="iico \${ok?'ok':'no'}">\${ok?ICO_CHK:ICO_EXT}</span><span class="iname">\${esc(name)}</span><span class="icat">\${esc(cat)}</span></div>\`
  ).join('');
}
</script>
</body>
</html>`;
    }
}
