# V7 research inputs

V7 is the authoritative direction for new research, as specified by the
[architecture decision](../../docs/adr/2026-10-08-v7-research-platform.md).
This directory currently implements the **input foundation**, not the complete
research release. No V7 observable or forward job is qualified or advertised.

## Implemented contract

| Schema                | Meaning                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common`              | SHA-256 references, split Julian dates, arrival-time conventions and numerical-budget fractions                                                                         |
| `scenario`            | Explicit SI Cartesian initial state for 2–8 massive bodies, Newtonian model identifier and stop-at-contact policy, at most 30 Julian years                              |
| `observations`        | Reduced measurements for flux, RV, event O−C or tangent-plane astrometry, with exposures, masks, instruments, units, corrections and independent Gaussian uncertainties |
| `calibration`         | Versioned tabulated passband, explicit photon/energy weighting, linear interpolation and rejection outside its domain                                                   |
| `provenance`          | Immutable input hashes, software/operation version, citations and licences                                                                                              |
| `job-request`         | Immutable scenario/data/calibration bindings, requested numerical tolerances and work budgets; execution currently unavailable                                          |
| `resource-descriptor` | Distinguishes the descriptor version from the contained resource version, including `workspace-v2` and original bytes                                                   |

Schemas are generated from the dependency-free Python runtime definitions in
`research_schema.py` and `research_contracts.py`. Unknown fields, nonfinite
numbers, duplicate JSON keys and implicit coercions are rejected by the service.
The repository contract checker also checks cross-field units, dimensions,
time spans, passband grids, initial contact and error-budget allocation.

```sh
python scripts/export-research-contracts.py --check
pnpm contracts:check
```

Fixtures contain synthetic examples and zero hashes as illustrative references;
they are not executable jobs or published observational evidence. The service
requires actual stored dependencies, never these illustrative hashes.

## Time and uncertainty

Each time uses an integer `jd1` and `jd2` in `[-0.5, 0.5)`. Scale, observer or
barycentric arrival reference, and exposure start/midpoint/end are mandatory.
UTC inputs require a pinned leap-second reference source. No scale conversion,
barycentric correction, observer inference or leap-second interpretation is
performed during storage. The 30-year admission limit covers full exposure
windows in nominal split-JD days. Exact elapsed UTC time and its leap-second
boundaries still require the future pinned time converter before execution.
Rows remain in nondecreasing timestamp order; duplicate times are allowed.

Flux is dimensionless, recession RV is in m/s, event residuals are in seconds
against an explicit epoch/period, and astrometry is the ordered pair
`[xi, eta]` in radian tangent-plane units, with an explicit ICRS tangent point
and `gnomonic-icrs-v1` projection. These are gnomonic standard coordinates,
not raw RA/Dec or an implicitly linearized RA difference. For tangent point
`(α₀, δ₀)`, let `D = sin δ₀ sin δ + cos δ₀ cos δ cos(α−α₀)`;
`ξ = cos δ sin(α−α₀)/D` and
`η = (cos δ₀ sin δ − sin δ₀ cos δ cos(α−α₀))/D`, within `D > 0`.
The coordinate convention follows [ERFA's `eraTpxes`](https://raw.githubusercontent.com/liberfa/erfa/master/src/tpxes.c).
Absolute event epochs reside in `rows.time`;
`rows.value` is O−C. A job's explicit observable/observer models must determine
the forward estimator before this data can be used for inference.

The current input subset supports independent Gaussian measurement sigmas.
Covariance, structured activity and alternative likelihoods fail explicitly;
they have not been implemented by flattening them into diagonal errors.
Numerical budgets are separate from measured uncertainty. Posterior,
calibration and model-discrepancy outputs await their qualified models/result
contract. Storing a scenario does not certify its trajectory or physical domain.

Each numerical-budget share must be strictly positive and at most one. Both
validators add binary64 shares in trajectory, propagation, spatial, spectral,
exposure order and admit a total up to `1 + 1e-12`; the allowance covers floating
point summation roundoff, not additional scientific error budget.

## Persistence and HTTP

All routes inherit the service's loopback host/origin restrictions. Original
files are uploaded as uncompressed `application/octet-stream` to
`POST /v3/sources`. Their exact bytes are retained, including formatting and
line endings; CSV/FITS/Arrow files can be archived, but are **not automatically
interpreted or converted** by this endpoint.

Upload normalized JSON to `POST /v3/provenance`, `/scenarios`, `/observations`,
`/calibrations` or `/workspaces`; read with `GET /v3/{kind}/{hash}` or list with
`GET /v3/{kind}`. Resource identity is SHA-256 of the existing canonical JSON
encoding; source identity hashes original bytes. A differently formatted
resource upload is idempotent. Preserve each desired source representation by
uploading it separately before its provenance/resource.

Every dependency must exist with the correct kind. Provenance must directly
name all declared original source hashes. Jobs must pin every calibration
referenced by their observations. Resources cannot be overwritten or deleted
through these APIs, and nothing refreshes from the network. Publication and
quota checks share a SQLite transaction, including across service connections.
Retrieval and dependency binding verify content hashes.

The store lives at `.science-cache/research/research-v7.local.sqlite` relative
to the service working directory. Default limits are 8 MiB per object,
128 MiB of logical stored payload and 4,096 objects. SQLite metadata/journal
space is additional. Copy a database only while the service is stopped or use
SQLite's backup facilities. Storage does not supply automatic backup. There is
no API deletion or expiry: quota recovery is an operator-managed reset of
`.science-cache/research` with the service stopped, after archiving any inputs
that must be retained.

`GET /v3/capabilities` advertises `input-foundation`, no supported jobs and no
qualified observables. `POST /v3/jobs` validates its contract/bindings and then
returns `503 capability-unavailable`, without creating work. Result requests
also report unavailability. This is an explicit release gate, not a successful
simulation stub. V5/V6 live routes and current browser/macOS clients remain
active until the complete replacement and client cutover are verified.

## Remaining contract work

The full V7 model selection, observer, surface/atmosphere, correlated covariance,
inference, result/uncertainty and portable research-bundle contracts are not
implemented here. Neither are CSV/FITS/Arrow interpretation, general dataset
migration or browser/macOS V7 UI. These must be delivered alongside their actual
models and clients; the ADR defines their scope and acceptance criteria.
