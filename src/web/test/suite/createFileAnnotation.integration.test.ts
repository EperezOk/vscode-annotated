import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';

suite('annotated.createFileAnnotation', () => {
  test('is registered and writes a range-less annotation for the active file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes('annotated.createFileAnnotation')) {
      throw new Error('annotated.createFileAnnotation is not registered');
    }

    // Drive the flow's persistence directly: the QuickPick cannot be answered headlessly, so this
    // asserts the store round-trips what the command produces (range: null, contentHash: '').
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const id = 'file-anno-itest';
    try {
      await store.saveGroup({
        id, title: 'File level', author: 'T', tags: [], gitRef: null, status: 'open',
        createdAt: 1, updatedAt: 1,
        annotations: [{ id: 'a1', file: 'README.md', range: null, content: 'about the file', contentHash: '' }],
      });
      const saved = await store.getGroup(id);
      if (saved?.annotations[0]?.range !== null || saved?.annotations[0]?.contentHash !== '') {
        throw new Error(`whole-file annotation not persisted: ${JSON.stringify(saved?.annotations[0])}`);
      }
    } finally {
      await store.deleteGroup(id);
    }
  });
});
