# Spec Delta

## Purpose

Lets a reader search the wiki's page content either within the page they are viewing (and its subpages) or across the whole repository, and jump straight to a matching page.

## ADDED Requirements

### Requirement: A search control opens the search panel
The top bar SHALL provide a search control that opens the search panel. The panel SHALL also open with `Cmd/Ctrl+K` and close with `Esc`.

#### Scenario: Search button opens the panel
- **WHEN** the user activates the search control in the top bar
- **THEN** the search panel opens with the input focused

#### Scenario: Keyboard shortcut opens the panel
- **WHEN** the user presses `Cmd/Ctrl+K`
- **THEN** the search panel opens

#### Scenario: Escape closes the panel
- **WHEN** the panel is open and the user presses `Esc`
- **THEN** the panel closes

### Requirement: The search panel offers a scope selector
The panel SHALL let the user choose between searching the current page and its subpages ("This page") and searching the whole repository ("Whole wiki"). The chosen scope SHALL be remembered for that user. "This page" SHALL be unavailable when no page is open.

#### Scenario: Switching scope
- **WHEN** the user selects "Whole wiki" in the scope selector
- **THEN** subsequent searches use the whole-repository scope

#### Scenario: Scope is remembered
- **WHEN** the user reopens the panel after choosing a scope
- **THEN** the previously chosen scope is selected

#### Scenario: No page open
- **WHEN** the user opens the panel on a view that is not a page (home, graph, or settings)
- **THEN** the "This page" scope is unavailable and the whole-repository scope is used

### Requirement: Search matches page content case-insensitively
Search SHALL match the query against page body text, ignoring case, and SHALL return each matching page with its title, its path, and a snippet that contains the match.

#### Scenario: Match inside the body
- **WHEN** the user searches for a term that appears in a page's body
- **THEN** that page is returned with a snippet showing the surrounding text

#### Scenario: Case-insensitive match
- **WHEN** the query differs from the text only in letter case
- **THEN** the page is still returned

### Requirement: The "This page" scope limits results to the current page's subtree
With the "This page" scope selected, results SHALL be limited to the current page and the pages beneath it.

#### Scenario: Only the subtree is searched
- **WHEN** the user searches within "This page" for a term that appears both in the current page's subpages and elsewhere
- **THEN** only matches from the current page and its subpages are returned

### Requirement: The "Whole wiki" scope searches every page
With the "Whole wiki" scope selected, results SHALL include matches from every page in the repository, regardless of where the user currently is.

#### Scenario: Match in another section
- **WHEN** the user searches the whole wiki for a term that appears in a different top-level section
- **THEN** that page is returned

### Requirement: Results are navigable
Selecting a result SHALL open that page and close the panel.

#### Scenario: Selecting a result
- **WHEN** the user selects a result
- **THEN** the wiki navigates to that page and the panel closes

### Requirement: Hidden and reserved pages are excluded
Pages tagged hidden and the reserved files `log.md` and `README.md` SHALL NOT appear in results.

#### Scenario: Hidden page is not returned
- **WHEN** a page is tagged hidden and its body matches the query
- **THEN** it does not appear in the results

### Requirement: Search respects repository access
Search SHALL require the same access as reading the wiki. When the repository is private and the user is not signed in, the panel SHALL indicate that signing in is required. When the provider refuses reads over its quota, the panel SHALL report that rather than showing no results.

#### Scenario: Private repository without a session
- **WHEN** an anonymous user searches a private repository
- **THEN** the panel indicates that signing in is required

#### Scenario: Provider quota refusal
- **WHEN** the provider refuses the read due to a rate limit
- **THEN** the panel reports the rate limit instead of an empty result set

### Requirement: Empty queries and result limits
An empty or whitespace-only query SHALL return no results without issuing a search request. Results SHALL be bounded, and the response SHALL indicate when more matches exist than are shown.

#### Scenario: Empty query
- **WHEN** the query is empty or only whitespace
- **THEN** no search request is made and no results are shown

#### Scenario: Truncated results
- **WHEN** a query matches more pages than the result limit
- **THEN** the panel shows the bounded results and indicates that more matches exist
