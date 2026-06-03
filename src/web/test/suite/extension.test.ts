import * as vscode from 'vscode';

suite('Annotated web extension', () => {
  test('activates and registers the createAnnotation command', async () => {
    const ext = vscode.extensions.getExtension('eperezok.vscode-annotated');
    if (!ext) {
      throw new Error('extension not found by id eperezok.vscode-annotated');
    }
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.createAnnotation')) {
      throw new Error('annotated.createAnnotation should be registered');
    }
    if (commands.includes('annotated.ping')) {
      throw new Error('annotated.ping should no longer be registered');
    }
  });
});
