<script lang="ts">
  import { type ThreadComment } from '../../shared/model';
  import { relativeTime } from '../../core/comments';
  import { authorHue } from '../../shared/color';
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
    <div
      class="comment"
      class:other={c.author !== currentAuthor}
      style={c.author !== currentAuthor ? `--author-h: ${authorHue(c.author)}` : undefined}
      data-testid="comment"
    >
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
          <button type="button" class="btn ghost" data-testid="comment-cancel-btn" onclick={() => (editingId = null)}>Cancel</button>
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
        <button type="button" class="btn ghost" data-testid="reply-cancel-btn" onclick={() => (replying = false)}>Cancel</button>
      </div>
    </div>
  {:else}
    <button type="button" class="reply-trigger" data-testid="comment-reply-trigger" onclick={startReply}>💬 Add a comment…</button>
  {/if}
</section>

<style>
  .comments { margin-top: 14px; border-top: 1px solid var(--vscode-sideBar-border, #333); padding-top: 10px; }
  .ctitle { margin: 0 0 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #9a9a9a); }
  /* Each comment is a bordered box so its bounds are obvious. The border is neutral for your
     own comments and tinted with the author's hue (--author-h, set inline on .comment) for
     others — the hue var also cascades to the author name below. */
  .comment { margin-bottom: 10px; padding: 7px 10px; border: 1px solid var(--vscode-widget-border, #3c3c3c); border-radius: 6px; }
  .comment.other { border-color: hsl(var(--author-h, 30) 55% 50% / 0.5); }
  .chead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
  .cauthor { font-weight: 600; font-size: 12px; }
  /* Per-author color: hue comes from --author-h (cascaded from .comment); lightness is chosen
     per theme so the name stays legible on any background — darker on light, lighter on dark/HC. */
  .cauthor.other { color: hsl(var(--author-h, 30) 60% 38%); }
  :global(body.vscode-dark) .cauthor.other { color: hsl(var(--author-h, 30) 70% 70%); }
  :global(body.vscode-high-contrast) .cauthor.other { color: hsl(var(--author-h, 30) 90% 80%); }
  :global(body.vscode-high-contrast-light) .cauthor.other { color: hsl(var(--author-h, 30) 90% 28%); }
  .ctime { font-size: 10.5px; color: var(--vscode-descriptionForeground, #9a9a9a); }
  .cactions { margin-left: auto; display: flex; gap: 6px; }
  .crow { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
  .link { background: none; border: none; color: var(--vscode-textLink-foreground, #3794ff); cursor: pointer; font-size: 11px; padding: 0; }
  .btn { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); border: none; border-radius: 3px; padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
  .btn.ghost { background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ddd); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .reply-trigger { background: none; border: 1px dashed var(--vscode-input-border, #555); color: var(--vscode-descriptionForeground, #9a9a9a); border-radius: 4px; padding: 6px 10px; font-size: 11.5px; cursor: pointer; width: 100%; text-align: left; }
</style>
