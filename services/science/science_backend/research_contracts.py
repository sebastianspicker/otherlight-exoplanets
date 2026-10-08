"""Define V7 state, resource and workspace envelopes without claiming execution."""

from .research_schema import (
    BASE,
    CALIBRATION,
    COMMON,
    DRAFT,
    OBSERVATIONS,
    PROVENANCE,
    array,
    choice,
    document,
    number,
    record,
    ref,
    text,
)

SCENARIO = document(
    "scenario",
    {
        "kind": {"const": "scenario"},
        "provenanceHash": ref("hash"),
        "epoch": ref("time"),
        "timeScale": {"const": "TDB"},
        "frame": {"const": "icrs-barycentric"},
        "durationSeconds": number(0, 30 * 365.25 * 86_400),
        "stateLayout": {"const": "body-major-cartesian-si-v1"},
        "gravity": {"const": "newtonian-point-mass-v1"},
        "collisionPolicy": {"const": "stop-at-first-contact"},
        "bodies": array(
            record(
                {
                    "id": ref("id"),
                    "massKg": {
                        "type": "number",
                        "exclusiveMinimum": 0,
                        "maximum": 1e34,
                    },
                    "radiusM": number(0, 1e13),
                    "positionM": ref("vector3"),
                    "velocityMps": ref("vector3"),
                }
            ),
            2,
            8,
        ),
    },
)

DESCRIPTOR = {
    "$schema": DRAFT,
    "$id": f"{BASE}science-v7/resource-descriptor.schema.json",
    **record(
        {
            "schemaVersion": {"const": "science-resource-v7"},
            "resourceSchemaVersion": choice(
                "science-v7", "workspace-v2", "opaque-bytes"
            ),
            "kind": choice(
                "sources",
                "provenance",
                "observations",
                "calibrations",
                "scenarios",
                "workspaces",
            ),
            "hash": ref("hash"),
            "byteLength": {"type": "integer", "minimum": 1, "maximum": 8 * 1024 * 1024},
        }
    ),
}

JOB = document(
    "job-request",
    {
        "kind": {"const": "forward"},
        "scenarioHash": ref("hash"),
        "observationHashes": array(ref("hash"), 1, 64),
        "calibrationHashes": array(ref("hash"), 0, 64),
        "provenanceHash": ref("hash"),
        "tolerances": record(
            {
                "relativeFlux": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 1e-7,
                },
                "radialVelocityMps": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 0.01,
                },
                "eventTimeSeconds": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 0.001,
                },
                "astrometryRad": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 4.84813681109536e-12,
                },
                "maxUncertaintyFraction": {
                    "type": "number",
                    "exclusiveMinimum": 0,
                    "maximum": 0.1,
                },
                "allocation": ref("numericalBudget"),
            }
        ),
        "budget": record(
            {
                "maxWallSeconds": number(1, 3600),
                "maxEvaluations": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10_000_000,
                },
            }
        ),
    },
)

WORKSPACE = {
    "$schema": DRAFT,
    "$id": f"{BASE}workspace-v2/workspace.schema.json",
    **record(
        {
            "schemaVersion": {"const": "workspace-v2"},
            "title": text(),
            "sourceHashes": array(ref("hash"), 1, 64),
            "provenanceHash": ref("hash"),
            "educationArchiveHash": ref("hash"),
            "scenarioHashes": array(ref("hash"), 0, 64),
            "observationHashes": array(ref("hash"), 0, 64),
            "calibrationHashes": array(ref("hash"), 0, 64),
            "resultHashes": array(ref("hash"), 0, 64),
        },
        ("educationArchiveHash",),
    ),
}
# Workspace references the V7 vocabulary rather than giving Education research semantics.
for _key, _value in WORKSPACE["properties"].items():
    if "$ref" in _value:
        _value["$ref"] = "../science-v7/" + _value["$ref"]
    if "items" in _value and "$ref" in _value["items"]:
        _value["items"]["$ref"] = "../science-v7/" + _value["items"]["$ref"]

SCHEMAS = {
    "science-v7/common.schema.json": COMMON,
    "science-v7/provenance.schema.json": PROVENANCE,
    "science-v7/observations.schema.json": OBSERVATIONS,
    "science-v7/calibration.schema.json": CALIBRATION,
    "science-v7/scenario.schema.json": SCENARIO,
    "science-v7/job-request.schema.json": JOB,
    "science-v7/resource-descriptor.schema.json": DESCRIPTOR,
    "workspace-v2/workspace.schema.json": WORKSPACE,
}

RESOURCE_SCHEMAS = {
    "provenance": "science-v7/provenance.schema.json",
    "observations": "science-v7/observations.schema.json",
    "calibrations": "science-v7/calibration.schema.json",
    "scenarios": "science-v7/scenario.schema.json",
    "workspaces": "workspace-v2/workspace.schema.json",
}
