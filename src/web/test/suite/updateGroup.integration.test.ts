import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateGroup (vscode.workspace.fs)', () => {
  test('persists a metadata patch', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'grp-itest', title: 'Before', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1, annotations: [],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.updateGroup('grp-itest', { title: 'After', tags: ['x'], gitRef: 'main' }, 42);
      if (!ok) {
        throw new Error('updateGroup returned false');
      }
      const reloaded = await store.getGroup('grp-itest');
      if (reloaded?.title !== 'After' || reloaded?.gitRef !== 'main' || reloaded?.tags[0] !== 'x' || reloaded?.updatedAt !== 42) {
        throw new Error(`patch not persisted: ${JSON.stringify(reloaded)}`);
      }
    } finally {
      await store.deleteGroup('grp-itest');
    }
  });
});
