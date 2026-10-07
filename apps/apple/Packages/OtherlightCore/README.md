# OtherlightCore

A portable macOS 14+ / iOS 17+ Swift package requiring Swift tools 6.3 and the
repository's exact Swift 6.3.3 toolchain. `TransitCore`, `TransitEducation`, and
`TransitVisualization` support the native Education app. Its Kepler orbits
carry the Browser V4 longitude of the ascending node, and the moon orbit takes
the V4 exomoon orientation drift (`dynamics.exomoonTimingShape`).

The native engine ports these parts of the Browser V4 runtime: node angles, moon
orientation drift, oblate planet and moon silhouettes, brightness patches with
spot evolution, stellar variability (including physical beaming and ellipsoidal
amplitudes) with stellar-surface activity, and per-step observables: star,
planet and moon radial velocities, the star's astrometric offset, and the
Rossiter–McLaughlin anomaly of the rotating primary star (`star.spin`). The
browser V4 importer still rejects rings, atmospheres, scattering, N-body
dynamics, relativity, instrument noise, and stellar surfaces or variability in
the detached-binary lab.

`TransitScienceContracts` exposes the strict Scientific V5 request types,
validation, an exact-key request decoder, and canonical request fingerprinting.
It has no Arrow dependency, so it is safe to share with iOS callers. The sibling
macOS-only `../OtherlightScience` package exports `TransitScience`, which owns
the experimental DOP853 runtime, the result and provenance contracts, and the
pinned Arrow IPC writer. Neither package is an automatic fallback for the Browser
or the backend.

The package tests decode the shared sample scenarios in
`contracts/education-v4/fixtures/scenarios.json` through the fail-closed browser
V4 importer and check the native engine against its own physics expectations.
Contract tests also validate strict Scientific V5 request decoding and stable
canonical fingerprints. There is no cross-language output oracle: the Browser
model is free to improve without a native fixture update.
