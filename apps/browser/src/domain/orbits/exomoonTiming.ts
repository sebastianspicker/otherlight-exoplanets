/** Computes exomoon timing signals from the system geometry and orbital state. */
//
// Exomoon timing/shape diagnostics.
//
// Scientific intent (toy-model but physically motivated):
// - Transit duration scales approximately as 1 / v⊥, where v⊥ is the projected (sky-plane) speed.
// - Impact parameter diagnostics from sky-plane geometry.
//
// Design constraints:
// - No dependency on sim.ts (avoid circular deps).
// - Pure functions, deterministic.
// - Robust handling of non-finite inputs.
// - Results in simulator-native units (length units, seconds, radians).

/**
 * TDV-like diagnostic ratio under the v⊥ approximation:
 * TDV_ratio ≡ T(t)/T_ref ≈ v⊥(t_ref) / v⊥(t)
 */
export function tdvRatioFromSkyPlaneSpeeds(vRef: number, vNow: number, eps = 1e-15): number {
  if (!Number.isFinite(vRef) || vRef < 0) return NaN;
  if (!Number.isFinite(vNow) || vNow < eps) return NaN;

  const r = vRef / vNow;
  return Number.isFinite(r) ? r : NaN;
}
