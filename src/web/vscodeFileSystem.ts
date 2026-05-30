import * as vscode from 'vscode';
import { type FileSystem, normalizePath, parentOf } from '../core/fileSystem';

function isCode(e: unknown, code: string): boolean {
  return e instanceof vscode.FileSystemError && e.code === code;
}

/** FileSystem implementation over `vscode.workspace.fs`, rooted at a workspace folder. */
export class VscodeFileSystem implements FileSystem {
  constructor(private readonly root: vscode.Uri) {}

  /** Build from the first open workspace folder. Throws if none is open. */
  static forWorkspace(): VscodeFileSystem {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error('No workspace folder open');
    }
    return new VscodeFileSystem(folder.uri);
  }

  private uri(path: string): vscode.Uri {
    const segments = normalizePath(path).split('/').filter(Boolean);
    return vscode.Uri.joinPath(this.root, ...segments);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(this.uri(path));
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const parent = parentOf(path);
    if (parent) {
      await this.createDirectory(parent);
    }
    await vscode.workspace.fs.writeFile(this.uri(path), data);
  }

  async readDirectory(path: string): Promise<string[]> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.uri(path));
      return entries.filter(([, type]) => type === vscode.FileType.File).map(([name]) => name);
    } catch (e) {
      if (isCode(e, 'FileNotFound')) {
        return [];
      }
      throw e;
    }
  }

  async createDirectory(path: string): Promise<void> {
    const segments = normalizePath(path).split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      try {
        await vscode.workspace.fs.createDirectory(this.uri(current));
      } catch (e) {
        if (!isCode(e, 'FileExists')) {
          throw e;
        }
      }
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.uri(path), { recursive: false, useTrash: false });
    } catch (e) {
      if (!isCode(e, 'FileNotFound')) {
        throw e;
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(this.uri(path));
      return true;
    } catch (e) {
      if (isCode(e, 'FileNotFound')) {
        return false;
      }
      throw e;
    }
  }
}
