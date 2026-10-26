import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
test(
  "native ABI and descriptor preflight reject incompatible runtime contracts",
  { skip: process.platform !== "darwin" },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "widgetctl-native-contracts-"),
    );
    try {
      const executable = join(directory, "native-contracts");
      const source = fileURLToPath(
        new URL("fixtures/native-contracts.m", import.meta.url),
      );
      await execute(
        "xcrun",
        [
          "clang",
          "-framework",
          "Foundation",
          "-fobjc-arc",
          "-fblocks",
          "-Wall",
          "-Wextra",
          "-Werror",
          source,
          "-o",
          executable,
        ],
        { timeout: 30000, killSignal: "SIGKILL" },
      );
      const env = { ...process.env };
      delete env.WIDGETCTL_SESSION_DIR;
      delete env.WIDGETCTL_IDENTITY;
      delete env.WIDGETCTL_UDID;
      const { stdout } = await execute(executable, [], {
        env,
        timeout: 10000,
        killSignal: "SIGKILL",
      });
      assert.equal(stdout.trim(), "native contracts: 8 checks passed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
