import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { build } from "esbuild";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const skill = join(root, "skills/widgetctl");
const builtins = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);

export async function pluginRuntime(): Promise<Map<string, Uint8Array>> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: { widgetctl: "src/cli.ts", mcp: "src/mcp.ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22.14",
    minify: true,
    legalComments: "eof",
    write: false,
    metafile: true,
    outdir: "scripts",
    outExtension: { ".js": ".mjs" },
    banner: {
      js: 'import { createRequire as __widgetctlCreateRequire } from "node:module"; const require = __widgetctlCreateRequire(import.meta.url);',
    },
  });
  for (const output of Object.values(result.metafile.outputs))
    for (const imported of output.imports)
      if (imported.external)
        assert.ok(
          builtins.has(imported.path),
          `Unbundled dependency: ${imported.path}`,
        );
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const files = new Map<string, Uint8Array>([
    ...result.outputFiles.map((output): [string, Uint8Array] => [
      `scripts/${output.path.split("/").at(-1)!}`,
      output.contents,
    ]),
    [
      "package.json",
      Buffer.from(
        JSON.stringify(
          {
            name: pkg.name,
            version: pkg.version,
            type: "module",
            license: pkg.license,
            engines: pkg.engines,
          },
          null,
          2,
        ) + "\n",
      ),
    ],
    ["native/worker.m", await readFile(join(root, "native/worker.m"))],
    ["licenses/widgetctl/LICENSE", await readFile(join(root, "LICENSE"))],
  ]);
  const packages = new Map<
    string,
    { path: string; metadata: { name: string; version: string } }
  >();
  for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes("node_modules/")) continue;
    let directory = dirname(resolve(root, input));
    while (directory !== root) {
      try {
        const metadata = JSON.parse(
          await readFile(join(directory, "package.json"), "utf8"),
        );
        if (!metadata.name || !metadata.version) {
          directory = dirname(directory);
          continue;
        }
        packages.set(`${metadata.name}@${metadata.version}`, {
          path: directory,
          metadata,
        });
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      directory = dirname(directory);
    }
  }
  for (const [identity, dependency] of [...packages].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const prefix = `licenses/${identity.replaceAll("/", "__")}`;
    files.set(
      `${prefix}/package.json`,
      await readFile(join(dependency.path, "package.json")),
    );
    const notices = (await readdir(dependency.path)).filter((name) =>
      /^(licen[sc]e|notice|copying)(\.|$)/i.test(name),
    );
    if (!notices.length && dependency.metadata.name === "bplist-parser") {
      const readme = await readFile(join(dependency.path, "README.md"), "utf8");
      const start = readme.indexOf("## License");
      assert.ok(start >= 0, "bplist-parser must retain its README license");
      files.set(`${prefix}/LICENSE`, Buffer.from(readme.slice(start)));
    } else {
      assert.ok(notices.length > 0, `Missing license notices for ${identity}`);
      for (const notice of notices.sort())
        files.set(
          `${prefix}/${notice}`,
          await readFile(join(dependency.path, notice)),
        );
    }
  }
  return files;
}

async function generatedPaths(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const paths: string[] = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = join(prefix, entry.name);
      if (entry.isDirectory())
        paths.push(
          ...(await generatedPaths(join(directory, entry.name), name)),
        );
      else paths.push(name);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return paths;
}

async function main() {
  const files = await pluginRuntime();
  if (process.argv.includes("--check")) {
    const actual = [
      "package.json",
      ...(await Promise.all(
        ["scripts", "native", "licenses"].map(async (name) =>
          (await generatedPaths(join(skill, name))).map((path) =>
            join(name, path),
          ),
        ),
      ).then((paths) => paths.flat())),
    ];
    assert.deepEqual(
      actual.sort(),
      [...files.keys()].sort(),
      "Plugin runtime file list is stale; run npm run build:plugin",
    );
    for (const [name, bytes] of files)
      assert.ok(
        Buffer.from(bytes).equals(await readFile(join(skill, name))),
        `Stale ${name}; run npm run build:plugin`,
      );
    console.log("Bundled plugin runtime is current");
    return;
  }
  for (const name of ["scripts", "native", "licenses"])
    await rm(join(skill, name), { recursive: true, force: true });
  for (const [name, bytes] of files) {
    await mkdir(dirname(join(skill, name)), { recursive: true });
    await writeFile(join(skill, name), bytes);
  }
  console.log(
    `Built standalone plugin CLI and MCP (${files.get("scripts/widgetctl.mjs")!.length} CLI bytes; ${files.get("scripts/mcp.mjs")!.length} MCP bytes; ${files.size} runtime/license files)`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
