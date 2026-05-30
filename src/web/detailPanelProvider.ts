import * as vscode from 'vscode';
import { type Annotation, type AnnotationGroup } from '../shared/model';
import { parseDetailMessage, type HostToDetail, type TagColor } from '../shared/protocol';

export class DetailPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'annotated.detail';
  private view?: vscode.WebviewView;
  private group: AnnotationGroup | null = null;
  private palette: TagColor[] = [];

  /** Set by the extension to navigate to a selected annotation. */
  public onSelectAnnotation?: (annotation: Annotation) => void;

  /** Set by the extension to persist an annotation's edited content. */
  public onUpdateAnnotation?: (groupId: string, annotationId: string, content: string) => void;

  /** Set by the extension: rename the active group. */
  public onSetGroupTitle?: (groupId: string, title: string) => void;
  /** Set by the extension: edit the active group's tags (native picker). */
  public onEditTags?: (groupId: string) => void;
  /** Set by the extension: edit the active group's Git ref (native picker). */
  public onEditGitRef?: (groupId: string) => void;

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
    webviewView.webview.onDidReceiveMessage((raw) => {
      const message = parseDetailMessage(raw);
      if (!message) {
        return;
      }
      if (message.type === 'ready') {
        this.post();
      } else if (message.type === 'selectAnnotation') {
        const annotation = this.group?.annotations.find((a) => a.id === message.annotationId);
        if (annotation) {
          this.onSelectAnnotation?.(annotation);
        }
      } else if (message.type === 'updateAnnotation') {
        if (this.group) {
          this.onUpdateAnnotation?.(this.group.id, message.annotationId, message.content);
        }
      } else if (message.type === 'copyText') {
        void vscode.env.clipboard.writeText(message.text);
      } else if (message.type === 'setGroupTitle') {
        if (this.group) {
          this.onSetGroupTitle?.(this.group.id, message.title);
        }
      } else if (message.type === 'editTags') {
        if (this.group) {
          this.onEditTags?.(this.group.id);
        }
      } else if (message.type === 'editGitRef') {
        if (this.group) {
          this.onEditGitRef?.(this.group.id);
        }
      }
    });
  }

  /** Set the group shown by the panel and push it to the webview (if resolved). */
  showGroup(group: AnnotationGroup | null, palette: TagColor[]): void {
    this.group = group;
    this.palette = palette;
    this.post();
  }

  private post(): void {
    if (!this.view) {
      return;
    }
    const message: HostToDetail = { type: 'setGroup', group: this.group, palette: this.palette };
    void this.view.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'detail');
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
  <title>Detail</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
