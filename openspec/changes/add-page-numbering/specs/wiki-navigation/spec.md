# Spec Delta

## Purpose

Gives every wiki page and folder a hierarchical section number (1, 1.1, 1.1.2) derived from its place in the sidebar tree, so people can reference a page by its position without storing any numbering in the repository.

## ADDED Requirements

### Requirement: Hierarchical section numbers follow the navigation tree
The system SHALL assign every navigation node — folders and pages alike — a section number derived from its position among its ordered siblings. Top-level nodes SHALL be numbered `1`, `2`, `3`, … and a child SHALL be numbered `<parent number>.<position>` (for example `1.1`, `1.1.2`).

#### Scenario: Top-level nodes are numbered sequentially
- **WHEN** the sidebar tree has three top-level nodes in order
- **THEN** their section numbers are `1`, `2`, and `3`

#### Scenario: Nested nodes extend the parent number
- **WHEN** the node numbered `1` has two ordered children, and the first child has one child
- **THEN** the children are numbered `1.1` and `1.2`, and the grandchild is numbered `1.1.1`

#### Scenario: A folder that is also a page gets a single number
- **WHEN** a folder is merged with a same-named page into one sidebar node
- **THEN** that node has exactly one section number and it is not duplicated

### Requirement: Section numbers use the effective sidebar order
Section numbers SHALL be derived from the same order the sidebar displays: children listed in `.commonplace/order.yaml` first, in that order, followed by the remaining children sorted by title. Numbers SHALL NOT use a separate ordering source.

#### Scenario: Reordering changes the numbers
- **WHEN** a user drags a node to a new position among its siblings
- **THEN** the moved node and its affected siblings are renumbered to match the new display order

#### Scenario: Unlisted children sort by title
- **WHEN** a sibling group has no entry in `.commonplace/order.yaml`
- **THEN** its nodes are numbered in title order

### Requirement: The sidebar displays section numbers
The sidebar SHALL display each numbered node's section number adjacent to its label, for both folder rows and page rows.

#### Scenario: Folder and page rows show their number
- **WHEN** the sidebar renders a numbered folder and a numbered page
- **THEN** each row shows its section number next to its label

### Requirement: Page and directory views display the section number
The page view SHALL display the section number next to the page title. The directory view SHALL display the section number of the directory's corresponding navigation node next to its title.

#### Scenario: A page title shows its number
- **WHEN** a user opens a page whose node is numbered `2.3`
- **THEN** the page title is displayed with `2.3` alongside it

#### Scenario: A directory title shows its number
- **WHEN** a user opens a directory whose node is numbered `1.2`
- **THEN** the directory title is displayed with `1.2` alongside it

### Requirement: Section numbers update automatically
Section numbers SHALL be recomputed whenever the navigation tree changes, including when pages or folders are added, removed, moved, renamed, or reordered. No section number SHALL be persisted in page content or frontmatter, and no number SHALL be edited by hand.

#### Scenario: Adding a page renumbers its siblings
- **WHEN** a page is added between two existing siblings
- **THEN** the new page and the siblings after it are renumbered in the sidebar and on their pages

#### Scenario: Numbers survive a reload without being stored
- **WHEN** the wiki is reloaded after a reorder
- **THEN** the displayed numbers match the persisted order without any number having been written to the repository

### Requirement: Non-navigational entries are not numbered
The system SHALL NOT display a section number for entries outside the numbered navigation tree, including the home link, the knowledge graph link, filtered search results, and pages hidden from the navigation.

#### Scenario: Hidden pages carry no number
- **WHEN** a page is tagged hidden and excluded from the navigation tree
- **THEN** it is not assigned or shown a section number in the sidebar

#### Scenario: Search results carry no number
- **WHEN** the sidebar shows filtered search results instead of the tree
- **THEN** the results are listed without section numbers
