import { contextObject } from "../src/context-object.ts";
import { testModel } from "./model-fake.ts";

// The Worker the tests run against: Praxis as deployed, but with each Context's Agent on the
// scripted model the test chose (test/model-fake.ts), so no test calls a real model. The plugin
// runs it in the tests' own isolate, which is how a test scripts the model.

export { DeploymentObject, default } from "../src/index.ts";

export const ContextObject = contextObject(testModel);
