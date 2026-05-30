import * as vscode from 'vscode';
import { SidebarViewProvider } from './sidebarViewProvider';
import { registerCreateAnnotationCommand } from './createAnnotationCommand';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SidebarViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, provider),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('annotated.ping', () => 'pong'),
  );

  context.subscriptions.push(registerCreateAnnotationCommand());
}

export function deactivate(): void {
  // No-op.
}
