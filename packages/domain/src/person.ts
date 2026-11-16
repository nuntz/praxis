/**
 * A Person as every read and write returns it (section 3.7): someone the person deals with, kept
 * by name in one Context. Nothing else is kept about them: what there is to say is said in
 * Entries that Mention them.
 */
export type Person = {
  id: string;
  name: string;
  /** When they were made, as an ISO 8601 instant. */
  at: string;
  /**
   * The latest Entry that Mentions them, by which a picker tells two Persons with one name apart,
   * or null while none does. Derived from the Entries' links, never kept on the Person.
   */
  latest_mention: { entry: string; at: string; summary: string } | null;
};
