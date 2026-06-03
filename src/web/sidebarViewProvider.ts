import * as vscode from 'vscode';
import { GroupStore } from '../core/groupStore';
import { CommentStore } from '../core/commentStore';
import { flattenComments, commentCountsByGroup } from '../core/comments';
import { parseWebviewMessage, type HostToWebview } from '../shared/protocol';
import { VscodeFileSystem } from './vscodeFileSystem';
import { displayPalette } from './tagPalette';

export class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'annotated.sidebar';
  private view?: vscode.WebviewView;

  /** Set by the extension to handle group selection (wired to the detail panel in a later phase). */
  public onSelectGroup?: (groupId: string) => void;

  public onBulkEditTags?: (groupIds: string[]) => Promise<void>;
  public onBulkEditGitRef?: (groupIds: string[]) => Promise<void>;
  public onBulkResolveRestore?: (groupIds: string[]) => Promise<void>;
  public onBulkDelete?: (groupIds: string[]) => Promise<void>;

  /** Set by the extension: also fired when the user clicks the manual refresh button. */
  public onRefreshRequested?: () => void;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(async (raw) => {
      const message = parseWebviewMessage(raw);
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        await this.refresh();
      } else if (message.type === 'refresh') {
        await this.refresh();
        this.onRefreshRequested?.();
      } else if (message.type === 'selectGroup') {
        this.onSelectGroup?.(message.groupId);
      } else if (message.type === 'bulkEditTags') {
        await this.onBulkEditTags?.(message.groupIds);
      } else if (message.type === 'bulkEditGitRef') {
        await this.onBulkEditGitRef?.(message.groupIds);
      } else if (message.type === 'bulkResolveRestore') {
        await this.onBulkResolveRestore?.(message.groupIds);
      } else if (message.type === 'bulkDelete') {
        await this.onBulkDelete?.(message.groupIds);
      }
    });
  }

  /** Reload groups + comment counts from disk and push fresh state to the webview. */
  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    const fs = folder ? new VscodeFileSystem(folder.uri) : null;
    const groups = fs ? await new GroupStore(fs).listGroups() : [];
    const comments = fs ? flattenComments(await new CommentStore(fs).listCommentFiles()) : [];
    const message: HostToWebview = {
      type: 'setState',
      groups,
      palette: displayPalette(groups),
      commentCounts: commentCountsByGroup(groups, comments),
    };
    void this.view.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'sidebar');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
    const nonce = getNonce();
    const csp =
      `default-src 'none'; ` +
      `style-src ${webview.cspSource}; ` +
      `script-src 'nonce-${nonce}'; ` +
      `font-src ${webview.cspSource}; ` +
      `img-src ${webview.cspSource} https: data:;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Annotations</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** Cryptographically-strong nonce via Web Crypto (available in the web extension host). */
function getNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
