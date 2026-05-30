import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';
import { registerCreateAnnotationCommand } from './createAnnotationCommand';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, provider),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/.annotations/**/*.json');
  const refreshSidebar = (): void => {
    void provider.refresh();
  };
  watcher.onDidCreate(refreshSidebar);
  watcher.onDidChange(refreshSidebar);
  watcher.onDidDelete(refreshSidebar);
  context.subscriptions.push(watcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.ping', () => 'pong'),
  );

  context.subscriptions.push(registerCreateAnnotationCommand());
}

export function deactivate(): void {
  // No-op.
}
