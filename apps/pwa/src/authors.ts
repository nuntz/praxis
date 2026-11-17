import type { Author } from "@praxis/domain";

/** An Author as the screen names them, such as who last changed an Entry's words. */
export function authorName(author: Author): string {
  switch (author.kind) {
    case "person":
      return "you";
    case "agent":
      return "the Agent";
    case "connection":
      return author.name;
  }
}
