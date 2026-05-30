import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateAnnotation (vscode.workspace.fs)', () => {
  test('persists an annotation content edit', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'upd-itest', title: 'Upd', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'x.ts', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'h' }],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.updateAnnotation('upd-itest', 'a1', 'edited', 1234);
      if (!ok) {
        throw new Error('updateAnnotation returned false');
      }
      const reloaded = await store.getGroup('upd-itest');
      if (reloaded?.annotations[0]?.content !== 'edited') {
        throw new Error(`content not persisted: ${reloaded?.annotations[0]?.content}`);
      }
      if (reloaded?.updatedAt !== 1234) {
        throw new Error(`updatedAt not bumped: ${reloaded?.updatedAt}`);
      }
    } finally {
      await store.deleteGroup('upd-itest');
    }
  });
});
