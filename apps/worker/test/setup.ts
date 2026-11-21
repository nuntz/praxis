import { afterEach, beforeEach, expect } from "vitest";
import { setBucketRefusing } from "./bucket.ts";
import { captureConsole, forget, leakedMarkers } from "./markers.ts";
import {
  forgetMeanings,
  holdEmbedding,
  setMeaningFailing,
  setMeaningPresent,
} from "./meaning-fake.ts";
import { answering, forgetSuperseded, scriptModel, supersededScripts } from "./model-fake.ts";
import { setPushFailing, setPushKeyed } from "./push-fake.ts";
import { clearUpgradeFaults } from "./upgrade-faults.ts";

captureConsole();

beforeEach(forget);

beforeEach(() => {
  setPushFailing(false);
  setPushKeyed(true);
  setBucketRefusing(false);
  setMeaningPresent(true);
  setMeaningFailing(false);
  forgetMeanings();
  holdEmbedding()();
  clearUpgradeFaults();
});

// Every test starts with a Deployment that has a model, playing a script that only answers.
beforeEach(() => {
  forgetSuperseded();
  scriptModel(answering("Noted."));
});

afterEach(() => {
  expect(
    leakedMarkers(),
    "A marker seeded in words appeared in something logged or in a Notification",
  ).toEqual([]);
});

afterEach(() => {
  expect(
    supersededScripts(),
    "A Context asked a script this test had replaced: a Context keeps the model it was first asked with, so script once and switch inside the script, as heldAnswer() does",
  ).toEqual([]);
});
