import { type AnnotationGroup, type LineRange } from '../shared/model';
import { anchorText } from '../shared/hash';
import { addAnnotation, createGroup, makeAnnotation } from './annotationFactory';

/** The current editor selection to annotate. */
export interface SelectionInfo {
  /** Workspace-relative POSIX path. */
  file: string;
  range: LineRange;
  /** Full text of the file (used to compute the anchored content hash). */
  fileText: string;
}

/** Result of the group QuickPick. */
export type GroupChoice = { kind: 'existing'; id: string } | { kind: 'new' };

/** All side-effecting interactions the flow needs, injected for testability. */
export interface CreateAnnotationDeps {
  getSelection(): SelectionInfo | undefined;
  resolveAuthor(): Promise<string>;
  listGroups(): Promise<AnnotationGroup[]>;
  /** Pick an existing group or choose to create a new one; undefined = cancelled. */
  pickGroup(groups: AnnotationGroup[]): Promise<GroupChoice | undefined>;
  /** New-group title; undefined = cancelled. */
  promptGroupTitle(): Promise<string | undefined>;
  /** Tag names for a new group; [] = none, undefined = cancelled. */
  pickTags(): Promise<string[] | undefined>;
  saveGroup(group: AnnotationGroup): Promise<void>;
  newId(): string;
  /** Current time, epoch seconds. */
  now(): number;
  hashContent(text: string): Promise<string>;
  showInfo(message: string): void;
  showWarning(message: string): void;
}

/**
 * Drive the create-annotation flow. Returns the saved group, or undefined if the
 * user cancelled or there was nothing to annotate.
 */
export async function runCreateAnnotation(deps: CreateAnnotationDeps): Promise<AnnotationGroup | undefined> {
  const selection = deps.getSelection();
  if (!selection) {
    deps.showWarning('Select one or more lines to annotate.');
    return undefined;
  }

  const contentHash = await deps.hashContent(anchorText(selection.fileText, selection.range));
  const annotation = makeAnnotation({
    id: deps.newId(),
    file: selection.file,
    range: selection.range,
    contentHash,
  });

  const groups = await deps.listGroups();
  const choice = await deps.pickGroup(groups);
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
    return updated;
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
  const base = createGroup({ id: deps.newId(), title, author, tags, now: deps.now() });
  const group = addAnnotation(base, annotation, deps.now());
  await deps.saveGroup(group);
  deps.showInfo(`Created group "${group.title}".`);
  return group;
}
