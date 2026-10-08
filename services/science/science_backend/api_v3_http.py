"""Expose persistent V7 research inputs; execution remains explicitly unavailable."""

from __future__ import annotations

from typing import Any

from .api_v2_dataset_validation import MAX_DATASET_BYTES, parse_dataset_bytes
from .api_v2_http import declared_content_length, read_bounded_body
from .errors import CapabilityUnavailableError, ContractError
from .research_contracts import RESOURCE_SCHEMAS
from .research_store import ResearchStore


def capabilities(store: ResearchStore) -> dict[str, Any]:
    """Advertise implemented storage separately from unqualified forward models."""
    return {
        "schemaVersion": "science-v7",
        "releaseStatus": "input-foundation",
        "supportedJobKinds": [],
        "qualifiedObservables": [],
        "resources": list(RESOURCE_SCHEMAS),
        "sourceFiles": "opaque-original-bytes",
        "observationImports": {
            "format": "normalized-json",
            "uncertaintyModels": ["independent-gaussian"],
            "automaticCsvFitsArrowConversion": False,
        },
        "calibrationModels": ["tabulated-passband-v1"],
        "persistence": "immutable-local-sqlite",
        "limits": {
            "maxObjectBytes": MAX_DATASET_BYTES,
            "maxStoredBytes": store.max_bytes,
            "maxObjects": store.max_objects,
            "maxBodies": 8,
            "maxBaselineJulianYears": 30,
        },
        "legacyExecution": "retained-until-client-cutover",
    }


async def _body(request: Any, expected_media: bytes) -> bytes:
    headers = request.scope.get("headers", ())
    types = [value for key, value in headers if key.lower() == b"content-type"]
    if len(types) != 1 or types[0].split(b";", 1)[0].strip().lower() != expected_media:
        raise ContractError("unsupported research input Content-Type")
    _validate_transport_encoding(headers)
    return await read_bounded_body(
        request, declared_content_length(headers, "research"), "research"
    )


def _validate_transport_encoding(headers: Any) -> None:
    encodings = [value for key, value in headers if key.lower() == b"content-encoding"]
    if encodings and encodings != [b"identity"]:
        raise ContractError("compressed research uploads are not supported")
    names = {key.lower() for key, _ in headers}
    if b"transfer-encoding" in names and b"content-length" in names:
        raise ContractError("cannot combine Content-Length and Transfer-Encoding")


def register_v3_routes(app: Any, store: ResearchStore, request_type: Any) -> None:
    from fastapi.responses import JSONResponse, Response
    from starlette.concurrency import run_in_threadpool

    @app.get("/v3/capabilities")
    def v3_capabilities():
        return capabilities(store)

    async def put_source(request: Any):
        descriptor, created = await run_in_threadpool(
            store.put_source, await _body(request, b"application/octet-stream")
        )
        return JSONResponse(descriptor, status_code=201 if created else 200)

    put_source.__annotations__["request"] = request_type
    app.post("/v3/sources")(put_source)

    @app.get("/v3/sources/{digest}")
    def get_source(digest: str):
        try:
            return Response(
                store.get_bytes("sources", digest),
                media_type="application/octet-stream",
            )
        except KeyError:
            return JSONResponse(
                {"code": "unknown-source", "message": "unknown source"}, status_code=404
            )

    for kind in RESOURCE_SCHEMAS:
        _register_resource(app, store, request_type, kind)

    async def submit_job(request: Any):
        payload = parse_dataset_bytes(await _body(request, b"application/json"))
        await run_in_threadpool(store.validate_job_inputs, payload)
        raise CapabilityUnavailableError(
            "V7 joint forward models have not been qualified; no job was created"
        )

    submit_job.__annotations__["request"] = request_type
    app.post("/v3/jobs")(submit_job)

    @app.get("/v3/results/{digest}")
    def get_result(digest: str):
        raise CapabilityUnavailableError(
            "V7 result publication is unavailable until joint model qualification"
        )


def _register_resource(
    app: Any, store: ResearchStore, request_type: Any, kind: str
) -> None:
    from fastapi.responses import JSONResponse, Response
    from starlette.concurrency import run_in_threadpool

    async def put_resource(request: Any):
        descriptor, created = await run_in_threadpool(
            store.put, kind, await _body(request, b"application/json")
        )
        return JSONResponse(descriptor, status_code=201 if created else 200)

    def get_resource(digest: str):
        try:
            return Response(
                store.get_bytes(kind, digest), media_type="application/json"
            )
        except KeyError:
            return JSONResponse(
                {"code": "unknown-resource", "message": "unknown resource"},
                status_code=404,
            )

    def list_resources():
        return {"resources": store.list(kind)}

    put_resource.__annotations__["request"] = request_type
    app.post(f"/v3/{kind}", name=f"put_{kind}")(put_resource)
    app.get(f"/v3/{kind}/{{digest}}", name=f"get_{kind}")(get_resource)
    app.get(f"/v3/{kind}", name=f"list_{kind}")(list_resources)
