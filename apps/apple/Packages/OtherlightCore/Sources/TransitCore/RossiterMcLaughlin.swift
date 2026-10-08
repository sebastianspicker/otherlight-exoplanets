// Computes the step observables and the Rossiter–McLaughlin anomaly of the rotating primary star.
import Foundation

/// Radial-velocity, astrometric, and Rossiter–McLaughlin observables mirroring the Browser V4
/// `observablesForSnapshot`, `rossiterMcLaughlin.ts`, and `nativeStellarSpin.ts`.
extension SimulationEngine {
  /// Returns the general-lab observables of a step from its barycentric states and patches.
  func observables(_ state: SystemKinematics, patches: [BrightnessPatch]) -> StepObservables {
    StepObservables(
      rvStar: Self.radialVelocity(state.starVelocity),
      rvPlanet: Self.radialVelocity(state.planetVelocity),
      rvMoon: state.moonVelocity.map(Self.radialVelocity),
      astrometricOffsetStar: SkyOffset(x: state.star.x, y: state.star.y),
      rvStarRossiterMcLaughlin: rossiterMcLaughlin(state, patches: patches))
  }

  /// Returns `rv = −(v · ô)` with `ô = (0, 0, 1)`, or 0 for a non-finite velocity.
  static func radialVelocity(_ velocity: Vector3) -> Double {
    guard velocity.x.isFinite, velocity.y.isFinite, velocity.z.isFinite else { return 0 }
    return -velocity.z
  }

  /// Returns the primary star's rotation period: the first finite positive of `star.spin`, the
  /// stellar-surface block, and the spot evolution (each present only when enabled), or nil.
  static func stellarRotationPeriodSeconds(_ scenario: EducationScenarioV4) -> Double? {
    let candidates = [
      scenario.star.spin?.rotationPeriodSeconds, scenario.stellarSurface?.rotationPeriodSeconds,
      scenario.spotEvolution?.rotationPeriodSeconds,
    ]
    return candidates.lazy.compactMap { $0 }.first { $0.isFinite && $0 > 0 }
  }

  /// Returns `sin i_*` and the sky position angle of the stellar spin axis.
  ///
  /// The axis is the planet's orbit normal relative to the star, `n̂ = normalize(r_rel × v_rel)`
  /// of the barycentric states; `sin i_* = hypot(n.x, n.y)` and the angle is
  /// `atan2(n.x, n.y)` (from +y toward +x) unless `spin` authors a finite one. Obliquity is unused.
  static func stellarSpinGeometry(
    relativePosition r: Vector3, relativeVelocity v: Vector3, spin: StellarSpin?
  ) -> (sinI: Double, axisPositionAngle: Double)? {
    let cross = Vector3(
      x: r.y * v.z - r.z * v.y, y: r.z * v.x - r.x * v.z, z: r.x * v.y - r.y * v.x)
    let length = cross.length
    let normal = length.isFinite && length > 0 ? cross * (1 / length) : .zero
    let sinI = hypot(normal.x, normal.y)
    guard sinI.isFinite else { return nil }
    if let angle = spin?.axisPositionAngleRadians, angle.isFinite { return (sinI, angle) }
    return (sinI, atan2(normal.x, normal.y))
  }

  /// Returns the Rossiter–McLaughlin anomaly in m/s of a step, or nil without a rotation period.
  ///
  /// `v_eq = 2π R* / P_rot`; the occulters are the opaque circular planet and moon silhouettes
  /// (`radiusMetres`) in front of the star, without oblate shapes, as in the Browser.
  func rossiterMcLaughlin(_ state: SystemKinematics, patches: [BrightnessPatch]) -> Double? {
    let star = scenario.star
    guard star.radiusMetres > 0, let period = Self.stellarRotationPeriodSeconds(scenario),
      let geometry = Self.stellarSpinGeometry(
        relativePosition: state.planet - state.star,
        relativeVelocity: state.planetVelocity - state.starVelocity, spin: star.spin)
    else { return nil }
    let equatorialSpeed = 2 * .pi * star.radiusMetres / period
    var bodies = [(position: state.planet, radius: scenario.planet.radiusMetres)]
    if let moon = state.moon, let radius = scenario.moon?.radiusMetres {
      bodies.append((moon, radius))
    }
    let occulters = bodies.filter { $0.position.z > state.star.z }.map {
      (
        center: SkyOffset(x: $0.position.x - state.star.x, y: $0.position.y - state.star.y),
        radius: $0.radius
      )
    }
    return Self.rossiterMcLaughlinVelocity(
      RossiterMcLaughlinInput(
        starRadius: star.radiusMetres, occulters: occulters, u1: star.limbDarkeningU1,
        u2: star.limbDarkeningU2, patches: patches, gridResolution: scenario.gridResolution,
        vEqSinI: equatorialSpeed * geometry.sinI, axisPositionAngle: geometry.axisPositionAngle))
  }

  /// Returns transit-minus-unocculted RV in m/s for the same rotating stellar brightness map.
  ///
  /// With star-centred sky coordinates, `v_los(x, y) = v_eq sin i_* (x cos λ − y sin λ) / R*` and
  /// `ΔRV = (M_disk − M_blocked)/(F_disk − F_blocked) − M_disk/F_disk`, where M integrates
  /// `I v_los` and F integrates I. I is the quadratic
  /// limb-darkened intensity times the "multiply" patch factor and blocked is the union of the
  /// opaque circles on the transit midpoint grid (clamped `gridRes`, fallback 60). As the Browser,
  /// the moment integrates the shifted weight `I max(0, v_los + V0)` with `V0 = |v_eq sin i_*|`
  /// and subtracts `V0 ∫ I`. The result is 0 without an overlapping occulter, for invalid
  /// inputs, or when the visible flux is at most 1e-12 of the total, and never NaN.
  public static func rossiterMcLaughlinVelocity(_ input: RossiterMcLaughlinInput) -> Double {
    let starRadius = input.starRadius
    let vEqSinI = input.vEqSinI
    guard starRadius.isFinite, starRadius > 0 else { return 0 }
    guard vEqSinI.isFinite, input.axisPositionAngle.isFinite, vEqSinI != 0 else { return 0 }
    let circles = input.overlappingCircles
    guard !circles.isEmpty else { return 0 }
    let prepared = StellarSurface.prepared(input.patches)
    let cosL = cos(input.axisPositionAngle)
    let sinL = sin(input.axisPositionAngle)
    let v0 = abs(vEqSinI)
    var total = 0.0
    var blocked = 0.0
    var shiftedBlocked = 0.0
    var shiftedTotal = 0.0
    DiskIntegration.forEachChordCell(
      starRadius: starRadius,
      resolution: DiskIntegration.resolution(input.gridResolution, fallback: 60)
    ) { x, y, mu, area in
      var intensity = QuadraticLimbDarkening.intensity(mu: mu, u1: input.u1, u2: input.u2)
      if !prepared.isEmpty {
        intensity *= StellarSurface.patchFactor(x: x, y: y, prepared: prepared)
      }
      total += intensity * area
      let lineOfSight = vEqSinI * (x * cosL - y * sinL) / starRadius
      let shifted = intensity * max(0, lineOfSight + v0) * area
      shiftedTotal += shifted
      let inside = circles.contains {
        let ox = x - $0.center.x
        let oy = y - $0.center.y
        return ox * ox + oy * oy < $0.radius * $0.radius
      }
      guard inside else { return }
      blocked += intensity * area
      shiftedBlocked += shifted
    }
    let clampedBlocked = min(blocked, total)
    let visible = total - clampedBlocked
    guard visible > 1e-12 * total else { return 0 }
    let baselineVelocity = shiftedTotal / total - v0
    let blockedMoment = shiftedBlocked - v0 * clampedBlocked
    let anomaly = (baselineVelocity * clampedBlocked - blockedMoment) / visible
    return anomaly.isFinite ? anomaly : 0
  }
}

/// Groups the inputs of the Rossiter–McLaughlin disk integral.
public struct RossiterMcLaughlinInput: Sendable {
  /// The stellar radius in metres and the star-centred sky-plane occulter circles.
  public var starRadius: Double
  public var occulters: [(center: SkyOffset, radius: Double)]
  /// The quadratic limb-darkening coefficients, the brightness patches, and the authored
  /// `gridRes` (nil: absent).
  public var u1: Double
  public var u2: Double
  public var patches: [BrightnessPatch]
  public var gridResolution: Double?
  /// The projected equatorial speed `v_eq sin i_*` in m/s and the sky position angle of the spin
  /// axis in radians, from +y toward +x.
  public var vEqSinI: Double
  public var axisPositionAngle: Double
  /// Creates the integral inputs.
  public init(
    starRadius: Double, occulters: [(center: SkyOffset, radius: Double)], u1: Double, u2: Double,
    patches: [BrightnessPatch], gridResolution: Double?, vEqSinI: Double, axisPositionAngle: Double
  ) {
    self.starRadius = starRadius
    self.occulters = occulters
    self.u1 = u1
    self.u2 = u2
    self.patches = patches
    self.gridResolution = gridResolution
    self.vEqSinI = vEqSinI
    self.axisPositionAngle = axisPositionAngle
  }

  /// The valid occulters that overlap the stellar disk, as the Browser `sanitizeCircleOcculters`.
  var overlappingCircles: [(center: SkyOffset, radius: Double)] {
    occulters.filter {
      $0.center.x.isFinite && $0.center.y.isFinite && $0.radius.isFinite && $0.radius > 0
        && hypot($0.center.x, $0.center.y) < starRadius + $0.radius
    }
  }
}
