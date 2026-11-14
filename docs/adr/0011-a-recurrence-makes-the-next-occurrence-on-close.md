# A Recurrence makes the next occurrence when the current one is closed

A Recurrence is a rule on a Task, not a record of its own. When the Task is Finished or Dropped, the next occurrence is made as an Effect of that change, as a new Task carrying the rule. Only one occurrence is ever open, and the clock never makes one. We decided this because a missed weekly Task should be one Overdue Task and not five, and because a change that follows a rule belongs to the system and is reported as an Effect, which needs no scheduler.

The rule is either a schedule or an interval counted from the closing day. What it sets is the next occurrence's Due Date: for a schedule, the first date on it after both the current Due Date and the closing day, so occurrences missed are skipped and one closed early does not come back on the same date.

## Considered Options

- **A series record that owns its occurrences.** Rejected: it is a second thing with its own life (pause, edit, end) beside the Task, and every question about a recurring Task would have two places to answer from. Ending a Recurrence is removing the rule from the open occurrence.
- **The clock makes occurrences ahead of time.** Rejected: missed occurrences pile up, the Context's object would have to wake for it, and the changes would have no caller to report their Effects to.
- **Calendar-standard rules (RRULE).** Rejected: a large surface the Agent and outside callers would have to get right, most of it never used. A schedule says every N days, weeks on chosen weekdays, months on a day or the last day, or years.

## Consequences

- Future occurrences do not exist until their turn, so nothing can list or wait on next month's occurrence, and a view of the weeks ahead has to work them out from the rule.
- A Task with a Recurrence must have a Due Date.
- The next occurrence carries the title, the Project, the rule, the delegation, the Origin Entry and the gap in days between its defer date and its Due Date. Waits and References stay with the occurrence they were made on.
- All occurrences share one Origin Entry, so that Entry shows the whole run.
- Dropping an occurrence still makes the next one; ending the Recurrence is a separate act. Finishing or dropping a Project ends the Recurrences of the Tasks it drops.
- Reopening an earlier occurrence gives a plain Task, because the rule has moved on to the newest one.
- There is no end date or count: a Recurrence runs until the person removes it.
