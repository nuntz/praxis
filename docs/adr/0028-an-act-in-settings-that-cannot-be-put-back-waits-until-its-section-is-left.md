# An act in Settings that cannot be put back waits until its section is left

ADR 0027 made Remove for good wait until the person leaves the Trash, since it was the one act with nothing to undo it. Three acts in Settings cannot be put back either. **End a Connection** stops its address working, and the outside agent needs a new Connection. **Retire a Context** ends its Connections, which bringing it back does not restore (section 3.1). **Clear the Conversation** drops the Agent's record for good. Each therefore marks what it would do and sends nothing: its row says what will happen and when, beside a Keep it that takes the mark off, and the act is sent when its section closes, by another section opened, the phone's list of sections opened, Settings closed or the Context switched, never when the app is hidden or killed. We decided this because it keeps each act a single tap, as the rest of Praxis is, and leaves the same moment to take it back that the Trash leaves, with one mark the Trash and these acts share.

## Considered Options

- **The inline confirm**, as Clear the Conversation had ("Clear it for good / Keep it"). Rejected: it is the second step ADR 0027 rejected, asking first where Praxis undoes, and two taps become a habit that protects nothing. It also dropped the focus to the page.
- **Retire acting at once when the Context has no Connections**, since then nothing that cannot be put back goes with it. Rejected: one button with two behaviours the row does not show. Retire is always marked, and its row says what else ends, "Its 2 Connections end." or "Nothing else ends."
- **One tap, sent at once**, as End and Retire were. Rejected, as ADR 0027 rejected it for the Trash.
- **Clearing everything there is when the mark is sent.** Rejected: a Brief, a Review or a Message from another Device may come between the tap and the leaving, and clearing would drop what the person was never shown, as emptying the Trash once could.

## Consequences

- Delete a Context keeps its typed name, which is section 10.4's own: it deletes everything in the Context, and an Export is offered first. Remove a Device stays one tap, since the Device can be switched on again.
- The marks live on the screen only, as the Trash's do. Until they are sent the Connection works and the Context is as it was, for every caller.
- A mark that cannot be sent does nothing, and the screen's notice says so ("Praxis could not be reached: nothing was ended."). A record already gone meanwhile is not found and nothing is said; any other refusal, such as a Run going while the Conversation would be cleared, is said in its own words.
- `clear_conversation` takes a required `up_to`: the time of the newest Message the screen had read when Clear was tapped, as `empty_trash` takes the newest delete shown. It drops what came at or before it, and keeps what came later, with its answer, placed again in the Conversation opened afresh, since the runtime's record is dropped whole and never edited (ADR 0010). It is read before the drop and placed after, so a Worker lost in between drops what it would have kept.
