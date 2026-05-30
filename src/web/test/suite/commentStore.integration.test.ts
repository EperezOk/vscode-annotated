import * as vscode from 'vscode';
import { VscodeFileSystem } from '../../vscodeFileSystem';
import { CommentStore } from '../../../core/commentStore';

suite('CommentStore (vscode.workspace.fs)', () => {
  test('add → update → delete round-trips through the per-author file', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder');
    }
    const store = new CommentStore(new VscodeFileSystem(folder.uri));
    const slug = 'itest-author';
    try {
      await store.addComment(slug, 'Itest Author', 'i@x', { id: 'ic1', annotationId: 'a1', content: 'hi', timestamp: 5 });
      let file = await store.getCommentFile(slug);
      if (file?.comments[0]?.content !== 'hi') {
        throw new Error(`add failed: ${JSON.stringify(file)}`);
      }
      if (!(await store.updateComment(slug, 'ic1', 'edited'))) {
        throw new Error('update returned false');
      }
      file = await store.getCommentFile(slug);
      if (file?.comments[0]?.content !== 'edited') {
        throw new Error(`update not persisted: ${JSON.stringify(file)}`);
      }
      if (!(await store.deleteComment(slug, 'ic1'))) {
        throw new Error('delete returned false');
      }
      file = await store.getCommentFile(slug);
      if ((file?.comments.length ?? 0) !== 0) {
        throw new Error(`delete not persisted: ${JSON.stringify(file)}`);
      }
    } finally {
      await new VscodeFileSystem(folder.uri).delete(`.annotations/comments/${slug}.json`);
    }
  });
});
