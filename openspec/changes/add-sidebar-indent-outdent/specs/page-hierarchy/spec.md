# Spec Delta

## Purpose

Lets a wiki editor change where a page or folder sits in the navigation tree — nesting it under a sibling or lifting it to its parent's level — directly from the sidebar, carrying its whole subtree along.

## ADDED Requirements

### Requirement: Indenting a node nests it under its preceding sibling
The system SHALL provide an indent action that moves the selected node, together with its whole subtree, so it becomes the last child of the immediately preceding sibling in the same group.

#### Scenario: Indent a page under the folder above it
- **WHEN** a user indents a page whose preceding sibling is a folder
- **THEN** the page becomes the last child of that folder and appears indented under it

#### Scenario: Indented node lands after existing children
- **WHEN** a user indents a page whose preceding sibling already has children
- **THEN** the page is placed after all of that sibling's existing children

### Requirement: Indenting under a page promotes that page to a folder parent
When the preceding sibling is a page that has no folder of its own, the system SHALL make it the folder's own page (a merged page-and-directory node) and move the indented node into the new directory, without changing the preceding page's content.

#### Scenario: Preceding page becomes a folder
- **WHEN** a user indents a page directly below a plain page
- **THEN** the plain page becomes an expandable folder node and the indented page is its child

### Requirement: Outdenting a node lifts it to its parent's level
The system SHALL provide an outdent action that moves the selected node, together with its whole subtree, into its parent's parent directory and places it immediately after its former parent.

#### Scenario: Outdent a child
- **WHEN** a user outdents a node that is the child of a folder
- **THEN** the node moves to the folder's level and appears right after the folder

#### Scenario: Outdent a deeply nested node
- **WHEN** a user outdents a node several levels deep
- **THEN** the node moves up exactly one level and keeps its position relative to its former parent

### Requirement: Moving a node carries its subtree
Indenting or outdenting a folder SHALL move every descendant page and folder with it and SHALL preserve their relative structure.

#### Scenario: Move a folder with descendants
- **WHEN** a user indents a folder that contains pages and subfolders
- **THEN** the entire folder tree appears under the new parent unchanged

### Requirement: Folder nodes without their own page can be moved
The system SHALL support indenting and outdenting a folder that has no page of its own by moving the folder and everything under it.

#### Scenario: Move a folder that has no page
- **WHEN** a user outdents a folder that has no same-named page
- **THEN** the folder and its contents move up one level

### Requirement: Indent and outdent are offered on each row and on the active page
The sidebar SHALL show the indent and outdent controls on each row when the row is hovered or focused, and SHALL keep them visible on the row of the page currently being viewed.

#### Scenario: Hover reveals the controls
- **WHEN** a user points at a sidebar row
- **THEN** that row's indent and outdent controls become visible

#### Scenario: Active page keeps its controls visible
- **WHEN** a page is open and its row is in the sidebar
- **THEN** that row's controls stay visible without hovering

### Requirement: Impossible moves are disabled
The system SHALL disable indent when the node has no preceding sibling and disable outdent when the node is at the top level. The controls SHALL also be disabled while a move is in flight and when the signed-in user cannot write to the repository.

#### Scenario: First sibling cannot be indented
- **WHEN** a node is the first child of its group
- **THEN** its indent control is disabled

#### Scenario: Top-level node cannot be outdented
- **WHEN** a node sits at the top level of the wiki
- **THEN** its outdent control is disabled

#### Scenario: Read-only or busy controls are disabled
- **WHEN** the user lacks write access or a move is already in flight
- **THEN** the indent and outdent controls are disabled

### Requirement: A move keeps references and order consistent
Each indent or outdent SHALL move the node and its subtree, rewrite bundle-absolute links inside the moved files, keep `.commonplace/order.yaml` in step, and append a Move entry to `log.md`.

#### Scenario: Links follow the move
- **WHEN** a moved page contains links to pages that move with it
- **THEN** those links still resolve after the move

#### Scenario: Sidebar order reflects the new position
- **WHEN** a node is indented or outdented
- **THEN** `.commonplace/order.yaml` is updated so the sidebar shows the node in its new position

### Requirement: Failed moves leave the tree unchanged
If a move fails, the sidebar SHALL restore the tree to its previous state, show an error, and leave the repository unchanged.

#### Scenario: Provider rejects the move
- **WHEN** the move request fails
- **THEN** the tree returns to its prior shape and an error message is shown
