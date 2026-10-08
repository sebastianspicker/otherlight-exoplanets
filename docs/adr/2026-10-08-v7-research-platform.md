# V7 research platform and shared precision backend

Date: 2026-10-08. Status: accepted architectural direction; implementation and
scientific qualification are incomplete. This decision does not advertise an
available V7 runtime or supersede the semantics of saved legacy artifacts.

## Decision

V7 is the authoritative specification for new research work. It must support
photometry, transit/eclipse timing, radial velocity and astrometry on baselines
up to 30 Julian years. Education V4 remains a preview format with an explicit
conversion boundary; it neither limits V7 models nor becomes research output.

Browser and macOS research execution will use one local Python precision
backend. Native/browser previews remain local and responsive; mobile can import
research result bundles. Independent Swift implementations of every precision
model are no longer a requirement for research features.

The common calculation is physical state → coupled trajectory → photon
propagation → spectral/surface integration → exposure integration → instrument
estimator → observations and likelihood. Shared dense trajectories, event
solutions and surface maps must underpin all four observables. Numerical error,
parameter uncertainty, calibration uncertainty and model discrepancy are
separate quantities, not interchangeable error bars.

## Contracts and persistence

Introduce `science-v7`, `/v3` resource APIs for scenarios, observations,
calibrations, jobs, results and provenance, and `workspace-v2`. Update strict
validators, clients and contract checks together. Immutable content-addressed
observations/calibration packs retain original bytes, citations, licences,
versions, correction histories and transformation provenance. A running job
pins those inputs; it never refreshes them silently.

Migrations preserve source files and reject ambiguous units, timestamps,
passband conventions, spatial semantics or topology changes. Reading a legacy
artifact does not authorize silently executing or converting it. Keep legacy
execution routes during browser/macOS cutover. After cutover they return an
explicit unsupported-version response; legacy readers and migration tools stay.

V5's three-body, RV-only live contract and V6's pending timing shapes do not
constrain the V7 state layout or observables. Existing live routes retain their
current advertised behavior until the replacement actually works.

## Bounded physical scope

The chosen trajectory engine is DOP853 for up to eight bodies, evaluating each
pair once. Extend collision certification deliberately for the expanded state;
it certifies the accepted numerical trajectory, not the exact physical orbit.
Stop at first surface contact by default. Separately labelled merger exploration
must conserve mass, momentum and total angular momentum when restarting.

Versioned, explicitly parameterized models cover J2/J4 and spin torques,
weak-friction constant-time-lag equilibrium tides, full weak-field multi-body 1PN,
and optically thin radiation pressure/Poynting–Robertson drag. Energy,
angular-momentum transfer, dissipation and external forcing require appropriate
accounting. Photometric flattening does not determine gravitational moments.

Observer/time handling uses split Julian dates, explicit time scales and
arrival-time conventions, pinned Astropy/ERFA and frozen reference data.
Propagation, redshift and Doppler corrections remain distinguishable from the
dynamical forces. Surface integration unifies spectral flux, velocity moments
and photocentre, including activity and foreground masks. Adaptive spatial,
spectral and exposure integration replaces global pixel resolution as research
precision control. First-moment RV and instrument line-profile RV remain
separate estimators.

Thermal balance, spectral illumination, hydrostatic slant optical depth, LTE
column emission, finite-star single scattering and spherical refraction require
explicit validity domains. General hydrodynamic impacts, unrestricted multiple
scattering, full atmospheric circulation, stellar interiors and strong-field
gravity remain outside the contract. Missing parameters and unsupported
combinations fail explicitly.

## Qualification and delivery

Complete audit corrections first, then contracts/persistence, joint Newtonian
observables and observer handling, additional models, calibration/inference/UI,
and independent qualification with measured optimization. MAP, emcee and
dynesty must use the actual deterministic forward likelihood, explicit priors,
checkpoint/resume budgets and posterior prediction. Likelihood evaluations do
not generate fresh simulated noise.

The first complete research release includes all four observables. Numerical
ceilings are 0.1 ppm flux, 0.01 m/s RV, 1 ms timing and 1 microarcsecond
astrometry, with tighter budgets where needed to stay below one tenth of
observational uncertainty. Allocate those budgets across trajectory,
propagation, spatial, spectral and exposure calculations and fail unmet budgets.
No preview-grid result is promoted solely by changing its label.

Acceptance requires independent equation and numerical comparisons, invariant
and conservation checks, injection recovery, uncertainty coverage, correlated
noise recovery and frozen observed-data validation for HD 209458 b, HD 189733 b,
WASP-43 b and HR 466. Record baseline workloads before optimization; measure at
least 2× corrected, accuracy-matched heavy throughput, bounded memory, simple
workload regressions, browser traces and native checks on the required toolchain.
Independent Claude Code review is required before acceptance. The user owns
commits; regression tests remain unpublished.

## Superseded guidance

This decision replaces the architecture guide's former policy of keeping no
binding decision records, any implication that V6 must remain merely additive
to V5 indefinitely, and any requirement to implement each research model in
both Python and Swift. It does not resurrect deleted ADRs, retire a live route
before client cutover, change test-publication policy or establish scientific
qualification without evidence.
