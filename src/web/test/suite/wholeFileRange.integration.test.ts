import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore.updateAnnotationRange — whole file (vscode.workspace.fs)', () => {
  test('converts a line annotation to whole-file and back', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const g: AnnotationGroup = {
      id: 'wf-itest', title: 'WF', author: 'T', tags: [], gitRef: null, status: 'open',
      createdAt: 1, updatedAt: 1,
      annotations: [{ id: 'a1', file: 'README.md', range: { startLine: 1, endLine: 1 }, content: '', contentHash: 'old' }],
    };
    try {
      await store.saveGroup(g);
      if (!(await store.updateAnnotationRange('wf-itest', 'a1', null, '', 9))) {
        throw new Error('conversion to whole-file returned false');
      }
      let saved = await store.getGroup('wf-itest');
      if (saved?.annotations[0]?.range !== null || saved?.annotations[0]?.contentHash !== '') {
        throw new Error(`not whole-file: ${JSON.stringify(saved?.annotations[0])}`);
      }
      if (!(await store.updateAnnotationRange('wf-itest', 'a1', { startLine: 2, endLine: 3 }, 'h2', 10))) {
        throw new Error('conversion back to lines returned false');
      }
      saved = await store.getGroup('wf-itest');
      if (saved?.annotations[0]?.range?.endLine !== 3 || saved?.annotations[0]?.contentHash !== 'h2') {
        throw new Error(`not line-anchored: ${JSON.stringify(saved?.annotations[0])}`);
      }
    } finally {
      await store.deleteGroup('wf-itest');
    }
  });
});
