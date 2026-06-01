## Overview

Extension to annotate a codebase.
- Annotations contain Markdown text.
- Annotations belong to groups by default. Groups have authors. User name is pulled from Git config.
- Each annotation refers to a range of (full) lines within a certain file.
- Each group can optionally be linked to a Git ref.
- Annotations are ordered within a group, and you should be able to navigate between them (eg. Prev/Next) and reorder them.
- Groups can have tags. Tags are configurable by the user (name, color), and are stored in the VSCode user config.
- Groups can be marked as "resolved", and can later be "restored".
- Annotations can have comment threads. Comments have an author and their content is Markdown.

View:
- Sidebar menu shows groups as cards. Cards show group title, author, and tags. Groups can be filtered by tag and author, and bulk-selected for updates on tags, git ref, status (resolve/restore), or to delete them. Resolved groups are not displayed by default, but there should be an option to show them (eg. via a checkbox within the filters).
- Group/Annotation details are opened on the other side, on a Webview. That's also where users can modify them.
- Group view shows author, title, tags, Git ref if present (can be set/edited), and the list of annotations it contains (one-line truncated content for each, plus file and line range). Annotations can be reordered via drag and drop.
- Annotation view shows a text area to write the Markdown content if empty; otherwise shows the Markdown preview. It also contains buttons to edit (replaces preview with text area), copy the Markdown content, copy the relative filepath + line range, and navigate to previous/next annotation in the group. Also shows the thread of (rendered) comments (with their authors) and a reply button, which opens a textarea to leave a Markdown comment.
- When selecting an annotation, the editor should navigate to the corresponding file and line range highlight/select said lines.

Persistence:
- Everything is stored as JSON files.
- Each group has its own JSON, containing all its data including the annotations (and their data, except comments).
- Each author has its own JSON, where all their comments (on annotations) are stored. Each comment has a timestamp for ordering when showing alongside other users' comments.

VSCode Commands:
- Create Annotation: An annotation is created by selecting a range of lines and executing a vscode command (ie. ctrl+shift+p => Annoated: Create Annotation, or a dedicated keybinding). This opens a QuickPick menu where you choose an existing group to append the annotation to, or the option to create a new group. If you create a new group, you are prompted to specify the name of the group first, and an existing tag later.

## Design decisions

- Having separate files for each group and author reduces race conditions on file updates. Also prevents AI from modifying user content.
- The extension should be generic, not focused on security reviews. Tags help with that. Specific workflows (including AI) can be built on top by parsing the JSON files.
- Extension packs can be created, pairing this extension with complementary ones (eg. for security review scope management and progress tracking).
- Unless an annotation is open on the side view, we don't show anything on the editor. This avoids clutter and issues like showing signs of multiple annotations on the same lines.
- We don't want to clutter the vscode command list unnecessarily. We only add dedicated commands for things that users need to do quickly/frequently outside of the sidebars.
- Testing: The agent should be able to test the extension it's developing as thoroughly as possible, including the UI interactions, without intervention of the human developer. This will speed up the development of the extension.

## Use cases

- Code reviews
- Code understanding
- Code tour
- Share annotations with others

### AI Workflows

- Leave comments for AI to perform code adjustments.
- Leave questions for AI to respond.
- Leave issues for AI to validate.
- Have AI create groups for issues from a security review (you can navigate!).
- Have AI create groups for explaining how specific things work (you can navigate!).
- Give more context to your agent for any task: it will see the issues you find, the insights you write down, the questions you have, etc.

### Complementary Extensions

- Scope manager: parse scope file and show marks in file tree. Mark regions and whole files as reviewed. Editor shows reviewed code via markers or subtle highlighting. Maybe could be stretched to cover all other relevant features from [WeAudit](https://github.com/trailofbits/vscode-weaudit).

## References

- https://github.com/saimageshvar/annotate-for-agent-vs-code
- https://www.auditlabs.ai/
- https://github.com/microsoft/codetour
- https://github.com/msanath/code-annotate
