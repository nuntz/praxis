import { afterAll, afterEach, beforeEach, expect } from "vitest";
import { setBucketRefusing } from "./bucket.ts";
import { takeHarnessFaults } from "./harness-faults.ts";
import { captureConsole, forget, leakedMarkers } from "./markers.ts";
import {
  forgetMeanings,
  holdEmbedding,
  setMeaningFailing,
  setMeaningPresent,
} from "./meaning-fake.ts";
import {
  answering,
  forgetSuperseded,
  forgetUnresolved,
  scriptModel,
  supersededScripts,
  unresolvedRequests,
} from "./model-fake.ts";
import { setPushFailing, setPushKeyed } from "./push-fake.ts";
import { clearUpgradeFaults } from "./upgrade-faults.ts";
import { resetVoice } from "./voice-fake.ts";

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
  resetVoice();
});

// Every test starts with a Deployment that has a model, playing a script that only answers.
beforeEach(() => {
  forgetSuperseded();
  forgetUnresolved();
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

afterEach(() => {
  expect(
    unresolvedRequests(),
    "The model was asked to remove or add again a tool it was not offered, which the provider refuses (tool_reference_unresolved): a request filtered to fewer tools filters toolsRemoved as it does toolsAdded",
  ).toEqual([]);
});

// A fault thrown off a test's path is only logged, so the harness looks for one after each test,
// and once the file's last is done, after the alarms then due have fired, as they do at once.
function noHarnessFault() {
  expect(
    takeHarnessFaults(),
    "The harness found a fault of a fake or one of its guards, thrown where no test awaited it",
  ).toEqual([]);
}
afterEach(noHarnessFault);
afterAll(async () => {
  await new Promise((fired) => setTimeout(fired, 100));
  noHarnessFault();
});
