# Otherlight workspace contract

`workspace.schema.json` defines the cross-platform `.otherlight` document.
Importers also accept the legacy `.transitlab` extension with the same
`workspace-v1` JSON payload.

The document stores reproducible, accepted state only. It deliberately omits
draft input text, playback time, plot and O-C histories, undo state, stored
results, artifacts, and runtime tasks.

Writers emit `workspace-v1`. Readers reject unknown versions without mutating the
active session. Scenario state uses the canonical Education V4 envelope, so the
Browser and the native app restore the same accepted model where both can
represent it. The Browser keeps `runtime.mode`, `runtime.referenceSubsteps`,
`runtime.executionMode`, and `binaryLab` across a restore and re-save. Its
general-lab form edits one planet, at most one moon, and a dark second star, so
it rejects general-lab documents with more planets or moons, or a luminous second
star, naming the unsupported content without mutating the active session.

A restored `scientific.request` is submitted and re-saved unchanged until the
Education scenario is re-applied or a Scientific run field is edited; the Browser
then compiles a new request from the active scenario.

`productContext.lab` uses the Browser lab catalog IDs: `transit-exomoon` and
`binary-stars`. Writers emit only these IDs. For compatibility with files saved
before the IDs were aligned, readers map the legacy aliases `binary-eclipse`
(earlier Apple writer) and `binary-lab` (earlier fixture) to `binary-stars`.

Text limits such as `maxLength` count Unicode code points on every platform.
