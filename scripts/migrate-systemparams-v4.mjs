#!/usr/bin/env node
/** Migrates legacy Browser scenario JSON through the authoritative V4 mapper. */
/* global console, process */
import { Buffer } from "node:buffer";
import { createServer } from "vite";

const MAX_STDIN_BYTES = 10 * 1024 * 1024;
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function migrateControlPath(controlPath) {
  if (typeof controlPath !== "string") return controlPath;
  if (controlPath === "star.photometry" || controlPath.startsWith("star.photometry."))
    return controlPath.slice("star.".length);
  if (controlPath === "star" || controlPath.startsWith("star."))
    return `bodies.stars.0${controlPath.slice("star".length)}`;
  if (controlPath === "planet" || controlPath.startsWith("planet."))
    return `bodies.planets.0${controlPath.slice("planet".length)}`;
  if (controlPath === "moon.orbitAroundPlanet" || controlPath.startsWith("moon.orbitAroundPlanet."))
    return `bodies.moons.0.orbit${controlPath.slice("moon.orbitAroundPlanet".length)}`;
  if (controlPath === "moon" || controlPath.startsWith("moon."))
    return `bodies.moons.0${controlPath.slice("moon".length)}`;
  return controlPath;
}

/** Refuses input that is already V4 or is not a Browser draft, so a re-run cannot reset a system to defaults. */
function assertMigratableInput(input, passthroughV4) {
  const draft = isObject(input.defaults) ? input.defaults : input;
  if (input.version === "4" || draft.version === "4") {
    if (passthroughV4) return false;
    throw new Error(
      "Input is already Education V4; refusing to migrate it. Pass --passthrough-v4 to copy it unchanged.",
    );
  }
  if (!isObject(draft.star) || !isObject(draft.planet)) {
    throw new Error("Input is neither a Browser scenario draft nor Education V4; refusing to migrate it.");
  }
  return true;
}

async function migrate(input, passthroughV4) {
  if (!isObject(input)) throw new Error("Input must be a JSON object.");
  if (!assertMigratableInput(input, passthroughV4)) return input;
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
  });
  try {
    const { mapBrowserScenarioDraftToEducationScenarioV4 } = await server.ssrLoadModule(
      "/apps/browser/src/domain/simulation/v4/migrateModels.ts",
    );
    if (!isObject(input.defaults)) return mapBrowserScenarioDraftToEducationScenarioV4(input);
    const output = {
      ...input,
      defaults: mapBrowserScenarioDraftToEducationScenarioV4(input.defaults),
    };
    if (isObject(input.ui) && Array.isArray(input.ui.controls))
      output.ui = {
        ...input.ui,
        controls: input.ui.controls.map((control) =>
          isObject(control) ? { ...control, path: migrateControlPath(control.path) } : control,
        ),
      };
    if (isObject(input.meta))
      output.meta = { ...input.meta, version: 4, schema: "EducationScenarioV4+Controls/v4" };
    return output;
  } finally {
    await server.close();
  }
}

async function main() {
  const usage = "Usage: pnpm migrate:v4 [--passthrough-v4] < input.json > output.json";
  const args = process.argv.slice(2);
  const passthroughV4 = args.includes("--passthrough-v4");
  if (args.length > (passthroughV4 ? 1 : 0)) throw new Error(usage);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_STDIN_BYTES) throw new Error(`Input exceeds ${MAX_STDIN_BYTES} bytes.`);
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) throw new Error(usage);
  process.stdout.write(`${JSON.stringify(await migrate(JSON.parse(text), passthroughV4), null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
