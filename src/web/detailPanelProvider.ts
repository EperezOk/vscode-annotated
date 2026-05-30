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
