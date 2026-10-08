# Workspace V2 input bundles

Workspace V2 pins immutable original files, provenance, scenarios, observations,
calibrations and results. It is part of the
[V7 input foundation](../science-v7/README.md), not yet the live browser/macOS
workspace format. Existing V1 readers remain active.

The explicit offline migration command preserves original bytes and never
overwrites either the source file or an existing destination directory:

```sh
python scripts/migrate-research-inputs.py old.otherlight new-bundle \
  --citation 'Original project, author and date' --licence 'Your applicable licence' \
  --title 'My workspace' --version '1'
```

A valid Education workspace is archived verbatim as `original.bin`, with
`provenance.json` and `workspace.json`. `educationArchiveHash` refers to that
original V1 document, retaining its complete scenario, product context and
learning state. No research scenario is inferred. Upload original bytes first,
then provenance and workspace to the corresponding `/v3` resource routes.
An archive reader can recover the complete V1 document by that hash.

Scientific V1 workspaces are rejected because their conversion needs explicit
epoch, frame, model and calibration decisions. This tool does not reparent
bodies, reinterpret times or relabel old results as V7 research.

The same command migrates V6 `passband-response` JSON when
`--passband-weighting photon` or `--passband-weighting energy` is explicitly
provided. It emits `calibration.json`, retaining source bytes and metre units.
The supplied version, citation and licence remain in the calibration/provenance.
Other V6 datasets are rejected until spatial, normalization and interpolation
semantics can be specified and validated without ambiguity.
