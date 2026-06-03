<script lang="ts">
  import { type ThreadComment } from '../../shared/model';
  import { relativeTime } from '../../core/comments';
  import MarkdownPreview from './MarkdownPreview.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';

  let {
    comments,
    currentAuthor,
    now = Math.floor(Date.now() / 1000),
    onadd,
    onedit,
    ondelete,
  }: {
    comments: ThreadComment[];
    currentAuthor: string;
    now?: number;
    onadd?: (content: string) => void;
    onedit?: (commentId: string, content: string) => void;
    ondelete?: (commentId: string) => void;
  } = $props();

  let replying = $state(false);
  let replyDraft = $state('');
  let editingId = $state<string | null>(null);
  let editDraft = $state('');

  function startReply(): void { replyDraft = ''; replying = true; }
  function addReply(): void {
    const text = replyDraft.trim();
    if (!text) return;
    onadd?.(text);
    replyDraft = '';
    replying = false;
  }
  function startEdit(c: ThreadComment): void { editingId = c.id; editDraft = c.content; }
  function saveEdit(id: string): void {
    onedit?.(id, editDraft);
    editingId = null;
  }
</script>

<section class="comments" data-testid="comment-thread">
  <h4 class="ctitle">Comments</h4>
  {#each comments as c (c.id)}
    <div class="comment" data-testid="comment">
      <div class="chead">
        <span class="cauthor" class:other={c.author !== currentAuthor}>{c.author}</span>
        <span class="ctime">{relativeTime(c.timestamp, now)}</span>
        {#if c.author === currentAuthor}
          <span class="cactions">
            <button type="button" class="link" data-testid="comment-edit-btn" onclick={() => startEdit(c)}>edit</button>
            <button type="button" class="link" data-testid="comment-delete-btn" onclick={() => ondelete?.(c.id)}>delete</button>
          </span>
        {/if}
      </div>
      {#if editingId === c.id}
        <MarkdownEditor doc={editDraft} autofocus onChange={(v) => (editDraft = v)} onSubmit={() => saveEdit(c.id)} />
        <div class="crow">
          <button type="button" class="btn" data-testid="comment-save-btn" onclick={() => saveEdit(c.id)}>Save</button>
          <button type="button" class="link" onclick={() => (editingId = null)}>cancel</button>
        </div>
      {:else}
        <MarkdownPreview source={c.content} />
      {/if}
    </div>
  {/each}

  {#if replying}
    <div class="reply">
      <MarkdownEditor doc={replyDraft} autofocus onChange={(v) => (replyDraft = v)} onSubmit={addReply} />
      <div class="crow">
        <button type="button" class="btn" data-testid="comment-add-btn" disabled={!replyDraft.trim()} onclick={addReply}>Add comment</button>
        <button type="button" class="link" onclick={() => (replying = false)}>cancel</button>
      </div>
    </div>
  {:else}
    <button type="button" class="reply-trigger" data-testid="comment-reply-trigger" onclick={startReply}>💬 Add a comment…</button>
  {/if}
</section>

<style>
  .comments { margin-top: 14px; border-top: 1px solid var(--vscode-sideBar-border, #333); padding-top: 10px; }
  .ctitle { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .comment { margin-bottom: 10px; }
  .chead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .cauthor { font-weight: 600; font-size: 12px; }
  .cauthor.other { color: var(--vscode-charts-orange, #d18616); }
  .ctime { font-size: 10.5px; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .cactions { margin-left: auto; display: flex; gap: 6px; }
  .crow { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11px; padding: 0; }
  .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 3px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .reply-trigger { background: none; border: 1px dashed var(--vscode-input-border, #555); color: var(--vscode-descriptionForeground, #9a9a9a); border-radius: 4px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; width: 100%; text-align: left; }
</style>
