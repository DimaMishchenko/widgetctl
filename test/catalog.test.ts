import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogFromResponse,
  installedWidgets,
  validateResponse,
} from "../src/backend-model.js";
import { validateOptions } from "../src/backend.js";
const icon = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const widget = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const record = () => ({
  displayIdentifier: icon,
  uniqueIdentifier: widget,
  extensionBundleIdentifier: "org.example.widgets",
  containerBundleIdentifier: "org.example",
  widgetIdentifier: "Balance",
  gridSize: "small",
});
const descriptor = () => ({
  extension: "org.example.widgets",
  container: "org.example",
  kind: "Balance",
  name: "Balance Widget",
  sizes: ["medium", "small"],
});
const apps = [{ bundleIdentifier: "org.example", name: "Example App" }];
test("catalog groups valid descriptors under real app names and canonical sizes", () => {
  assert.deepEqual(
    catalogFromResponse(
      { status: "catalogued", widgets: [descriptor()] },
      apps,
    ),
    {
      apps: [
        {
          bundleIdentifier: "org.example",
          name: "Example App",
          widgets: [
            {
              name: "Balance Widget",
              target: {
                extension: "org.example.widgets",
                container: "org.example",
                kind: "Balance",
              },
              sizes: ["small", "medium"],
            },
          ],
        },
      ],
    },
  );
});
test("catalog fails closed for ambiguous descriptors and unknown sizes", () => {
  assert.throws(
    () =>
      catalogFromResponse(
        { status: "catalogued", widgets: [descriptor(), descriptor()] },
        apps,
      ),
    /ambiguous/,
  );
  assert.throws(
    () =>
      catalogFromResponse(
        {
          status: "catalogued",
          widgets: [{ ...descriptor(), sizes: ["extraLarge"] }],
        },
        apps,
      ),
    /invalid/,
  );
});
test("installed widgets expose exact persisted identity and direct page position", () => {
  assert.deepEqual(
    installedWidgets({ iconLists: [["unrelated.app", record()]] }),
    [
      {
        target: {
          extension: "org.example.widgets",
          container: "org.example",
          kind: "Balance",
          size: "small",
          iconIdentifier: icon,
        },
        widgetIdentifier: widget,
        position: { page: 0, index: 1 },
      },
    ],
  );
});
test("installed widgets exclude unsafe nested targets and reject duplicate identities and contradictory aliases", () => {
  assert.deepEqual(
    installedWidgets({ iconLists: [[{ children: [record()] }]] }),
    [],
  );
  assert.throws(
    () => installedWidgets({ iconLists: [[record(), record()]] }),
    /exactly one/,
  );
  assert.throws(
    () =>
      installedWidgets({ iconLists: [[{ ...record(), widgetKind: "Other" }]] }),
    /ambiguous/,
  );
});
test("discovery modes are targetless while descriptions require exact widget tuple", () => {
  assert.equal(
    validateOptions({ udid: icon, mode: "catalog" }),
    icon.toUpperCase(),
  );
  assert.equal(
    validateOptions({ udid: icon, mode: "installedWidgets" }),
    icon.toUpperCase(),
  );
  assert.throws(
    () => validateOptions({ udid: icon, mode: "configurationChoices" }),
    /Widget operations require/,
  );
  assert.throws(
    () =>
      validateOptions({
        udid: icon,
        mode: "catalog",
        expectedConfiguration: {},
      }),
    /only for configuration apply or choices/,
  );
  assert.equal(
    validateResponse({ nonce: "N", pid: 1, status: "catalogued" }, "N", 1)
      .status,
    "catalogued",
  );
});

test("installed listing reads persisted state without injecting or sending worker commands", async () => {
  const { createBackend } = await import("../src/backend.js");
  const { runtime } = await import("../src/backend-runtime.js");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "widgetctl-catalog-test-"),
  );
  const calls: string[][] = [];
  try {
    const backend = createBackend(
      {
        ...runtime,
        command: async (args) => {
          calls.push(args);
          assert.deepEqual(args, [
            "xcrun",
            "simctl",
            "list",
            "devices",
            "--json",
          ]);
          return JSON.stringify({
            devices: {
              "com.apple.CoreSimulator.SimRuntime.iOS-26-0": [
                { udid: icon, state: "Booted", isAvailable: true },
              ],
            },
          });
        },
        loadIconstate: async () => [
          { iconLists: [[record()]] },
          "/IconState.plist",
        ],
        compileWorker: async () => {
          throw Error("Must not compile");
        },
        requestWorker: async () => {
          throw Error("Must not send worker command");
        },
      },
      dir,
    );
    const result = await backend({ udid: icon, mode: "installedWidgets" });
    assert.equal(result.status, "listed", result.error);
    assert.equal(result.widgets[0].target.iconIdentifier, icon);
    assert.equal(calls.length, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("real persisted bundleIdentifier widgets remain discoverable without misclassifying apps", () => {
  const persisted = record();
  const { extensionBundleIdentifier, ...rest } = persisted;
  const widgets = installedWidgets({
    iconLists: [
      [
        { bundleIdentifier: "ordinary.app" },
        { ...rest, bundleIdentifier: extensionBundleIdentifier },
      ],
    ],
  });
  assert.equal(widgets.length, 1);
  assert.equal(widgets[0]!.target.extension, extensionBundleIdentifier);
});

test("system descriptors absent from listapps use their explicit bundle identifier as the label", () => {
  const catalog = catalogFromResponse(
    { status: "catalogued", widgets: [descriptor()] },
    [],
  );
  assert.equal(catalog.apps[0].name, "org.example");
  assert.equal(catalog.apps[0].bundleIdentifier, "org.example");
  assert.equal(catalog.apps[0].widgets[0].name, "Balance Widget");
});

test("stock Smart Stack children and unrelated kind metadata do not hide valid direct widgets", () => {
  const state = {
    iconLists: [
      [
        record(),
        {
          displayIdentifier: "cccccccc-cccc-cccc-cccc-cccccccccccc",
          gridSize: "small",
          elements: [
            {
              elementType: "widget",
              widgetIdentifier: "today",
              containerBundleIdentifier: "com.apple.news",
              bundleIdentifier: "com.apple.news.widget",
              uniqueIdentifier: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            },
          ],
        },
        { kind: "folder", iconLists: [["org.example"]] },
      ],
    ],
  };
  assert.equal(installedWidgets(state).length, 1);
  assert.throws(
    () =>
      installedWidgets({
        iconLists: [
          [{ elementType: "widget", bundleIdentifier: "broken.widgets" }],
        ],
      }),
    /incomplete or unsupported/,
  );
});

test("persisted widget identifiers remain case sensitive while size aliases normalize", () => {
  assert.throws(
    () =>
      installedWidgets({
        iconLists: [[{ ...record(), widgetKind: "balance" }]],
      }),
    /ambiguous/,
  );
  assert.throws(
    () =>
      installedWidgets({
        iconLists: [
          [
            {
              ...record(),
              widgetExtensionBundleIdentifier: "ORG.EXAMPLE.WIDGETS",
            },
          ],
        ],
      }),
    /ambiguous/,
  );
  assert.equal(
    installedWidgets({ iconLists: [[{ ...record(), sizeClass: "S M A L L" }]] })
      .length,
    1,
  );
});
