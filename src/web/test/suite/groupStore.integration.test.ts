import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { GroupStore } from '../../../core/groupStore';
import { type AnnotationGroup } from '../../../shared/model';

suite('GroupStore over vscode.workspace.fs', () => {
  test('saves, lists, gets, and deletes a group in the workspace', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder — @vscode/test-web must be passed the test-workspace folder');
    }
    const store = new GroupStore(new VscodeFileSystem(folder.uri));
    const group: AnnotationGroup = {
      id: 'itest-group-1',
      title: 'Integration',
      author: 'Tester',
      tags: ['security'],
      gitRef: null,
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
      annotations: [
        { id: 'a1', file: 'src/x.ts', range: { startLine: 1, endLine: 2 }, content: '# hi', contentHash: 'x' },
      ],
    };

    try {
      await store.saveGroup(group);

      const listed = await store.listGroups();
      if (!listed.some((g) => g.id === 'itest-group-1')) {
        throw new Error('group not listed after save');
      }

      const got = await store.getGroup('itest-group-1');
      if (!got || got.title !== 'Integration') {
        throw new Error('getGroup did not round-trip the title');
      }
      if (got.annotations[0]?.range.endLine !== 2) {
        throw new Error('getGroup did not round-trip the annotation range');
      }
    } finally {
      await store.deleteGroup('itest-group-1');
    }

    if ((await store.getGroup('itest-group-1')) !== null) {
      throw new Error('group still present after delete');
    }
  });
});
