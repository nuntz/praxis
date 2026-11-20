# An Export is the only way back, and a Backup is a short-lived Export

A Deployment has one file format for leaving and coming back: the Export, an archive in a documented JSON format of Praxis's own, stamped with a format version, with one file for the Deployment and one per Context. A Backup is the same file, made by the system once a day into R2 on the person's own account and deleted after 30 days. Either is restored in one way only: whole, with ids kept, into a Deployment that holds nothing yet, by the person's hand during setup. We decided this because a restore that is the same code for both is exercised every time either is tested, because merging into live data needs conflict rules nobody would ever try, and because a copy that outlives the Trash would make "removed for good" untrue.

## Considered Options

- **Export only, with nothing automatic.** Rejected: the platform's point-in-time recovery reaches 30 days back inside the same object, so it does not survive a deleted object, a lost account or a bad upgrade noticed late, and a Backup that depends on the person remembering is not one.
- **A database snapshot as the Backup, beside a readable Export.** Rejected: two formats are two restore paths, and the one used in an emergency would be the one never run.
- **A dump of the tables as the format.** Rejected: it ties the file to the schema of the day, so an older file cannot be read by newer code, and it is no use as the way in for data from elsewhere.
- **Restoring one Context into a live Deployment.** Rejected: it replaces live data on one tap, and putting back yesterday's mistake is already served by the Trash and an Entry's Versions.
- **Merging a file into live data.** Rejected: every record needs a rule for which side wins.
- **Backups kept for good.** Rejected: a record removed for good would stay in them for ever.
- **Scrubbing removed records out of old Backups.** Rejected: it rewrites the files that are meant to be left alone, and a fault in the scrub damages every Backup at once.
- **An Export of the Journal as Markdown files beside the JSON.** Rejected for now: a second format that cannot be restored from. It can be added without touching the format.
- **Encrypting Backups with a key Praxis holds.** Rejected: the bucket is on the person's account beside the objects that hold the same text, and a managed key is one more way to have a Backup nobody can open.
- **A per-Context Export.** Rejected: one more shape of file for restore to accept, and an Export of everything already holds it.

## Consequences

- The file holds each Context's Journal: Entries, Tasks and their events, Projects, Persons, References, Mentions, Follow-up links, Recurrences and Standing marks. It holds every Entry's Versions, the Trash with each item's clock, and Run records, without which changes each made, since those are lines of the change log the file does not hold, and each Context's time zone, Brief and Review times and Notification switch, kept in its own object. From the Deployment it holds the Contexts with their names, whether each is retired, the spend cap and the monthly spend totals of deleted Contexts.
- It does not hold any Conversation or the runtime's record of one, the change log, the record of a Connection's calls, Devices and their push subscriptions, or the provider key.
- A Connection is in the file and comes back ended. Its name stays as an Author, and the permission is made again by the person, because a new Deployment has a new address.
- Making an Export and restoring one are offered to the person's hand only, never to the Agent or a Connection, since the file spans Contexts.
- A restore refuses when the Deployment already holds anything. Point-in-time recovery of an object remains an operator's escape hatch described in the docs, not a feature.
- A record removed for good is gone from everything Praxis holds within 30 days of its removal, not at once, and the spec says so. A file the person downloaded is theirs, and the screens for emptying the Trash and deleting a Context say that Praxis cannot reach it. The Conversation keeps what the Agent quoted of the record until the person clears it, since it is dropped whole and never edited (ADR 0010), and the Trash's screen says so.
- The Trash's clock counts from the original delete across a restore. Anything past its 30 days when the file is restored is removed during the restore.
- Each Context's object writes its own file, so the files of one Export are not one instant. Only a record caught moving between Contexts can straddle two files. Restore settles it by id: found in both, it is kept in the destination; marked as moving with no copy elsewhere, it stays in the source.
- Backups are always on, with no switch, and setup provisions the bucket. Settings shows when the last one was made. When none has succeeded for three days a standing Notice appears in Attention and in settings; it is not a Notification.
- Deleting a Context is offered only for a retired one, by the person's hand, after typing its name and being offered an Export. It removes the object's whole storage, its part of the meaning index and its Connections, with no Trash. Its Run records go, and its spend stays as monthly totals in the Deployment object with no name attached, so the month's count against the cap never goes down. Its files in Backups go as those Backups age out.
- A restore must read a file whose format version is older than the code's, however old, and refuses one that is newer. The format version is not the tables' (ADR 0019).
- One Backup outlives its 30 days: the last that holds a Context whose object failed to upgrade, kept until that Context upgrades (ADR 0019).
- The file a person saves of one Run is a Run Transcript, not an Export.
