import * as vscode from 'vscode';

suite('Annotated web extension', () => {
  test('activates and registers the ping command', async () => {
    const ext = vscode.extensions.getExtension('openzeppelin.vscode-annotated');
    if (!ext) {
      throw new Error('extension not found by id openzeppelin.vscode-annotated');
    }
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.ping')) {
      throw new Error('annotated.ping should be registered');
    }
  });

  test('ping command returns pong', async () => {
    const result = await vscode.commands.executeCommand('annotated.ping');
    if (result !== 'pong') {
      throw new Error(`expected "pong", got ${String(result)}`);
    }
  });

  test('registers the createAnnotation command', async () => {
    const ext = vscode.extensions.getExtension('openzeppelin.vscode-annotated');
    if (!ext) {
      throw new Error('extension not found by id openzeppelin.vscode-annotated');
    }
    await ext.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.createAnnotation')) {
      throw new Error('annotated.createAnnotation should be registered');
    }
  });
});
