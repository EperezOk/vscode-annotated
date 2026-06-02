import * as vscode from 'vscode';
import { type AnnotationGroup } from '../shared/model';
import { type TagColor } from '../shared/protocol';
import {
  gutterBarsByLine,
  buildGutterSvg,
  decorationGroups,
  annotationsAtLine,
  hoverMarkdown,
  hoverItems,
} from '../core/gutterIndicators';

/**
 * Renders in-editor gutter indicators for all non-resolved annotations. One decoration
 * type is cached per color signature (its gutter icon is a composed multi-bar SVG + an
 * overview-ruler color); each decorated line carries a trusted hover with command links
 * to open the covering annotation(s). Palette colors are trusted extension settings and
 * must be valid CSS color strings (they are interpolated into the SVG / ruler color).
 */
export class GutterDecorationManager {
  private types = new Map<string, vscode.TextEditorDecorationType>();

  /** Recompute and apply gutter decorations for the given (visible) editors. */
  refresh(editors: readonly vscode.TextEditor[], groups: AnnotationGroup[], palette: TagColor[]): void {
    const used = new Set<string>();

    for (const editor of editors) {
      const file = vscode.workspace.asRelativePath(editor.document.uri, false);
      const byLine = gutterBarsByLine(groups, file, palette);
      const optionsByType = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();

      for (const { signature, colors, lines } of decorationGroups(byLine)) {
        used.add(signature);
        const type = this.typeFor(signature, colors);
        optionsByType.set(
          type,
          lines
            .filter((line) => line >= 1 && line <= editor.document.lineCount)
            .map((line) => ({
              range: editor.document.lineAt(line - 1).range,
              hoverMessage: this.hoverFor(groups, file, line),
            })),
        );
      }

      // Apply each known type's options for this editor, clearing types not used here.
      for (const type of this.types.values()) {
        editor.setDecorations(type, optionsByType.get(type) ?? []);
      }
    }

    // Dispose signatures no longer present anywhere (keeps the cache bounded).
    for (const [signature, type] of this.types) {
      if (!used.has(signature)) {
        type.dispose();
        this.types.delete(signature);
      }
    }
  }

  private typeFor(signature: string, colors: string[]): vscode.TextEditorDecorationType {
    let type = this.types.get(signature);
    if (!type) {
      type = vscode.window.createTextEditorDecorationType({
        gutterIconPath: vscode.Uri.parse(buildGutterSvg(colors)),
        gutterIconSize: 'contain',
        overviewRulerColor: colors[0],
        overviewRulerLane: vscode.OverviewRulerLane.Center,
      });
      this.types.set(signature, type);
    }
    return type;
  }

  private hoverFor(groups: AnnotationGroup[], file: string, line: number): vscode.MarkdownString {
    const md = new vscode.MarkdownString(hoverMarkdown(hoverItems(annotationsAtLine(groups, file, line))));
    md.isTrusted = true;
    return md;
  }

  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.types.clear();
  }
}
