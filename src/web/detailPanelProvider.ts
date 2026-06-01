import * as vscode from 'vscode';
import { type Annotation, type AnnotationGroup, type GroupStatus, type ThreadComment } from '../shared/model';
import { parseDetailMessage, type HostToDetail, type TagColor } from '../shared/protocol';

export class DetailPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'annotated.detail';
  private view?: vscode.WebviewView;
  private group: AnnotationGroup | null = null;
  private palette: TagColor[] = [];
  private staleIds: string[] = [];
  private comments: ThreadComment[] = [];
  private currentAuthor = '';

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

  /** Set by the extension: persist an annotation's edited line range. */
  public onUpdateAnnotationRange?: (groupId: string, annotationId: string, startLine: number, endLine: number) => void;

  /** Set by the extension: persist a reordered annotation list. */
  public onReorderAnnotations?: (groupId: string, annotationIds: string[]) => void;

  /** Set by the extension: change the current group's status. */
  public onUpdateGroupStatus?: (groupId: string, status: GroupStatus) => void;

  /** Set by the extension: add a comment to an annotation. */
  public onAddComment?: (groupId: string, annotationId: string, content: string) => void;
  /** Set by the extension: edit a comment's content. */
  public onEditComment?: (groupId: string, commentId: string, content: string) => void;
  /** Set by the extension: delete a comment. */
  public onDeleteComment?: (groupId: string, commentId: string) => void;

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
      } else if (message.type === 'updateAnnotationRange') {
        if (this.group) {
          this.onUpdateAnnotationRange?.(this.group.id, message.annotationId, message.startLine, message.endLine);
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
      } else if (message.type === 'reorderAnnotations') {
        if (this.group) {
          this.onReorderAnnotations?.(this.group.id, message.annotationIds);
        }
      } else if (message.type === 'updateGroupStatus') {
        if (this.group) {
          this.onUpdateGroupStatus?.(this.group.id, message.status);
        }
      } else if (message.type === 'addComment') {
        if (this.group) {
          this.onAddComment?.(this.group.id, message.annotationId, message.content);
        }
      } else if (message.type === 'editComment') {
        if (this.group) {
          this.onEditComment?.(this.group.id, message.commentId, message.content);
        }
      } else if (message.type === 'deleteComment') {
        if (this.group) {
          this.onDeleteComment?.(this.group.id, message.commentId);
        }
      }
    });
  }

  /** Set the group shown by the panel and push it to the webview (if resolved). */
  showGroup(
    group: AnnotationGroup | null,
    palette: TagColor[],
    staleIds: string[] = [],
    comments: ThreadComment[] = [],
    currentAuthor = '',
  ): void {
    this.group = group;
    this.palette = palette;
    this.staleIds = staleIds;
    this.comments = comments;
    this.currentAuthor = currentAuthor;
    this.post();
  }

  private post(): void {
    if (!this.view) {
      return;
    }
    const message: HostToDetail = { type: 'setGroup', group: this.group, palette: this.palette, staleIds: this.staleIds, comments: this.comments, currentAuthor: this.currentAuthor };
    void this.view.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const base = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'detail');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'main.css'));
    const nonce = getNonce();
    // CodeMirror injects <style> elements at runtime, which `style-src ${webview.cspSource}`
    // alone would block. 'unsafe-inline' permits them. TODO(phase-4 follow-up): tighten this
    // by threading the existing nonce via EditorView.cspNonce + `style-src 'nonce-...'`.
    const csp =
      `default-src 'none'; ` +
      `style-src ${webview.cspSource} 'unsafe-inline'; ` +
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
