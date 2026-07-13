# UI Writing

## Actions

Use labels that name the result: `Start audit`, `View report`, `Save changes`, `Export PDF`, `Delete audit`, and `Publish now`. Use sentence case. Loading labels describe the current action.

## States

- Empty states say what is absent and identify the next useful action.
- Errors say what failed, whether collected data is safe, and what the user can do.
- Status labels use `Waiting to start`, `Checking your site`, `Completed with warnings`, `Failed`, and `Cancelled`.
- Infrastructure names and internal identifiers never appear in customer messages.

Avoid generic messages such as "Oops", "No data", or "Something went wrong".
