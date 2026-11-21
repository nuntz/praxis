import { describe, expect, test } from "vitest";
import { FAKE_PUSH_KEY, setPushKeyed, subscribe } from "./push-fake.ts";
import { DAY, hand, newDeployment, value } from "./seam.ts";

// A Device is one browser's installation of Praxis (section 8.10), known by an id that browser
// keeps. The Deployment object holds a record of one only while Notifications or an Offline Copy
// is switched on there, with its push subscription. The Device tools are Deployment tools,
// offered to the hand only (section 4.11), and the oracle holds each write to changing exactly the
// Devices its Effects name.

type Deployment = ReturnType<typeof newDeployment>;

const SAFARI_ON_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const FIREFOX_ON_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0";

/** Switch Notifications on for a new Device, as its browser does once the person taps. */
async function switchOn(
  deployment: Deployment,
  user_agent = SAFARI_ON_IPHONE,
  id: string = crypto.randomUUID(),
) {
  const switched = await deployment.call(hand, "set_device_notifications", {
    id,
    on: true,
    subscription: subscribe(),
    user_agent,
  });
  const device = value(switched).record;
  if (device === null) throw new Error("Expected the Device listed");
  return device;
}

async function listed(deployment: Deployment) {
  return value(await deployment.call(hand, "list_devices", {})).items;
}

describe("set_device_notifications", () => {
  test("switched on, the Device is listed, named from its browser and system, and seen then", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const id = crypto.randomUUID();

    const switched = value(
      await deployment.call(hand, "set_device_notifications", {
        id,
        on: true,
        subscription: subscribe(),
        user_agent: SAFARI_ON_IPHONE,
      }),
    );

    const device = {
      id,
      name: "Safari on iPhone",
      notifications: true,
      offline_copy: false,
      seen: "2026-11-15T09:00:00.000Z",
    };
    expect(switched).toEqual({
      record: device,
      effects: [{ kind: "device", id, what: "made", summary: "Safari on iPhone", by: "call" }],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([device]);
  });

  test("a Device is named from its browser and system, as far as its user agent tells them", async () => {
    const deployment = newDeployment();

    const names = [
      (await switchOn(deployment, FIREFOX_ON_WINDOWS)).name,
      (await switchOn(deployment, "Mozilla/5.0 (X11; Linux x86_64)")).name,
      (await switchOn(deployment, "")).name,
    ];

    expect(names).toEqual(["Firefox on Windows", "A browser on Linux", "A browser"]);
  });

  test("switched on again with the subscription it has changes nothing; a new one is a change", async () => {
    const deployment = newDeployment();
    const id = crypto.randomUUID();
    const first = subscribe();
    const on = (subscription: typeof first) =>
      deployment.call(hand, "set_device_notifications", {
        id,
        on: true,
        subscription,
        user_agent: SAFARI_ON_IPHONE,
      });
    const made = value(await on(first)).record;

    const again = value(await on(first));
    const renewed = value(await on(subscribe()));

    expect(again).toEqual({ record: made, effects: [], changed: false });
    expect(renewed).toEqual({
      record: made,
      effects: [{ kind: "device", id, what: "changed", summary: "Safari on iPhone", by: "call" }],
      changed: true,
    });
  });

  test("switched off with nothing else on there, the Device leaves the list", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment);

    const off = value(
      await deployment.call(hand, "set_device_notifications", { id: device.id, on: false }),
    );

    expect(off).toEqual({
      record: null,
      effects: [
        { kind: "device", id: device.id, what: "deleted", summary: device.name, by: "call" },
      ],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([]);
  });

  test("switching off a Device not listed changes nothing", async () => {
    const deployment = newDeployment();

    const off = await deployment.call(hand, "set_device_notifications", {
      id: crypto.randomUUID(),
      on: false,
    });

    expect(value(off)).toEqual({ record: null, effects: [], changed: false });
  });

  test("switching on takes the browser's push subscription, at an https endpoint", async () => {
    const deployment = newDeployment();
    const good = {
      id: crypto.randomUUID(),
      on: true,
      subscription: subscribe(),
      user_agent: SAFARI_ON_IPHONE,
    };

    for (const input of [
      { ...good, subscription: undefined },
      { ...good, subscription: { ...good.subscription, endpoint: "http://push.example/1" } },
      { ...good, subscription: { endpoint: good.subscription.endpoint } },
      { ...good, user_agent: undefined },
      { ...good, id: "" },
    ]) {
      expect(await deployment.call(hand, "set_device_notifications", input)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
    expect(await listed(deployment)).toEqual([]);
  });
});

/** Switch the Offline Copy on or off for a Device, as its browser does once the person taps. */
async function offlineCopy(deployment: Deployment, id: string, on: boolean) {
  return value(
    await deployment.call(
      hand,
      "set_device_offline_copy",
      on ? { id, on, user_agent: SAFARI_ON_IPHONE } : { id, on },
    ),
  );
}

describe("set_device_offline_copy", () => {
  test("is off until switched on: then the Device is listed with it, named from its browser and system", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const id = crypto.randomUUID();
    expect(await listed(deployment)).toEqual([]);

    const switched = await offlineCopy(deployment, id, true);

    const device = {
      id,
      name: "Safari on iPhone",
      notifications: false,
      offline_copy: true,
      seen: "2026-11-15T09:00:00.000Z",
    };
    expect(switched).toEqual({
      record: device,
      effects: [{ kind: "device", id, what: "made", summary: "Safari on iPhone", by: "call" }],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([device]);
  });

  test("on a Device with Notifications on, it is a change to it, and switching it on again changes nothing", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment, FIREFOX_ON_WINDOWS);

    const switched = await offlineCopy(deployment, device.id, true);
    const again = await offlineCopy(deployment, device.id, true);

    const now = { ...device, offline_copy: true };
    expect(switched).toEqual({
      record: now,
      effects: [
        { kind: "device", id: device.id, what: "changed", summary: device.name, by: "call" },
      ],
      changed: true,
    });
    expect(again).toEqual({ record: now, effects: [], changed: false });
    expect(await listed(deployment)).toEqual([now]);
  });

  test("switched off with Notifications still on, the Device stays listed with them", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment);
    await offlineCopy(deployment, device.id, true);

    const off = await offlineCopy(deployment, device.id, false);

    expect(off).toEqual({
      record: device,
      effects: [
        { kind: "device", id: device.id, what: "changed", summary: device.name, by: "call" },
      ],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([device]);
  });

  test("switched off with nothing else on there, the Device leaves the list; off again changes nothing", async () => {
    const deployment = newDeployment();
    const id = crypto.randomUUID();
    const made = (await offlineCopy(deployment, id, true)).record;
    if (made === null) throw new Error("Expected the Device listed");

    const off = await offlineCopy(deployment, id, false);
    const again = await offlineCopy(deployment, id, false);

    expect(off).toEqual({
      record: null,
      effects: [{ kind: "device", id, what: "deleted", summary: made.name, by: "call" }],
      changed: true,
    });
    expect(again).toEqual({ record: null, effects: [], changed: false });
    expect(await listed(deployment)).toEqual([]);
  });

  test("Notifications switched off where the Offline Copy is on leave the Device listed with the copy", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment);
    await offlineCopy(deployment, device.id, true);

    const off = value(
      await deployment.call(hand, "set_device_notifications", { id: device.id, on: false }),
    );

    const now = { ...device, notifications: false, offline_copy: true };
    expect(off).toEqual({
      record: now,
      effects: [
        { kind: "device", id: device.id, what: "changed", summary: device.name, by: "call" },
      ],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([now]);
  });

  test("a renamed Device keeps its name when its Offline Copy is switched on there", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment, FIREFOX_ON_WINDOWS);
    value(await deployment.call(hand, "rename_device", { id: device.id, name: "My phone" }));

    await offlineCopy(deployment, device.id, true);

    expect((await listed(deployment)).map(({ name }) => name)).toEqual(["My phone"]);
  });

  test("removing the Device switches its Offline Copy off with everything else", async () => {
    const deployment = newDeployment();
    const id = crypto.randomUUID();
    await offlineCopy(deployment, id, true);

    value(await deployment.call(hand, "remove_device", { id }));

    expect(await listed(deployment)).toEqual([]);
  });

  test("switching on takes the browser's user agent and a Device's id", async () => {
    const deployment = newDeployment();
    for (const input of [
      { id: crypto.randomUUID(), on: true },
      { id: "", on: true, user_agent: SAFARI_ON_IPHONE },
    ]) {
      expect(await deployment.call(hand, "set_device_offline_copy", input)).toMatchObject({
        ok: false,
        error: { code: "invalid_input" },
      });
    }
    expect(await listed(deployment)).toEqual([]);
  });
});

describe("set_device_notifications without the Deployment's key", () => {
  test("refuses switching on, and the list gives no key to subscribe with", async () => {
    setPushKeyed(false);
    const deployment = newDeployment();

    const on = await deployment.call(hand, "set_device_notifications", {
      id: crypto.randomUUID(),
      on: true,
      subscription: subscribe(),
      user_agent: SAFARI_ON_IPHONE,
    });

    expect(on).toMatchObject({ ok: false, error: { code: "refused", in_the_way: [] } });
    expect(value(await deployment.call(hand, "list_devices", {}))).toEqual({
      items: [],
      push_key: null,
    });
  });
});

describe("list_devices", () => {
  test("lists each Device in the order first switched on, with the key a browser subscribes with", async () => {
    const deployment = newDeployment();
    const phone = await switchOn(deployment, SAFARI_ON_IPHONE);
    deployment.advance(DAY);
    const laptop = await switchOn(deployment, FIREFOX_ON_WINDOWS);

    const list = value(await deployment.call(hand, "list_devices", {}));

    expect(list).toEqual({ items: [phone, laptop], push_key: FAKE_PUSH_KEY });
    expect(laptop.seen).toBe("2026-11-16T09:00:00.000Z");
  });
});

describe("when a Device was last seen", () => {
  test("is when it last called a Deployment tool, which is a sighting and changes nothing", async () => {
    const deployment = newDeployment("2026-11-15T09:00:00.000Z");
    const phone = await switchOn(deployment);
    const laptop = await switchOn(deployment, FIREFOX_ON_WINDOWS);
    deployment.advance(DAY);

    value(await deployment.callFrom(phone.id, "list_contexts", {}));
    value(await deployment.callFrom(crypto.randomUUID(), "list_contexts", {}));

    expect((await listed(deployment)).map(({ seen }) => seen)).toEqual([
      "2026-11-16T09:00:00.000Z",
      laptop.seen,
    ]);
  });
});

describe("rename_device", () => {
  test("changes a Device's name, and the name it has changes nothing", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment);

    const renamed = value(
      await deployment.call(hand, "rename_device", { id: device.id, name: "My phone" }),
    );
    const again = value(
      await deployment.call(hand, "rename_device", { id: device.id, name: "My phone" }),
    );

    const now = { ...device, name: "My phone" };
    expect(renamed).toEqual({
      record: now,
      effects: [
        { kind: "device", id: device.id, what: "changed", summary: "My phone", by: "call" },
      ],
      changed: true,
    });
    expect(again).toEqual({ record: now, effects: [], changed: false });
    expect(await listed(deployment)).toEqual([now]);
  });

  test("a renamed Device keeps its name when switched on again", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment);
    value(await deployment.call(hand, "rename_device", { id: device.id, name: "My phone" }));

    await switchOn(deployment, FIREFOX_ON_WINDOWS, device.id);

    expect((await listed(deployment)).map(({ name }) => name)).toEqual(["My phone"]);
  });

  test("names only a Device listed, with a name of one line", async () => {
    const deployment = newDeployment();
    const device = await switchOn(deployment);

    for (const [input, code] of [
      [{ id: "no-such-device", name: "Laptop" }, "not_found"],
      [{ id: device.id, name: " " }, "invalid_input"],
      [{ id: device.id, name: "My\nphone" }, "invalid_input"],
    ] as const) {
      expect(await deployment.call(hand, "rename_device", input)).toMatchObject({
        ok: false,
        error: { code },
      });
    }
  });
});

describe("remove_device", () => {
  test("switches everything off there, so the Device leaves the list, from any Device", async () => {
    const deployment = newDeployment();
    const phone = await switchOn(deployment, SAFARI_ON_IPHONE);
    const laptop = await switchOn(deployment, FIREFOX_ON_WINDOWS);

    const removed = value(await deployment.call(hand, "remove_device", { id: phone.id }));

    expect(removed).toEqual({
      record: null,
      effects: [{ kind: "device", id: phone.id, what: "deleted", summary: phone.name, by: "call" }],
      changed: true,
    });
    expect(await listed(deployment)).toEqual([laptop]);
  });

  test("names only a Device listed", async () => {
    const deployment = newDeployment();

    expect(await deployment.call(hand, "remove_device", { id: "no-such-device" })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
