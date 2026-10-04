import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyIconstate,
  persistedTarget,
  removalOutcome,
  exclusiveTargets,
  validateHomeTarget,
  positioningOutcome,
  homeWidgetPosition,
  validateResponse,
  validateConfiguration,
  selectBootedDevice,
  targetIdentity,
  validateTargetBatch,
  preservation,
} from "../src/backend-model.js";
const UDID = "11111111-1111-1111-1111-111111111111";
const widget = (changes = {}) => ({
  widgetIdentifier: "Kind",
  bundleIdentifier: "org.widgets",
  containerBundleIdentifier: "org.app",
  gridSize: "small",
  displayIdentifier: "22222222-2222-2222-2222-222222222222",
  uniqueIdentifier: "33333333-3333-3333-3333-333333333333",
  ...changes,
});
const w = widget(),
  t = persistedTarget(w),
  home = (...entries: unknown[]) => ({ iconLists: [entries] });
test("matches only exact Home tuple and retains duplicates", () => {
  const state = {
    ...home(
      w,
      widget({ gridSize: "medium" }),
      widget({ bundleIdentifier: "other" }),
    ),
    todayLists: [w],
  };
  assert.deepEqual(verifyIconstate(state, "org.widgets", "Kind", "small"), [w]);
  assert.equal(
    verifyIconstate(home(w, w), "org.widgets", "Kind", "small").length,
    2,
  );
});
test("alternate persisted field names and grid spacing", () => {
  assert.equal(
    verifyIconstate(
      home({
        ...w,
        widgetIdentifier: undefined,
        widgetKind: "Kind",
        bundleIdentifier: undefined,
        extensionBundleIdentifier: "org.widgets",
        gridSize: "S M A L L",
      }),
      "org.widgets",
      "Kind",
      "small",
    ).length,
    1,
  );
});
test("persisted identities require UUIDs", () => {
  for (const changes of [
    { displayIdentifier: "bad" },
    { uniqueIdentifier: null },
  ])
    assert.throws(() => persistedTarget(widget(changes)));
});
test("shared identities fail closed", () => {
  validateHomeTarget(home(w), t);
  assert.throws(() => validateHomeTarget(home(w, w), t));
});
test("removal preserves nested folder and leaf identities", () => {
  const before = home("app", w, { iconLists: [["nested"]] });
  assert.equal(
    removalOutcome(before, home("app", { iconLists: [["nested"]] }), t),
    null,
  );
  assert.match(removalOutcome(before, home("app"), t)!, /disappeared/);
  assert.match(removalOutcome(before, before, t)!, /still persisted/);
});
test("identity counts preserve repeated app leaves", () =>
  assert.match(preservation(home("app", "app"), home("app"))!, /disappeared/));
test("exclusive targets are limited to requested extension", () => {
  const other = widget({
    gridSize: "medium",
    displayIdentifier: "44444444-4444-4444-4444-444444444444",
    uniqueIdentifier: "55555555-5555-5555-5555-555555555555",
  });
  assert.deepEqual(
    exclusiveTargets(
      home(
        w,
        other,
        widget({
          bundleIdentifier: "other",
          displayIdentifier: "66666666-6666-6666-6666-666666666666",
          uniqueIdentifier: "77777777-7777-7777-7777-777777777777",
        }),
      ),
      "org.widgets",
      t,
    ),
    [persistedTarget(other)],
  );
  assert.throws(() =>
    exclusiveTargets(home(other, other), "org.widgets", null),
  );
});
test("position verifies original page and all identities", () => {
  const before = { iconLists: [["app", w], ["another"]] };
  assert.deepEqual(homeWidgetPosition(before, t), [0, 1]);
  assert.equal(
    positioningOutcome(before, { iconLists: [[w, "app"], ["another"]] }, t),
    null,
  );
  assert.match(
    positioningOutcome(before, { iconLists: [[w], ["another"]] }, t)!,
    /disappeared/,
  );
  assert.throws(() =>
    homeWidgetPosition({ iconLists: [[{ folder: [w] }]] }, t),
  );
});
test("batch descriptor and identities must all be validated", () => {
  const desired = { kind: "Kind", size: "small", extension: "org.widgets" };
  const r = {
    status: "validated",
    desired: { ...desired, descriptor: "desc" },
    targets: [
      { ...t, iconClass: "SBWidgetIcon", widgetIdentityVerified: true },
    ],
  };
  validateTargetBatch(r, [t], desired);
  for (const bad of [
    { ...r, targets: [] },
    { ...r, desired: { ...desired } },
    { ...r, targets: [{ ...r.targets[0], iconIdentifier: "wrong" }] },
  ])
    assert.throws(() => validateTargetBatch(bad, [t], desired));
});
test("response nonce PID status and concrete identity checked", () => {
  const r = {
    nonce: "nonce",
    pid: 123,
    status: "submitted",
    ...t,
    iconClass: "SBWidgetIcon",
    widgetIdentityVerified: true,
  };
  assert.deepEqual(validateResponse(r, "nonce", 123, t), r);
  for (const bad of [
    { ...r, pid: true },
    { ...r, pid: 124 },
    { ...r, nonce: "old" },
    { ...r, status: "bad" },
    { ...r, status: "error" },
    { ...r, iconIdentifier: "wrong" },
    { ...r, widgetIdentityVerified: undefined },
  ])
    assert.throws(() => validateResponse(bad, "nonce", 123, t));
});
const bindings = {
  udid: UDID,
  extension: "org.widgets",
  container: "org.app",
  kind: "Kind",
  size: "small",
  ...t,
};
const intent = {
  intentClass: "INAppIntent",
  appBundleIdentifier: "org.app",
  extensionBundleIdentifier: "org.widgets",
  appIntentIdentifier: "Settings",
  parameters: { entity: { identifier: "opaque", image: { uri: "preserved" } } },
};
test("configuration validates full canonical intent and exact binding", () => {
  const config = { schemaVersion: 1, ...bindings, intent };
  assert.deepEqual(validateConfiguration(config, bindings), config);
  for (const bad of [
    { ...config, udid: "other" },
    { ...config, schemaVersion: true },
    { ...config, intent: { ...intent, extra: true } },
    { ...config, intent: { ...intent, parameters: [] } },
    { ...config, intent: { ...intent, parameters: { value: Infinity } } },
  ])
    assert.throws(() => validateConfiguration(bad, bindings));
});
test("only uniquely available booted requested simulator selected", () => {
  const d = { udid: UDID, state: "Booted" };
  assert.deepEqual(selectBootedDevice([d], UDID), d);
  for (const ds of [
    [],
    [d, d],
    [{ ...d, state: "Shutdown" }],
    [{ ...d, isAvailable: false }],
  ])
    assert.throws(() => selectBootedDevice(ds, UDID));
});
test("runtime architecture and version fail closed", () => {
  const id = "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
    listing = { devices: { [id]: [{ udid: UDID }] } },
    runtime = {
      identifier: id,
      version: "27.0",
      supportedArchitectures: ["arm64"],
    };
  assert.equal(
    targetIdentity(listing, { runtimes: [runtime] }, UDID, "arm64")[0],
    "arm64-apple-ios27.0-simulator",
  );
  for (const [r, arch] of [
    [runtime, "x86_64"],
    [runtime, "arm64;evil"],
    [{ ...runtime, version: "27;evil" }, "arm64"],
  ] as const)
    assert.throws(() => targetIdentity(listing, { runtimes: [r] }, UDID, arch));
  assert.throws(() =>
    targetIdentity(
      { devices: { tvOS: [{ udid: UDID }] } },
      { runtimes: [] },
      UDID,
      "arm64",
    ),
  );
});

test("unverified live identities fail both response and removal-batch validation", () => {
  const target = t;
  assert.throws(() =>
    validateResponse(
      {
        nonce: "n",
        pid: 1,
        status: "submitted",
        ...target,
        iconClass: "SBWidgetIcon",
        widgetIdentityVerified: false,
      },
      "n",
      1,
      target,
    ),
  );
  assert.throws(() =>
    validateTargetBatch(
      {
        status: "validated",
        desired: {
          extension: "e",
          kind: "k",
          size: "small",
          descriptor: "descriptor",
        },
        targets: [
          {
            ...target,
            iconClass: "SBWidgetIcon",
            widgetIdentityVerified: false,
          },
        ],
      },
      [target],
      { extension: "e", kind: "k", size: "small" },
    ),
  );
});
