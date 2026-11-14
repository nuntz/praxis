# Tasks have no parts; a Project is the only container

A Task is one thing to do and cannot contain other Tasks. Work that turns out to have parts becomes a Project, which is the only thing that contains Tasks, and the Task keeps its Origin Entry when it does. We decided this because sub-tasks mostly exist where making a project is heavy, and here the Agent makes it one sentence. Order between pieces of work is expressed separately: a Task can wait on other Tasks or Projects.

## Considered Options

- **One level of sub-tasks.** Rejected: a Task with children and a Project would both mean "a thing made of Tasks", and the line between them would need a rule nobody could remember.
- **Arbitrary nesting.** Rejected: derived state would have to roll up through every level, and a personal task manager does not need a work breakdown structure.

## Consequences

- Derived Task state never depends on children, only on the Task's own history, what it waits on, and whether it is delegated.
- Because a Task can grow into a Project while something waits on it, a Task can wait on a Project, so a Project needs a finished state of its own.
- Turning a Task into a Project has to be cheap, in the tools and in the UI, or people will miss sub-tasks.
