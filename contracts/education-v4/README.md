# Education V4 contract

This directory owns the canonical Education scenario shared by Browser
workspaces and the native Swift importer.

- `scenario.schema.json` describes the complete canonical V4 scenario envelope.
- `step.schema.json` describes the serialized step output shape (occulter
  geometry, event markers, flux and timing fields).
- `scenario-fixtures.schema.json` describes `fixtures/scenarios.json`, the
  shared sample scenarios that TypeScript and Swift decode in their tests.

The sample scenarios carry no expected output. Behaviour is pinned only by
targeted tests that state the expected physics; there is no recorded output
snapshot or cross-language parity oracle, so an improvement to the Browser
model never needs a fixture regeneration to pass.
