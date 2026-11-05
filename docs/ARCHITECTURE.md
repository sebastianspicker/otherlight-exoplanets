# Architecture

The [V7 research platform decision](adr/2026-10-08-v7-research-platform.md)
defines the accepted direction for new research work. Its implementation and
qualification remain incomplete. The operational architecture below describes
the current V4/V5/V6 clients and runtimes; legacy execution is retained until
V7 client cutover.

The service also exposes the [V7 input foundation](../contracts/science-v7/README.md)
under `/v3`: persistent original bytes, strict normalized inputs and pinned
provenance. It advertises no V7 execution. Workspace V2 migration is an explicit
offline tool; live clients still read/write Workspace V1.

Otherlight is one repository and one pnpm project — not a JavaScript package
monorepo. It combines a primary Browser application, a SwiftUI Education app, an
optional local scientific service, a static screenshot tour, and a set of
explicit cross-language contracts.

## System context

```mermaid
flowchart LR
  User["Learner or educator"] --> Browser["Browser application<br/>Education and Scientific UI"]
  User --> Mobile["Otherlight mobile<br/>Education only"]
  User --> Mac["OtherlightMac<br/>Education plus native V5 host"]
  Browser -->|save / open| Workspace[".otherlight document<br/>workspace-v1"]
  Mobile -->|save / open| Workspace
  Mac -->|save / open| Workspace
  Browser -->|"HTTP on loopback only"| Science["Python science service<br/>V5 jobs and V6 datasets"]
  Science -->|"jobs, datasets, Arrow files"| Cache["Process memory datasets<br/>and .science-cache artifacts"]
  Contracts["Versioned JSON contracts<br/>V4, V5, V6, workspace, capabilities"] -. validate .-> Browser
  Contracts -. validate .-> Mobile
  Contracts -. validate .-> Mac
  Contracts -. validate .-> Science
  Pages["GitHub Pages build"] --> Browser
  Pages --> Tour["Static screenshot tour<br/>/otherlight-exoplanets/demo/"]
  Pages -. "display-only checked-in fixture" .-> Contracts
```

The Browser and both Apple targets run Education calculations locally. The
Browser can also submit a supported scenario to the Python service, but only
through the strict loopback client and only after a compatible capability
response. The mobile app neither links nor calls the scientific runtime.
`OtherlightMac` links the V5 native package and Arrow: its Scientific profile
compiles accepted V4 authoring into strict V5, runs one cancellable session-only
job off the main actor, and exposes separate, explicit Arrow and manifest
exports.

`apps/demo/` is a separate static screenshot tour that does not execute the
simulation. The Pages workflow publishes it at `/otherlight-exoplanets/demo/`, beside the
live app at `/otherlight-exoplanets/`.

## Components and ownership

| Component                                | Responsibility                                                                                                   | Build or runtime boundary                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/browser/`                          | Scenario authoring, Education runtime, Guided Labs, visualization, workspace handling, and Scientific-profile UI | One Vite bundle in `dist/`                                       |
| `apps/apple/`                            | Shared SwiftUI Education sources, mobile app, and macOS native V5 host                                           | Isolated mobile and macOS Xcode project graphs                   |
| `apps/apple/Packages/OtherlightCore/`    | Portable models, Education, visualization, strict V5 contracts and authoring, and benchmark                      | Independent SwiftPM package                                      |
| `apps/apple/Packages/OtherlightScience/` | Experimental macOS DOP853 execution and Arrow IPC writing                                                        | Independent SwiftPM package; Mac target only                     |
| `services/science/`                      | Strict V5 jobs plus bounded V6 process-memory dataset imports                                                    | Installable Python package and loopback process                  |
| `contracts/`                             | Schemas, shared fixtures, and platform capability evidence                                                       | Serialized compatibility boundary                                |
| `apps/demo/`                             | Non-executing static screenshot tour                                                                             | Copied into the Pages artifact at `/otherlight-exoplanets/demo/` |

## Browser modular monolith

The Browser has one build and explicit source layers. Arrows point from a consumer
to a dependency:

```mermaid
flowchart RL
  Composition["composition<br/>startup wiring"] --> Presentation["presentation<br/>feature UI, canvas, CSS"]
  Presentation --> Application["application<br/>use cases and authoring"]
  Application --> Domain["domain<br/>models, simulation, physics, education"]
  Infrastructure["infrastructure<br/>workspace and HTTP adapters"] --> Application
  Infrastructure --> Domain
  Presentation --> Infrastructure
```

`domain/` cannot import browser APIs or any outer layer; `application/` cannot
import infrastructure, presentation, or composition; infrastructure cannot import
presentation or composition; and `composition/` is the only startup wiring layer.
Inside presentation, `render/` may import only `domain/` and `render/`, so canvas
drawing stays a pure projection of simulation output.
`scripts/check-architecture.mjs` enforces these imports and rejects relative
TypeScript cycles.

### Where new Browser code belongs

| Folder under `apps/browser/src/`       | Owns                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `domain/model/`                        | Authoring types, units, labs catalog, and model invariants                              |
| `domain/simulation/v4/`                | The Education V4 runtime; `index.ts` is its public surface                              |
| `domain/orbits/`, `domain/photometry/` | Orbital mechanics and photometric models registered in `docs/physics/`                  |
| `domain/education/`                    | Guided Lab lessons, learning state, signals, and reports                                |
| `application/catalog/`                 | Checked-in defaults, presets, real-system snapshot, and binary-lab defaults             |
| `application/runtime/`                 | Runtime factory and lifecycle, histories, chromatic sampling, and lesson signals        |
| `application/*.ts`                     | The V4 authoring boundary, product view state, and deployment-mode facts                |
| `infrastructure/`                      | Workspace documents, the loopback V5/V6 clients, and the chromatic worker adapter       |
| `presentation/shell/`                  | Page shell, header, product and profile navigation, DOM refs, and the error boundary    |
| `presentation/scenario/`               | Parameter form, validation, presets and catalog source, apply/reset, dirty guard        |
| `presentation/playback/`               | Frame loop, live light curve and scene building, view controls, chromatic overlay       |
| `presentation/timing/`                 | Transit-timing (O-C) panel and plot                                                     |
| `presentation/labs/`                   | Guided Lab views, lesson navigation, and learner responses                              |
| `presentation/observatory/`            | The A/B radius comparison surface                                                       |
| `presentation/science/`                | Scientific profile: V5 jobs, V6 datasets, and the Pages contract replay                 |
| `presentation/workspace/`              | `.otherlight` save/open, restoration, and URL history                                   |
| `presentation/render/`                 | Canvas primitives (`canvas/`), sky scene (`sky/`), and light-curve plot (`lightCurve/`) |
| `composition/`                         | `bootstrap.ts`, app state, startup, and the chromatic worker entry                      |

A presentation feature owns its controllers and its `templates/`. Features may
call one another's exported functions where a workflow crosses them (scenario
application resets lab and playback state, for example), but file-level import
cycles are rejected. The real-system snapshot path
`application/catalog/real-systems.snapshot.json` is shared with the Apple
projects, CI path filters, and the refresh script, so it does not move.

`apps/browser/index.html` loads `src/main.ts`, which renders the shell and
dynamically loads `src/composition/bootstrap.ts`. The composition root creates the
V4 runtime and wires the presentation features to application and infrastructure
ports. A second composition entry, `chromatic.worker.ts`, runs canonical Education
band sampling in a module worker: the application owns the pure sampler and the
bounded queue, infrastructure owns the worker adapter, and presentation owns the
colors, overlays, and overlay-specific status message.

Configurations cross the worker boundary once per scenario generation. Dynamic
requests start at most every 100 ms, with one active and one replaceable pending
request, and completed current-generation results publish even while newer work is
pending. Hidden tabs and disposal terminate worker work; showing a tab rebuilds
that generation's runtimes and resumes its requested overlay.

Fixed previews cache successful 256-point sampling using runtime identity and
mode, plot mode, display scale, measurement settings, noise seed, and the
invalidation generation. Reset, seek, and clear invalidate that metadata, while
Undo restores matching metadata and comparison range. Failed previews stay
invalid. Worker failures leave the primary simulation available and retain the
last valid same-scenario chromatic overlay.

## Principal data flows

### Education

What happens when a learner changes a parameter and applies it:

```mermaid
sequenceDiagram
  autonumber
  actor U as Learner
  participant form as applyParams.ts
  participant life as runtimeLifecycle.ts
  participant adapter as browserScenarioAdapter.ts
  participant rt as V4 runtime
  participant frames as frameLoop.ts
  U->>form: Edit form, Apply
  form->>form: readValidatedUIIntoParams
  form->>life: replaceRuntime(draft)
  life->>adapter: toEducationScenarioV4 via v4Runtime
  adapter-->>life: EducationScenarioV4
  life->>rt: create, prepare()
  rt-->>life: ready runtime
  life-->>form: swap, dispose old
  loop requestAnimationFrame
    frames->>rt: step(tSec)
    rt-->>frames: positions, flux
    frames->>frames: drawFrame + plot.draw
  end
```

Invalid input stops at step 2: the form marks the fields and the old runtime
keeps running. Steps 3–8 build the new runtime fully before the old one is
disposed, so a failed `prepare()` leaves the last valid simulation in place.
Everything happens in the page; no network request is made. The frame loop
(steps 9–11) pauses while the tab is hidden.

`BrowserScenarioDraft` is mutable authoring state. The pure draft-to-V4 mapping
lives in the domain (`domain/simulation/v4/migrateModels.ts`). Outside the domain,
drafts become a serializable `EducationScenarioV4` only through
`apps/browser/src/application/browserScenarioAdapter.ts`: `toEducationScenarioV4`
for runtime ingress (with scientific-browser validation and runtime mode) and
`toPreviewScenarioV4` for side previews such as chromatic bands and observatory
comparisons. An ESLint rule rejects direct use of the domain mapping from the
outer layers. Education output stays a teaching preview
within the model registry's stated limits. The draft holds model authoring values,
not DOM state or a cross-language wire format.

Where in the code:

- [presentation/scenario/applyParams.ts](../apps/browser/src/presentation/scenario/applyParams.ts): form validation and the apply guard
- [application/runtime/runtimeLifecycle.ts](../apps/browser/src/application/runtime/runtimeLifecycle.ts) and [v4Runtime.ts](../apps/browser/src/application/runtime/v4Runtime.ts): build-then-swap
- [application/browserScenarioAdapter.ts](../apps/browser/src/application/browserScenarioAdapter.ts): the only draft-to-V4 ingress
- [domain/simulation/v4/](../apps/browser/src/domain/simulation/v4/index.ts): the Education runtime
- [presentation/playback/frameLoop.ts](../apps/browser/src/presentation/playback/frameLoop.ts) and [frameLoopControllerShared.ts](../apps/browser/src/presentation/playback/frameLoopControllerShared.ts): stepping and drawing

### Scientific execution and hosted replay

What happens when a user runs a radial-velocity job against the local service
(normal build only):

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant ws as scienceWorkspace.ts
  participant client as ScienceBackendClient
  participant api as api_http.py
  participant svc as V5ApiService
  participant cache as .science-cache
  U->>ws: Check backend
  ws->>client: getCapabilities()
  client->>api: GET /v1/capabilities
  api-->>ws: manifest, Run enabled
  U->>ws: Run
  ws->>ws: compile V5 ForwardRunRequest
  ws->>client: submitJob(request)
  client->>api: POST /v1/jobs
  api->>svc: submit(payload)
  api-->>ws: 201, job id
  svc-)svc: run_forward_compact (thread)
  svc-)cache: write Arrow IPC artifact
  loop until terminal or budget spent
    ws->>api: GET /v1/jobs/{id}
  end
  ws->>api: GET /v1/jobs/{id}/result
  api-->>ws: result + run manifest
  ws->>ws: assertResultMatchesRequest
  ws-->>U: RV samples and provenance
```

Run stays disabled until step 4 confirms a supported capability. Step 6 is a pure
compile: the draft goes through `toEducationScenarioV4` and then
`buildScientificForwardRequestFromEducationScenarioV4`, and unsupported features
fail here, before any request. The service bounds and validates the body (steps
8–9), answers at once (step 10) and integrates on a worker thread (step 11). The
content-addressed artifact (step 12) is published unless the retained-cache quota
is full. If polling exceeds its budget, the workspace cancels the job with
`DELETE /v1/jobs/{id}` instead of waiting indefinitely. Step 16 rejects a result
that does not echo the submitted request.

Where in the code:

- [presentation/science/scienceWorkspace.ts](../apps/browser/src/presentation/science/scienceWorkspace.ts), [sciencePolling.ts](../apps/browser/src/presentation/science/sciencePolling.ts) and [scienceRequestSource.ts](../apps/browser/src/presentation/science/scienceRequestSource.ts): UI flow, polling budget, request source
- [infrastructure/science/client.ts](../apps/browser/src/infrastructure/science/client.ts): loopback-only HTTP client with bounded, validated responses
- [services/science/science_backend/api_http.py](../services/science/science_backend/api_http.py): `/v1` routes
- [services/science/science_backend/api_service.py](../services/science/science_backend/api_service.py): job table, thread pool, artifact promotion
- [services/science/science_backend/forward.py](../services/science/science_backend/forward.py): the forward model

`apps/browser/src/infrastructure/science/educationScenarioCompiler.ts` accepts
only the supported static V4 subset and emits barycentric SI state; unsupported
dynamics, fields, and fidelity modes fail closed. The client accepts only HTTP URLs
on `127.0.0.1` or `localhost`, validates responses, and bounds polling.

The GitHub Pages build has no loopback origin in its Content Security Policy and
never creates a science client request. Its Scientific view validates and projects
`contracts/science-v5/contract-cases.json#validForwardResult` as a display-only
contract replay. The current form inputs do not alter that fixture, and the replay
is neither a local run nor a scientific result.

### Workspaces

`workspace-v1` stores product context, an accepted Education V4 scenario, bounded
Guided Lab progress, and an optional validated V5 request. It omits draft text,
playback state, histories, live jobs, results, and artifacts. Readers validate the
complete document before replacing active state, and each boundary converts V4
back to Browser or Apple authoring state on the way in.

### V6 dataset imports

```text
bounded raw UTF-8 JSON -> duplicate-safe parse -> exact V6 family validation
  -> canonical JSON SHA-256 identity -> duplicate check -> freeze and size
  -> atomic quota admission
```

The `/v2` family currently exposes capability discovery and dataset CRUD only.
Imports do not accept paths, URLs, filenames, multipart bodies, archives, Arrow,
or compressed content. The job and artifact descriptor schemas establish a future
boundary, but no V6 job is accepted or advertised.

## State and persistence

- Browser session state and simulation histories live in memory.
- `.otherlight` files are user-selected portable documents; the legacy
  `.transitlab` extension stays import-compatible with the same payload.
- The science service keeps job state in process memory and retains at most the
  newest 128 terminal records by default.
- Imported V6 datasets live only in process memory and clear at shutdown. They are
  bounded by count, samples, source bytes, and retained normalized memory.
- Science artifacts are content-addressed files in `.science-cache` relative to
  the service process, and they are not embedded in workspaces. A default 1 GiB
  retained-cache quota stops publication without deleting existing artifacts,
  while active temporary output has a separate 64 MiB per-writer bound. An OS
  advisory ownership lock excludes competing writers and offline cleanup. The local
  operator CLI reports usage and removes only explicitly selected entries; there is
  no automatic expiry or backup.
- The Apple app keeps current workspace context in local preferences and uses
  sandboxed user-selected file access.

Default Python and native Swift V5 publication retain time and RV samples plus
manifest metadata. Both share propagation and collision certification with their
public rich/full-state paths, so compact collection changes retention, not the
integrator or the serialized output.

There is no database, account service, cloud synchronization, or shared
server-side state.

## Contracts and cross-runtime dependencies

- `contracts/education-v4/` owns canonical Education scenarios and shared sample
  scenarios.
- `contracts/science-v5/` owns strict requests, run manifests, canonical JSON
  cases, and shared service/client fixtures.
- `contracts/science-v6/` owns strict dataset imports and the additive timing
  request, job, artifact, and provenance V3 shapes. Timing remains a contract, not
  an available execution path, and V6 does not revise V5.
- `contracts/workspace-v1/` owns `.otherlight` documents.
- `contracts/capabilities-v1/manifest.json` is the platform capability and
  automated-evidence registry.

TypeScript, Python, and Swift validate these shapes independently: they share no
implementation code and never infer one another's data structures. An intentional
serialized change must update the schema, fixtures, validators, consumers, and
compatibility evidence together.

The Apple app bundles the Browser-owned checked-in real-system snapshot, and the
portable Swift package reads checked-in Education and V5 fixtures for parity. Those
are explicit data dependencies, not runtime service calls.

## External and security boundaries

The normal Browser build carries strict clients for the local V5 endpoint and the
V6 dataset lifecycle. Its local-only Scientific profile exposes bounded dataset
import, listing, metadata, and deletion; Pages omits that surface. The Python
service requires loopback Host values and rejects unapproved browser Origins, but
it has no authentication, authorization, tenancy, TLS, or supported remote
deployment. Those checks do not isolate mutually hostile same-user local
processes.

Neither Apple target has a runtime network client or an outbound-network
entitlement. `OtherlightMac` alone resolves and links the pinned Arrow-backed
science package, and mobile dependency checks reject it. The maintainer-triggered
real-system catalog refresh reads NASA TAP and rewrites a checked-in snapshot;
normal Browser, Apple, and service operation never fetches that catalog.

## Build and deployment boundaries

How a change is checked and published. Nothing deploys on push: CI runs on pull
requests to `main` or `dev`, and Pages and the macOS DMG are started by hand.

```mermaid
flowchart LR
  pr(["Pull request"]) --> ci["ci.yml<br/>lint, typecheck, python, build"]
  pr -->|"Apple paths changed"| apple["native-apple.yml<br/>SwiftPM + app tests"]
  manual(["Manual dispatch"]) --> pages["pages.yml<br/>ci:verify, build:pages:site, smoke:pages"]
  manual --> dmg["native-macos-dmg.yml"]
  ci -.->|"pnpm build, uv build"| discard[("build checks,<br/>not uploaded")]
  dmg -.->|"unsigned, checksummed"| discard
  pages -->|"deploy-pages"| site["GitHub Pages<br/>app + /demo/"]
  classDef focus fill:#fde68a,stroke:#b45309,color:#1f2937
  class site focus
```

The Pages site is the only thing a workflow publishes, and it is the
`build:pages` variant with science requests disabled. The workflows build the
`dist/` bundle, the Python wheel and the unsigned DMG only to prove they build
and keep none of them; the only uploads are Python and Apple benchmark reports.
Signing and notarizing a
release DMG are manual steps (see the [runbook](RUNBOOK.md)). `codeql.yml` and
`security.yml` also run on pushes to `main`/`dev`, and `dependency-audit.yml`
runs weekly; all three scan and publish nothing.

- `pnpm build` creates the ordinary Browser bundle in `dist/` with the
  loopback-only science allowance.
- `pnpm build:pages` creates the `/otherlight-exoplanets/` Pages variant with V5 requests
  disabled. The Pages workflow is the only automated publication path.
- `pnpm build:pages:site` builds that variant and copies the static tour to
  `dist/demo/`, which the workflow publishes as `/otherlight-exoplanets/demo/`.
- `pnpm build:demo` builds the tour on its own into `pages-dist/` for local review.
- The Python package can be built as a wheel, but no remote service deployment is
  defined.
- Apple CI builds and tests unsigned artifacts. Developer ID signing,
  notarization, and release verification are explicit manual operations.

## Invariants and non-goals

- Education results never substitute for a missing V5 result.
- A fixture replay never claims runtime execution.
- Unknown contract versions and fields fail closed.
- The science service stays loopback-only until a separate authenticated
  deployment design exists.
- V5 currently produces radial velocity only; it does not provide photometry,
  astrometry, inference, relativity, time-scale conversion, impacts, or remote
  execution.
- V6 currently imports datasets only. Its job and result schemas are neither
  scientific execution nor availability evidence.
- Browser layer separation does not imply separately published packages.
- The static tour and screenshots are presentation evidence, not runtime proof.

For the operational and scientific details, see the
[operations runbook](RUNBOOK.md), [validation boundaries](validation.md), and
[physics overview](physics/overview.md).

## Planned boundaries

New binding research decisions are recorded under `docs/adr/`. The V7 decision
supersedes conflicting future-direction statements here. Every boundary below is current
direction that may be revised whenever an improvement calls for it.

- The portable mobile Education app and the macOS-only scientific host are
  separate targets (implemented).
- `science-v6` and the `/v2` routes are an additive contract and route family
  next to V5; V5 clients keep working while V6 grows.
- V6 transit timing is planned to derive events from certified dense
  trajectories with explicit ephemerides and bounded numerical error.

The V6 dataset portion is implemented in the Python service and the Browser
product surface; its job, model, and Swift portions remain pending. The target
split, the portable V5 authoring compiler, the session coordinator, and the
explicit Mac exports are implemented. Live Mac visual and
accessibility review and the mobile archive gate remain before the scientific
boundary can be presented as available.
