import { afterEach, beforeEach, expect } from "vitest";
import { captureConsole, forget, leakedMarkers } from "./markers.ts";

captureConsole();

beforeEach(forget);

afterEach(() => {
  expect(leakedMarkers(), "A marker seeded in words appeared in something logged").toEqual([]);
});
