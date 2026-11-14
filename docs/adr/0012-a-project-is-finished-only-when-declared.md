# A Project is finished only when declared

A Project becomes Finished when the person says so, or the Agent when asked, and never because its Tasks ran out. A Project with no open Task is flagged for attention as needing a next Task or finishing. We decided this because the last open Task being done usually means the next one has not been written yet, and a Project that finished itself at that moment would release every Task Waiting on it.

## Considered Options

- **Derived from its Tasks.** Rejected: it finishes Projects that are only between Tasks, it can never finish one that holds a recurring Task, and adding a Task afterwards would have to reopen it silently.
- **Derived, with a hold the person can set.** Rejected: two ways to reach one state, and the person would have to remember to set the hold before finishing the last Task.

## Consequences

- A Task's state is derived from what has happened to it, and a Project's end is one of the things that happen: declared, then recorded.
- Finishing or dropping a Project drops the Tasks still open in it and ends their Recurrences, reported as Effects, so closing a Project never has to be refused.
- A wait on a Project ends when the Project is Finished or Dropped.
- Empty Projects linger until the person acts, so attention and the Review have to surface them.
- A Project can be reopened; the Tasks dropped with it stay Dropped.
