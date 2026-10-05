/**
 * Reads, loads, and switches the quadratic limb-darkening controls.
 *
 * The u1/u2 fields always edit the law the runtime uses: the `bands` entry of the
 * selected bandpass when one exists, otherwise `default`. The default law is kept
 * on the u1/u2 inputs while a band entry is being edited.
 */
import type {
  LimbDarkeningLaw,
  LimbDarkeningLawQuadratic,
  LimbDarkeningModel,
} from "../../../domain/model/types";
import { readNumberInput, sanitizeFinite, writeNumberInput } from "../inputs";
import type { UiRefs } from "../../shell/refs";
import { formatQuadraticBands, getQuadraticLDFromModel, parseQuadraticBands } from "./common";

type LimbDarkeningRefs = Pick<UiRefs, "ldU1" | "ldU2" | "ldBandpass" | "ldBands">;
type QuadraticBands = Record<string, LimbDarkeningLawQuadratic>;

const FALLBACK_U1 = 0.35;
const FALLBACK_U2 = 0.25;

function quadraticLaw(u1: number, u2: number): LimbDarkeningLawQuadratic {
  return { kind: "quadratic", u1, u2 };
}

function readBands(r: LimbDarkeningRefs): QuadraticBands | undefined {
  const text = r.ldBands.value ?? "";
  return text.trim().length > 0 ? parseQuadraticBands(text) : undefined;
}

function activeBand(bands: QuadraticBands | undefined, bandpass: string): string | undefined {
  if (!bandpass || !bands || !Object.hasOwn(bands, bandpass)) return undefined;
  return bandpass;
}

function readFieldLaw(r: LimbDarkeningRefs, fallback: { u1: number; u2: number }): LimbDarkeningLawQuadratic {
  const u1 = sanitizeFinite(readNumberInput(r.ldU1, fallback.u1), fallback.u1);
  const u2 = sanitizeFinite(readNumberInput(r.ldU2, fallback.u2), fallback.u2);
  return quadraticLaw(u1, u2);
}

function writeFieldLaw(r: LimbDarkeningRefs, law: { u1: number; u2: number }): void {
  writeNumberInput(r.ldU1, law.u1);
  writeNumberInput(r.ldU2, law.u2);
}

function writeStashedDefault(r: LimbDarkeningRefs, law: LimbDarkeningLaw | undefined): void {
  if (law?.kind === "quadratic" && Number.isFinite(law.u1) && Number.isFinite(law.u2)) {
    r.ldU1.dataset.defaultLaw = String(law.u1);
    r.ldU2.dataset.defaultLaw = String(law.u2);
    return;
  }
  delete r.ldU1.dataset.defaultLaw;
  delete r.ldU2.dataset.defaultLaw;
}

function readStashedDefault(r: LimbDarkeningRefs): LimbDarkeningLawQuadratic | undefined {
  const rawU1 = r.ldU1.dataset.defaultLaw;
  const rawU2 = r.ldU2.dataset.defaultLaw;
  if (rawU1 === undefined || rawU2 === undefined) return undefined;
  const u1 = Number(rawU1);
  const u2 = Number(rawU2);
  return Number.isFinite(u1) && Number.isFinite(u2) ? quadraticLaw(u1, u2) : undefined;
}

export function readLimbDarkeningModelFromUI(
  prevModel: LimbDarkeningModel,
  r: LimbDarkeningRefs,
): LimbDarkeningModel {
  const prevQ = getQuadraticLDFromModel(prevModel);
  const fields = readFieldLaw(r, { u1: prevQ?.u1 ?? FALLBACK_U1, u2: prevQ?.u2 ?? FALLBACK_U2 });
  const bandpass = r.ldBandpass.value.trim();
  const bands = readBands(r);
  const band = activeBand(bands, bandpass);
  if (band === undefined || bands === undefined) {
    return { ...prevModel, bandpass: bandpass.length > 0 ? bandpass : undefined, default: fields, bands };
  }
  const defaultLaw = readStashedDefault(r) ?? prevModel.default;
  return {
    ...prevModel,
    bandpass: band,
    ...(defaultLaw === undefined ? {} : { default: defaultLaw }),
    bands: { ...bands, [band]: fields },
  };
}

export function loadLimbDarkeningModelIntoUI(
  model: LimbDarkeningModel | undefined,
  r: LimbDarkeningRefs,
): void {
  const qld = getQuadraticLDFromModel(model);
  writeFieldLaw(r, { u1: qld?.u1 ?? FALLBACK_U1, u2: qld?.u2 ?? FALLBACK_U2 });
  r.ldBandpass.value = String(model?.bandpass ?? "");
  r.ldBandpass.dataset.committedBandpass = r.ldBandpass.value.trim();
  r.ldBands.value = formatQuadraticBands(model?.bands);
  writeStashedDefault(r, model?.default);
}

/**
 * Moves the u1/u2 fields to the law of a newly selected bandpass. Edits made for
 * the previous target are kept in its bands entry or in the stashed default.
 */
export function switchLimbDarkeningBandpass(r: LimbDarkeningRefs): void {
  const previous = r.ldBandpass.dataset.committedBandpass ?? "";
  const next = r.ldBandpass.value.trim();
  r.ldBandpass.dataset.committedBandpass = next;
  if (previous === next) return;

  const stashed = readStashedDefault(r);
  const fields = readFieldLaw(r, stashed ?? quadraticLaw(FALLBACK_U1, FALLBACK_U2));
  const bands = readBands(r) ?? {};
  const previousBand = activeBand(bands, previous);
  if (previousBand === undefined) {
    writeStashedDefault(r, fields);
  } else {
    bands[previousBand] = fields;
    r.ldBands.value = formatQuadraticBands(bands);
  }
  const nextBand = activeBand(bands, next);
  const target = nextBand === undefined ? readStashedDefault(r) : bands[nextBand];
  if (target) writeFieldLaw(r, target);
}

/** Shows the edited bands entry in u1/u2 when it belongs to the selected bandpass. */
export function syncLimbDarkeningFieldsFromBands(r: LimbDarkeningRefs): void {
  const bands = readBands(r);
  const band = activeBand(bands, r.ldBandpass.value.trim());
  if (band !== undefined && bands) writeFieldLaw(r, bands[band]);
}
