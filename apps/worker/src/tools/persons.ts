import { failure, nameHolds, type Person, success, written } from "@praxis/domain";
import { newestFirst } from "../newest-first.ts";
import {
  insertPerson,
  type PersonRow,
  personEffect,
  personsOf,
  readPerson,
} from "../person-rows.ts";
import type { Handlers } from "../registry.ts";

const NO_SUCH_PERSON = "No such Person in this Context.";

export const personTools: Pick<
  Handlers,
  "create_person" | "rename_person" | "get_person" | "list_persons"
> = {
  create_person({ input, arrivedAt, sql }) {
    // Two Persons may share a name: a new one is never matched to one there is.
    const id = insertPerson(sql, { name: input.name, at: arrivedAt });
    const person = readPerson(sql, id) as Person;
    return success(written(person, [personEffect(person, "made")]));
  },

  rename_person({ input, sql }) {
    const person = readPerson(sql, input.id);
    if (!person) return failure("not_found", NO_SUCH_PERSON);
    if (person.name === input.name) return success(written(person, []));
    sql.exec(`UPDATE persons SET name = ? WHERE id = ?`, input.name, person.id);
    const renamed = readPerson(sql, person.id) as Person;
    return success(written(renamed, [personEffect(renamed, "changed")]));
  },

  get_person({ input, sql }) {
    const person = readPerson(sql, input.id);
    return person ? success(person) : failure("not_found", NO_SUCH_PERSON);
  },

  list_persons({ input, sql }) {
    const { named } = input;
    const page = newestFirst(
      "persons",
      input.cursor,
      (before) =>
        sql.exec<PersonRow>(`SELECT * FROM persons WHERE seq < ? ORDER BY seq DESC`, before),
      named === undefined ? undefined : (row) => nameHolds(row.name, named),
    );
    if (!page.ok) return page;
    return success({
      items: personsOf(sql, page.value.rows),
      next_cursor: page.value.next_cursor,
    });
  },
};
