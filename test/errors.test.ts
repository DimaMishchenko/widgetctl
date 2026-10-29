import test from "node:test";
import assert from "node:assert/strict";
import { createController } from "../src/controller.js";
import { WidgetctlError, classifyError } from "../src/errors.js";

const udid = "00000000-0000-0000-0000-000000000001";

test("native errors have stable codes independently of diagnostic wording", async () => {
  for (const [errorName, code] of [
    ["StaleConfiguration", "STALE_CONFIGURATION"],
    ["UnavailableABI", "UNSUPPORTED_RUNTIME"],
    ["MissingDescriptor", "APP_NOT_REGISTERED"],
    ["ChoiceQueryTimeout", "QUERY_TIMEOUT"],
    ["ChoiceQueryFailed", "QUERY_FAILED"],
    ["UnsupportedChoices", "UNSUPPORTED_CHOICES"],
    ["WidgetIdentityMismatch", "IDENTITY_MISMATCH"],
  ]) {
    const controller = createController({ udid }, async () => ({
      status: "worker_rejected",
      errorName,
      error: "Localized diagnostic that callers do not need to parse",
      timings: {},
    }));
    await assert.rejects(controller.catalog(), (error) => {
      assert.ok(error instanceof WidgetctlError);
      assert.equal(error.code, code);
      assert.ok(error.recovery.length);
      assert.equal(error.result?.errorName, errorName);
      return true;
    });
  }
});

test("unknown messages do not guess codes and retryable never promises safe writes", () => {
  assert.equal(
    classifyError(Error("stale configuration timed out busy")).code,
    "OPERATION_FAILED",
  );
  assert.equal(
    classifyError(
      new WidgetctlError("write uncertain", { code: "COMMAND_TIMEOUT" }),
    ).retryable,
    false,
  );
  assert.equal(
    classifyError(
      new WidgetctlError("read-only query", { code: "QUERY_TIMEOUT" }),
    ).retryable,
    true,
  );
  assert.equal(
    classifyError(new SyntaxError("bad JSON")).code,
    "INVALID_INPUT",
  );
  assert.equal(
    classifyError(Object.assign(Error("denied"), { code: "EACCES" })).code,
    "IO_ERROR",
  );
  assert.equal(
    classifyError(new DOMException("cancelled", "AbortError")).code,
    "CANCELLED",
  );
});

test("error recovery arrays are isolated from caller changes", () => {
  const supplied = ["Export again"];
  const error = new WidgetctlError("stale", {
    code: "STALE_CONFIGURATION",
    recovery: supplied,
  });
  supplied.push("changed");
  const details = classifyError(error);
  details.recovery.push("also changed");
  assert.deepEqual(error.recovery, ["Export again"]);
});

test("callback failures retain successful results and flag an uncertain completed operation", async () => {
  const controller = createController(
    {
      udid,
      onResult: () => {
        throw Error("logger failed");
      },
    },
    async () => ({ status: "ready", timings: {} }),
  );
  await assert.rejects(controller.prepare(), (error) => {
    assert.ok(error instanceof WidgetctlError);
    assert.equal(error.code, "CALLBACK_FAILED");
    assert.equal(error.result?.status, "ready");
    assert.equal(error.retryable, false);
    return true;
  });
});

test("backend failure codes and validation codes survive the API boundary", async () => {
  const controller = createController({ udid }, async () => ({
    status: "failed",
    errorCode: "DEVICE_BUSY",
    error: "lock unavailable",
    timings: {},
  }));
  await assert.rejects(
    controller.prepare(),
    (error) => error instanceof WidgetctlError && error.code === "DEVICE_BUSY",
  );
  assert.throws(
    () => createController({ udid: "" }),
    (error) =>
      error instanceof WidgetctlError && error.code === "INVALID_INPUT",
  );
  const unknown = createController({ udid }, async () => ({
    status: "placement_persistence_unverified",
    timings: {},
  }));
  await assert.rejects(
    unknown.prepare(),
    (error) =>
      error instanceof WidgetctlError && error.code === "VERIFICATION_FAILED",
  );
});

test("unknown native exception names cannot resolve inherited mapping properties", () => {
  for (const errorName of [
    "constructor",
    "__proto__",
    "toString",
    "UnrecognizedException",
  ]) {
    const error = new WidgetctlError("unknown", {
      result: { status: "worker_rejected", timings: {}, errorName },
    });
    assert.equal(error.code, "OPERATION_FAILED");
    assert.ok(error.recovery.length);
  }
});

test("public target validation reports input errors without invoking the backend", async () => {
  const controller = createController({ udid }, async () => {
    throw Error("Backend must not run");
  });
  await assert.rejects(
    controller.ensure({
      extension: "example.widgets",
      kind: "Example",
      size: "giant" as never,
    }),
    (error) =>
      error instanceof WidgetctlError && error.code === "INVALID_INPUT",
  );
});
