import { contextObject } from "../src/context-object.ts";
import { deploymentObject } from "../src/deployment-object.ts";
import { refusableBucket } from "./bucket.ts";
import { testMeaning } from "./meaning-fake.ts";
import { testModel } from "./model-fake.ts";
import { fakePush } from "./push-fake.ts";

// The Worker the tests run against: Praxis as deployed, but with each Context's Agent on the
// scripted model the test chose (test/model-fake.ts), so no test calls a real model, its meaning
// index on the fake (test/meaning-fake.ts), its Notifications sent to the fake push service
// (test/push-fake.ts), and its Backups kept in a bucket a test can make refuse them
// (test/bucket.ts). The plugin runs it in the tests' own isolate, which is how a test scripts the
// model and reads what was pushed.

export { default } from "../src/index.ts";

export class DeploymentObject extends deploymentObject(() => fakePush) {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, { ...env, BACKUPS: refusableBucket(env.BACKUPS) });
  }
}

/**
 * How far before the real now an alarm may be set: the runtime arms one a few milliseconds back
 * for work already due, as a scripted retry is. A test's time is days or years from the real one.
 */
const ALARM_SLACK = 60 * 1000;

/**
 * The platform fires an alarm by the real clock, and one set in the past fires at once. A Context's
 * object keeps its own clock, which a test sets, and arms the platform's alarm by the real clock
 * it stands from. One armed at a test's time unconverted would wake the object at the real time
 * while the test runs, starting a Brief or pruning by a date the test never set: that fails here.
 */
export class ContextObject extends contextObject(testModel, testMeaning) {
  constructor(ctx: DurableObjectState, env: Env) {
    const setAlarm = ctx.storage.setAlarm.bind(ctx.storage);
    ctx.storage.setAlarm = (time, options) => {
      const at = typeof time === "number" ? time : time.getTime();
      if (at < Date.now() - ALARM_SLACK) {
        throw new Error(
          `A Context's alarm was set at ${new Date(at).toISOString()}, before the real now: an instant of the object's clock was given to the platform unconverted.`,
        );
      }
      return setAlarm(time, options);
    };
    super(ctx, env);
  }
}
