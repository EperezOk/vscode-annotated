import { type FileSystem } from './fileSystem';
import { type Comment, type CommentFile, parseCommentFile, serializeCommentFile } from '../shared/model';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** Per-author comment files under `.annotations/comments/<slug>.json`. */
export class CommentStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly dir = '.annotations/comments',
  ) {}

  private path(slug: string): string {
    return `${this.dir}/${slug}.json`;
  }

  /** All valid comment files (invalid ones skipped). [] if the dir is absent. */
  async listCommentFiles(): Promise<CommentFile[]> {
    const names = await this.fs.readDirectory(this.dir);
    const files: CommentFile[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) {
        continue;
      }
      try {
        files.push(parseCommentFile(JSON.parse(dec.decode(await this.fs.readFile(`${this.dir}/${name}`)))));
      } catch (e) {
        console.warn(`[annotated] skipping invalid comment file ${name}: ${String(e)}`);
      }
    }
    return files;
  }

  async getCommentFile(slug: string): Promise<CommentFile | null> {
    try {
      return parseCommentFile(JSON.parse(dec.decode(await this.fs.readFile(this.path(slug)))));
    } catch {
      return null;
    }
  }

  async saveCommentFile(slug: string, file: CommentFile): Promise<void> {
    await this.fs.createDirectory(this.dir);
    await this.fs.writeFile(this.path(slug), enc.encode(serializeCommentFile(file)));
  }

  /** Append a comment to the author's file, creating it (with author/email) if needed. */
  async addComment(slug: string, author: string, email: string, comment: Comment): Promise<void> {
    const existing = await this.getCommentFile(slug);
    const comments = [...(existing?.comments ?? []), comment];
    await this.saveCommentFile(slug, { author, email, comments });
  }

  /** Edit a comment's content within the author's own file. False if file/comment missing. */
  async updateComment(slug: string, commentId: string, content: string): Promise<boolean> {
    const file = await this.getCommentFile(slug);
    if (!file) {
      return false;
    }
    const index = file.comments.findIndex((c) => c.id === commentId);
    if (index < 0) {
      return false;
    }
    const comments = file.comments.map((c, i) => (i === index ? { ...c, content } : c));
    await this.saveCommentFile(slug, { ...file, comments });
    return true;
  }

  /** Delete a comment within the author's own file. False if file/comment missing. */
  async deleteComment(slug: string, commentId: string): Promise<boolean> {
    const file = await this.getCommentFile(slug);
    if (!file) {
      return false;
    }
    const comments = file.comments.filter((c) => c.id !== commentId);
    if (comments.length === file.comments.length) {
      return false;
    }
    await this.saveCommentFile(slug, { ...file, comments });
    return true;
  }
}
