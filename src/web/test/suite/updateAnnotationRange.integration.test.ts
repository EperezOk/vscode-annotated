import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateAnnotationRange (vscode.workspace.fs)', () => {
  test('persists a new range + content hash', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'rng-itest', title: 'R', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'README.md', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'old' }],
    };
    try {
      await store.saveGroup(g);
      const ok = await store.updateAnnotationRange('rng-itest', 'a1', { startLine: 2, endLine: 3 }, 'newhash', 9);
      if (!ok) {
        throw new Error('updateAnnotationRange returned false');
      }
      const r = await store.getGroup('rng-itest');
      if (r?.annotations[0]?.range?.endLine !== 3 || r?.annotations[0]?.contentHash !== 'newhash') {
        throw new Error(`range/hash not persisted: ${JSON.stringify(r?.annotations[0])}`);
      }
    } finally {
      await store.deleteGroup('rng-itest');
    }
  });
});
