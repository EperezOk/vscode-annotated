import { type AnnotationGroup, type LineRange, type Tag } from '../shared/model';
import { anchorText } from '../shared/hash';
import { addAnnotation, createGroup, makeAnnotation } from './annotationFactory';

/** The current editor selection (or whole file) to annotate. */
export interface SelectionInfo {
  /** Workspace-relative POSIX path. */
  file: string;
  /** Lines to anchor to, or null for a whole-file annotation. */
  range: LineRange | null;
}

/** Result of the group QuickPick. */
export type GroupChoice = { kind: 'existing'; id: string } | { kind: 'new' };

/** All side-effecting interactions the flow needs, injected for testability. */
export interface CreateAnnotationDeps {
  getSelection(): SelectionInfo | undefined;
  /** Working-tree text of the (workspace-relative) file, or null if it has no readable on-disk file. */
  readWorkingText(file: string): Promise<string | null>;
  resolveAuthor(): Promise<string>;
  listGroups(): Promise<AnnotationGroup[]>;
  /** Pick an existing group or choose to create a new one; undefined = cancelled. */
  pickGroup(groups: AnnotationGroup[]): Promise<GroupChoice | undefined>;
  /** New-group title; undefined = cancelled. */
  promptGroupTitle(): Promise<string | undefined>;
  /** Tag list for a new group; [] = none, undefined = cancelled. */
  pickTags(): Promise<Tag[] | undefined>;
  saveGroup(group: AnnotationGroup): Promise<void>;
  newId(): string;
  /** Current time, epoch seconds. */
  now(): number;
  hashContent(text: string): Promise<string>;
  /** Git ref to record on a NEW group (branch/tag/SHA), or null. */
  getGitRef(): Promise<string | null>;
  showInfo(message: string): void;
  showWarning(message: string): void;
}

/**
 * Drive the create-annotation flow. Returns the saved group, or undefined if the
 * user cancelled or there was nothing to annotate.
 */
export async function runCreateAnnotation(
  deps: CreateAnnotationDeps,
): Promise<{ group: AnnotationGroup; annotationId: string } | undefined> {
  const selection = deps.getSelection();
  if (!selection) {
    deps.showWarning('Annotated: open a file (and select lines) to annotate.');
    return undefined;
  }

  const text = await deps.readWorkingText(selection.file);
  if (text === null) {
    deps.showWarning('Annotated: open the file itself to annotate it — this view has no file on disk.');
    return undefined;
  }
  // A whole-file annotation has no anchored lines, so there is nothing to hash (and it can
  // never go "lines changed" stale). The read above still guards diff/virtual documents.
  const contentHash = selection.range === null ? '' : await deps.hashContent(anchorText(text, selection.range));
  const annotation = makeAnnotation({
    id: deps.newId(),
    file: selection.file,
    range: selection.range,
    contentHash,
  });

  const groups = await deps.listGroups();
  // Resolved groups are closed work — don't offer them as annotation targets.
  const choice = await deps.pickGroup(groups.filter((g) => g.status !== 'resolved'));
  if (!choice) {
    return undefined;
  }

  if (choice.kind === 'existing') {
    const group = groups.find((g) => g.id === choice.id);
    if (!group) {
      deps.showWarning('Selected group no longer exists.');
      return undefined;
    }
    const updated = addAnnotation(group, annotation, deps.now());
    await deps.saveGroup(updated);
    deps.showInfo(`Annotation added to "${updated.title}".`);
    return { group: updated, annotationId: annotation.id };
  }

  const title = await deps.promptGroupTitle();
  if (title === undefined) {
    return undefined;
  }
  const tags = await deps.pickTags();
  if (tags === undefined) {
    return undefined;
  }
  const author = await deps.resolveAuthor();
  const gitRef = await deps.getGitRef();
  const now = deps.now();
  const base = createGroup({ id: deps.newId(), title, author, tags, now, gitRef });
  const group = addAnnotation(base, annotation, now);
  await deps.saveGroup(group);
  deps.showInfo(`Created group "${group.title}".`);
  return { group, annotationId: annotation.id };
}
