// Models the primary star's brightness patches (spots and faculae) and their rotational evolution.
import Foundation

/// A projected brightness patch painted on the primary star's sky-plane disk.
///
/// Coordinates are star-centred sky-plane metres with +y "up"; the factor multiplies the local
/// limb-darkened intensity inside the patch, as the Browser `BrightnessPatch`.
public struct BrightnessPatch: Codable, Sendable, Hashable {
  /// Selects the projected outline of a patch.
  public enum Shape: Codable, Sendable, Hashable {
    case circle(radius: Double)
    case ellipse(rx: Double, ry: Double, angleRadians: Double)
  }
  /// The outline, the star-centred centre in metres, and the intensity factor (≥ 0).
  public var shape: Shape
  public var x: Double
  public var y: Double
  public var factor: Double
  /// Creates a patch from its outline, star-centred centre, and intensity factor.
  public init(shape: Shape, x: Double, y: Double, factor: Double) {
    self.shape = shape
    self.x = x
    self.y = y
    self.factor = factor
  }
}

/// Configures the Browser V4 starspot evolution of `photometry.spotEvolution` when enabled.
///
/// The native model stores this value only for an enabled block, so its presence means enabled.
public struct SpotEvolution: Codable, Sendable, Hashable {
  /// The rotation period (nil: no rotation), initial phase, longitude drift, lifetime (nil: no
  /// decay), coverage in [0, 1], and the reference epoch `tRef` in absolute scenario seconds.
  public var rotationPeriodSeconds: Double?
  public var rotationPhase0Radians: Double
  public var driftRateRadiansPerSecond: Double
  public var lifetimeSeconds: Double?
  public var coverage: Double
  public var referenceEpochSeconds: Double
  /// Creates a spot evolution with the Browser defaults for absent fields.
  public init(
    rotationPeriodSeconds: Double? = nil, rotationPhase0Radians: Double = 0,
    driftRateRadiansPerSecond: Double = 0, lifetimeSeconds: Double? = nil, coverage: Double = 1,
    referenceEpochSeconds: Double = 0
  ) {
    self.rotationPeriodSeconds = rotationPeriodSeconds
    self.rotationPhase0Radians = rotationPhase0Radians
    self.driftRateRadiansPerSecond = driftRateRadiansPerSecond
    self.lifetimeSeconds = lifetimeSeconds
    self.coverage = coverage
    self.referenceEpochSeconds = referenceEpochSeconds
  }
}

/// Pure brightness-patch geometry, spot evolution, and disk integrals mirroring the Browser
/// `patches.ts` and `spotEvolution.ts`.
public enum StellarSurface {
  /// Floors the authored-position `mu0` for features authored on the limb.
  private static let mu0Floor = 1e-3
  /// Treats a feature this close to a pole as fixed.
  private static let poleEpsilon = 1e-12

  /// Returns the patches at absolute scenario seconds under the spot-evolution model.
  ///
  /// Without evolution (nil, the native form of `enabled !== true`), without patches, or with an
  /// invalid radius or time the input is returned unchanged. Otherwise each feature rotates
  /// rigidly about the sky-plane +y axis from its authored position at `tRef`, is dropped on the
  /// far hemisphere, foreshortens to an ellipse with `rx = r min(1, mu / mu0)` along the radial
  /// direction and `ry = r`, and its contrast decays with the lifetime and scales with coverage.
  /// An authored ellipse is treated as a circle of radius `sqrt(rx ry)`; poles stay fixed.
  public static func evolvedPatches(
    _ patches: [BrightnessPatch], spotEvolution: SpotEvolution?, starRadius: Double,
    atAbsoluteSeconds seconds: Double
  ) -> [BrightnessPatch] {
    guard let spot = spotEvolution, !patches.isEmpty else { return patches }
    guard starRadius.isFinite, starRadius > 0, seconds.isFinite else { return patches }
    let dt = seconds - finiteOr(spot.referenceEpochSeconds, 0)
    let spin = spot.rotationPeriodSeconds.flatMap { $0.isFinite && $0 > 0 ? 2 * .pi / $0 : nil }
    let rotation =
      finiteOr(spot.rotationPhase0Radians, 0) + (spin ?? 0) * dt
      + finiteOr(spot.driftRateRadiansPerSecond, 0) * dt
    let envelope =
      spot.lifetimeSeconds.flatMap { $0.isFinite && $0 > 0 ? exp(-max(0, dt) / $0) : nil } ?? 1
    let coverage = min(1, max(0, finiteOr(spot.coverage, 1)))
    return patches.compactMap {
      evolved(
        $0, starRadius: starRadius, rotation: rotation,
        factor: max(0, 1 + coverage * ($0.factor - 1) * envelope))
    }
  }

  /// Returns the "multiply" brightness factor of the valid patches containing a point.
  public static func patchFactor(x: Double, y: Double, patches: [BrightnessPatch]) -> Double {
    patchFactor(x: x, y: y, prepared: prepared(patches))
  }

  /// Returns S = ∫ I(mu) P dA / ∫ I(mu) dA on the transit midpoint grid without occulters.
  ///
  /// The grid is the clamped `gridRes` with fallback 60. It is exactly 1 without valid patches,
  /// for a degenerate disk, or a vanishing reference.
  public static func spottedDiskFluxFactor(
    starRadius: Double, patches: [BrightnessPatch], u1: Double, u2: Double,
    gridResolution: Double?
  ) -> Double {
    let prepared = prepared(patches)
    guard !prepared.isEmpty, starRadius.isFinite, starRadius > 0 else { return 1 }
    var unpatched = 0.0
    var patched = 0.0
    DiskIntegration.forEachChordCell(
      starRadius: starRadius,
      resolution: DiskIntegration.resolution(gridResolution, fallback: 60)
    ) { x, y, mu, area in
      let intensity = QuadraticLimbDarkening.intensity(mu: mu, u1: u1, u2: u2)
      unpatched += intensity * area
      patched += intensity * patchFactor(x: x, y: y, prepared: prepared) * area
    }
    guard unpatched > 1e-12 else { return 1 }
    return patched.isFinite ? max(0, patched / unpatched) : 1
  }

  /// A patch reduced to the Browser `PatchPre` form for point-in-patch tests.
  struct PreparedPatch: Sendable {
    let x: Double
    let y: Double
    let factor: Double
    let isEllipse: Bool
    let r2: Double
    let inverseRx2: Double
    let inverseRy2: Double
    let cosAngle: Double
    let sinAngle: Double
  }

  /// Applies the Browser `sanitizeBrightnessPatches`: entries with non-finite centres or factors
  /// or non-positive radii are dropped, factors are clamped at 0, and a non-finite angle is 0.
  static func prepared(_ patches: [BrightnessPatch]) -> [PreparedPatch] {
    patches.compactMap { patch in
      guard patch.x.isFinite, patch.y.isFinite, patch.factor.isFinite else { return nil }
      let factor = max(0, patch.factor)
      switch patch.shape {
      case .circle(let radius):
        guard radius.isFinite, radius > 0 else { return nil }
        return PreparedPatch(
          x: patch.x, y: patch.y, factor: factor, isEllipse: false, r2: radius * radius,
          inverseRx2: 0, inverseRy2: 0, cosAngle: 1, sinAngle: 0)
      case .ellipse(let rx, let ry, let angle):
        guard rx.isFinite, rx > 0, ry.isFinite, ry > 0 else { return nil }
        let a = angle.isFinite ? angle : 0
        return PreparedPatch(
          x: patch.x, y: patch.y, factor: factor, isEllipse: true, r2: 0,
          inverseRx2: 1 / (rx * rx), inverseRy2: 1 / (ry * ry), cosAngle: cos(a), sinAngle: sin(a))
      }
    }
  }

  /// Multiplies the factors of every prepared patch strictly containing the point; 0 short-circuits.
  static func patchFactor(x: Double, y: Double, prepared: [PreparedPatch]) -> Double {
    guard x.isFinite, y.isFinite, !prepared.isEmpty else { return 1 }
    var factor = 1.0
    for patch in prepared {
      if contains(patch, x: x, y: y) { factor *= patch.factor }
      if factor == 0 { return 0 }
    }
    return factor.isFinite ? max(0, factor) : 1
  }

  /// Tests a point with strict `<` against a circle or a rotated ellipse.
  private static func contains(_ patch: PreparedPatch, x: Double, y: Double) -> Bool {
    let dx = x - patch.x
    let dy = y - patch.y
    guard patch.isEllipse else { return dx * dx + dy * dy < patch.r2 }
    let xp = patch.cosAngle * dx + patch.sinAngle * dy
    let yp = -patch.sinAngle * dx + patch.cosAngle * dy
    return xp * xp * patch.inverseRx2 + yp * yp * patch.inverseRy2 < 1
  }

  /// Rotates one feature by the longitude advance, or drops it when hidden or invalid.
  private static func evolved(
    _ patch: BrightnessPatch, starRadius: Double, rotation: Double, factor: Double
  ) -> BrightnessPatch? {
    let r: Double
    switch patch.shape {
    case .circle(let radius): r = radius
    case .ellipse(let rx, let ry, _): r = sqrt(rx * ry)
    }
    guard patch.x.isFinite, patch.y.isFinite, r.isFinite, r > 0 else { return nil }
    let phi = asin(min(1, max(-1, patch.y / starRadius)))
    let cosPhi = cos(phi)
    guard cosPhi > poleEpsilon else {
      return BrightnessPatch(shape: .circle(radius: r), x: patch.x, y: patch.y, factor: factor)
    }
    let lambda = asin(min(1, max(-1, patch.x / (starRadius * cosPhi)))) + rotation
    guard cos(lambda) > 0 else { return nil }
    let x = starRadius * cosPhi * sin(lambda)
    let mu0 = max(projectedMu(x: patch.x, y: patch.y, starRadius: starRadius), mu0Floor)
    let rx = r * min(1, projectedMu(x: x, y: patch.y, starRadius: starRadius) / mu0)
    return BrightnessPatch(
      shape: .ellipse(rx: rx, ry: r, angleRadians: atan2(patch.y, x)), x: x, y: patch.y,
      factor: factor)
  }

  /// Returns `mu = sqrt(max(0, 1 - (x² + y²) / R²))` of a projected point.
  private static func projectedMu(x: Double, y: Double, starRadius: Double) -> Double {
    sqrt(max(0, 1 - (x * x + y * y) / (starRadius * starRadius)))
  }

  /// Returns a finite value unchanged and a non-finite one as the fallback.
  private static func finiteOr(_ value: Double, _ fallback: Double) -> Double {
    value.isFinite ? value : fallback
  }
}
