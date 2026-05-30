import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.reorderAnnotations (vscode.workspace.fs)', () => {
  test('persists a permuted annotation order', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'reorder-itest', title: 'R', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [
        { id: 'a1', file: 'README.md', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' },
        { id: 'a2', file: 'README.md', range: { startLine: 2, endLine: 2 }, content: '', contentHash: 'h' },
        { id: 'a3', file: 'README.md', range: { startLine: 3, endLine: 3 }, content: '', contentHash: 'h' },
      ],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.reorderAnnotations('reorder-itest', ['a3', 'a1', 'a2'], 9);
      if (!ok) {
        throw new Error('reorderAnnotations returned false');
      }
      const r = await store.getGroup('reorder-itest');
      const order = r?.annotations.map((a) => a.id).join(',');
      if (order !== 'a3,a1,a2') {
        throw new Error(`order not persisted: ${order}`);
      }
    } finally {
      await store.deleteGroup('reorder-itest');
    }
  });
});
