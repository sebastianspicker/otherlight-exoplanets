/** Shares legacy/RT precedence between saved-scenario validation and photometry. */
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function usesLegacyAtmosphereTransmission(photometry: unknown): boolean {
  const phot = record(photometry);
  const legacy = record(phot.atmosphereTransmission);
  if (legacy.enabled !== true) return false;
  const rt = record(phot.atmosphereRT);
  const rtApplies = rt.enabled === true && (rt.target ?? "planet") === (legacy.target ?? "planet");
  return !(rtApplies && Array.isArray(rt.layers) && rt.layers.some(isUsableAtmosphereLayer));
}

export function isUsableAtmosphereLayer(value: unknown): boolean {
  const { r0, H, tau0 } = record(value);
  return (
    typeof r0 === "number" &&
    typeof H === "number" &&
    typeof tau0 === "number" &&
    r0 > 0 &&
    H > 0 &&
    tau0 >= 0 &&
    Number.isFinite(r0 + H + tau0)
  );
}
