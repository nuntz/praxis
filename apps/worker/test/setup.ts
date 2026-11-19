import { afterEach, beforeEach, expect } from "vitest";
import { captureConsole, forget, leakedMarkers } from "./markers.ts";
import { answering, scriptModel } from "./model-fake.ts";
import { setPushFailing, setPushKeyed } from "./push-fake.ts";

captureConsole();

beforeEach(forget);

beforeEach(() => {
  setPushFailing(false);
  setPushKeyed(true);
});

// Every test starts with a Deployment that has a model, playing a script that only answers.
beforeEach(() => {
  scriptModel(answering("Noted."));
});

afterEach(() => {
  expect(
    leakedMarkers(),
    "A marker seeded in words appeared in something logged or in a Notification",
  ).toEqual([]);
});
