# A Recurrence makes the next Occurrence when the current one is closed

A Recurrence is a rule on a Task, not a record of its own. When the Task is Finished or Dropped, the next Occurrence is made as an Effect of that change, as a new Task carrying the rule. Only one Occurrence is ever open, and the clock never makes one. We decided this because a missed weekly Task should be one Overdue Task and not five, and because a change that follows a rule belongs to the system and is reported as an Effect, which needs no scheduler.

The rule is either a schedule or an interval counted from the closing day. What it sets is the next Occurrence's Due Date: for a schedule, the first date on it after both the current Due Date and the closing day, so Occurrences missed are skipped and one closed early does not come back on the same date.

## Considered Options

- **A series record that owns its Occurrences.** Rejected: it is a second thing with its own life (pause, edit, end) beside the Task, and every question about a recurring Task would have two places to answer from. Ending a Recurrence is removing the rule from the open Occurrence.
- **The clock makes Occurrences ahead of time.** Rejected: missed Occurrences pile up, the Context's object would have to wake for it, and the changes would have no caller to report their Effects to.
- **Calendar-standard rules (RRULE).** Rejected: a large surface the Agent and outside callers would have to get right, most of it never used. A schedule says every N days, weeks on chosen weekdays, months on a day or the last day, or years.

## Consequences

- Future Occurrences do not exist until each is made, so nothing can list or wait on next month's Occurrence, and a view of the weeks ahead has to work them out from the rule.
- A Task with a Recurrence must have a Due Date.
- The next Occurrence carries the title, the Project, the rule, the delegation, the Origin Entry and the gap in days between its Defer Date and its Due Date. Waits and References stay with the Occurrence they were made on.
- All Occurrences share one Origin Entry, so that Entry shows the whole run.
- Dropping an Occurrence still makes the next one; ending the Recurrence is a separate act. Finishing or dropping a Project ends the Recurrences of the Tasks it drops.
- Reopening an earlier Occurrence gives a plain Task, because the rule has moved on to the newest one.
- There is no end date or count: a Recurrence runs until the person removes it.
