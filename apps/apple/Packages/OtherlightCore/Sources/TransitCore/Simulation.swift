// Implements the simplified orbital, photometric, and transit-timing simulation kernel.
import Foundation

/// Computes the overlap of two circular sky-plane silhouettes in square input units.
public enum CircularOccultation {
  /// Returns zero for invalid or disjoint geometry and uses the exact two-circle intersection otherwise.
  public static func overlapArea(radius first: Double, _ second: Double, separation: Double)
    -> Double
  {
    guard first.isFinite, first > 0, second.isFinite, second > 0, separation.isFinite,
      separation >= 0
    else { return 0 }
    if separation >= first + second { return 0 }
    if separation <= abs(first - second) { return .pi * min(first, second) * min(first, second) }
    let x = (separation * separation + first * first - second * second) / (2 * separation)
    let y = sqrt(max(0, first * first - x * x))
    let a1 = acos(max(-1, min(1, x / first)))
    let a2 = acos(max(-1, min(1, (separation - x) / second)))
    return first * first * a1 + second * second * a2 - separation * y
  }
}

/// Evaluates the normalized quadratic stellar limb-darkening approximation.
public enum QuadraticLimbDarkening {
  /// Clamps `mu` and the resulting intensity to the visible stellar disk's physical range.
  public static func intensity(mu: Double, u1: Double, u2: Double) -> Double {
    let x = 1 - max(0, min(1, mu))
    return max(0, 1 - u1 * x - u2 * x * x)
  }
}

/// Produces educational transit snapshots from Keplerian sky-plane geometry in SI units.
///
/// The engine uses fixed Kepler orbits, a sampled limb-darkened stellar disk, circular or oblate
/// opaque occulters, and additive phase terms. It intentionally omits N-body evolution and detailed
/// radiative transfer so results stay deterministic and responsive for the teaching workspace.
public struct SimulationEngine: Sendable {
  public let scenario: EducationScenarioV4

  /// Validates the scenario before accepting it; invalid physical inputs throw `ValidationError`.
  public init(scenario: EducationScenarioV4) throws {
    let issues = Self.validate(scenario)
    guard issues.isEmpty else { throw ValidationError(issues) }
    self.scenario = scenario
  }

  /// Evaluates positions, flux components, and timing diagnostics at an absolute SI time in seconds.
  public mutating func step(at timeSeconds: Double) throws -> EducationStep {
    guard timeSeconds.isFinite else { throw ValidationError([.nonFinite(field: "timeSeconds")]) }
    let elapsed = timeSeconds - scenario.epochSeconds
    if let binary = scenario.detachedBinary {
      return binaryStep(binary, elapsed: elapsed, at: timeSeconds)
    }
    let state = Self.kinematics(of: scenario, elapsed: elapsed)
    let planet = state.planet
    let relativePlanet = planet - state.star
    var points = [SkyPoint(body: "planet", position: planet)]
    var occluders = [
      Occulter.body(
        at: relativePlanet, radius: scenario.planet.radiusMetres, shape: scenario.planet.shape,
        nonSphericalFlux: scenario.nonSphericalFlux)
    ]
    let relativeMoon = state.moon.map { $0 - state.star }
    if let moonPosition = state.moon, let relativeMoon, let moon = scenario.moon {
      points.append(SkyPoint(body: "moon", position: moonPosition))
      occluders.append(
        .body(
          at: relativeMoon, radius: moon.radiusMetres, shape: moon.shape,
          nonSphericalFlux: scenario.nonSphericalFlux))
    }

    // Patches evolve with absolute observer time, as the Browser's `tObsSec`.
    let patches = StellarSurface.evolvedPatches(
      scenario.brightnessPatches, spotEvolution: scenario.spotEvolution,
      starRadius: scenario.star.radiusMetres, atAbsoluteSeconds: timeSeconds)
    let unionFlux = transitVisibility(occluders, patches: StellarSurface.prepared(patches))
    let stellar = stellarComponents(
      unionFlux: unionFlux, patches: patches,
      variability: stellarSurfaceVariability(state, atAbsoluteSeconds: timeSeconds))
    let transitFactor = stellar.transitFactor
    let visibility = visibilityFractions(state)
    let planetPhase =
      visibility.planet
      * phaseFlux(
        scenario.planetPhase, at: relativePlanet,
        velocity: state.planetVelocity - state.starVelocity,
        bodyRadius: scenario.planet.radiusMetres)
    var moonPhase = 0.0
    if let relativeMoon, let moon = scenario.moon {
      moonPhase =
        visibility.moon
        * phaseFlux(
          scenario.moonPhase, at: relativeMoon,
          velocity: state.moonVelocity.map { $0 - state.starVelocity },
          bodyRadius: moon.radiusMetres)
    }
    let total = stellar.preTransit * transitFactor + planetPhase + moonPhase
    let diagnostics = timingDiagnostics(
      at: timeSeconds, planet: relativePlanet,
      planetVelocity: state.planetVelocity - state.starVelocity,
      moon: relativeMoon, moonVelocity: state.moonVelocity.map { $0 - state.starVelocity })
    let timingAvailable =
      diagnostics.planetTransitCenterSec != nil || diagnostics.moonTransitCenterSec != nil
    let events = [
      RenderEvent(
        id: "transit", kind: "transit", label: "Transit attenuation active",
        active: transitFactor < 0.999999),
      RenderEvent(
        id: "mutual", kind: "mutual-event", label: "Mutual event active",
        active: visibility.mutualFraction > 1e-4),
      RenderEvent(
        id: "timing-correction", kind: "timing", label: "Timing diagnostics available",
        active: timingAvailable),
      RenderEvent(
        id: "conjunction", kind: "conjunction", label: "Conjunction",
        active: conjunctionActive(state)),
      RenderEvent(
        id: "secondary-eclipse", kind: "secondary-eclipse", label: "Secondary eclipse active",
        active: visibility.secondaryEclipseFraction > 1e-4),
    ]
    let period = scenario.planet.orbit.periodSeconds
    let transitNumber = Int((elapsed / period).rounded())
    let phase = (elapsed / period).truncatingRemainder(dividingBy: 1)
    // The toy O-C reads the moon's star-relative sky offset so stellar reflex motion cancels.
    let oc =
      relativeMoon.map {
        $0.x / max(1, scenario.planet.orbit.semiMajorAxisMetres) * period / (2 * .pi) * 0.01
      } ?? 0
    return EducationStep(
      timeSeconds: timeSeconds, skyPoints: points, flux: total,
      fluxComponents: .init(
        total: total, transitFactor: transitFactor, stellarPreTransit: stellar.preTransit,
        planetPhase: planetPhase, moonPhase: moonPhase),
      timing: .init(
        transitNumber: transitNumber,
        calculatedSeconds: scenario.epochSeconds + Double(transitNumber) * period,
        observedMinusCalculatedSeconds: oc), transitTiming: diagnostics,
      renderSignals: .init(
        phase: phase < 0 ? phase + 1 : phase, dayNightFraction: 0.5 * (1 + cos(2 * .pi * phase)),
        occultedFraction: 1 - transitFactor, events: events), warnings: [],
      observables: observables(state, patches: patches))
  }

  /// Evaluates independent snapshots for each absolute SI time in seconds.
  public mutating func sample(times: [Double]) throws -> [EducationStep] {
    try times.map { try step(at: $0) }
  }

  /// Evaluates barycentric star positions and normalized luminous-disk overlap for a detached binary.
  private func binaryStep(_ binary: DetachedBinary, elapsed: Double, at timeSeconds: Double)
    -> EducationStep
  {
    let primaryMass = binary.primary.star.massKilograms
    let secondaryMass = binary.secondary.star.massKilograms
    let totalMass = primaryMass > 0 && secondaryMass > 0 ? primaryMass + secondaryMass : 0
    let relative = binary.relativeOrbit.position(at: elapsed)
    let primary = relative * (totalMass > 0 ? -secondaryMass / totalMass : 0)
    let secondary = relative * (totalMass > 0 ? primaryMass / totalMass : 1)
    let relativeVelocity = binary.relativeOrbit.velocity(at: elapsed)
    // As the Browser `planetBody`, the companion star takes the planet's place in the observables.
    let observables = StepObservables(
      rvStar: Self.radialVelocity(
        relativeVelocity * (totalMass > 0 ? -secondaryMass / totalMass : 0)),
      rvPlanet: Self.radialVelocity(
        relativeVelocity * (totalMass > 0 ? primaryMass / totalMass : 1)),
      astrometricOffsetStar: SkyOffset(x: primary.x, y: primary.y))
    let primaryVisible = binaryVisibleFlux(
      source: binary.primary, position: primary, foreground: binary.secondary,
      foregroundPosition: secondary)
    let secondaryVisible = binaryVisibleFlux(
      source: binary.secondary, position: secondary, foreground: binary.primary,
      foregroundPosition: primary)
    let baseline = binary.primary.luminosityScale + binary.secondary.luminosityScale
    let visible = primaryVisible + secondaryVisible
    let normalized = baseline > 0 ? visible / baseline : 1
    let phase = (elapsed / binary.relativeOrbit.periodSeconds).truncatingRemainder(dividingBy: 1)
    return EducationStep(
      timeSeconds: timeSeconds,
      skyPoints: [
        .init(body: binary.primary.identifier, position: primary),
        .init(body: binary.secondary.identifier, position: secondary),
      ], flux: normalized,
      fluxComponents: .init(
        total: normalized, transitFactor: normalized, stellarPreTransit: baseline, planetPhase: 0,
        moonPhase: 0),
      timing: .init(
        transitNumber: Int((elapsed / binary.relativeOrbit.periodSeconds).rounded()),
        calculatedSeconds: timeSeconds, observedMinusCalculatedSeconds: 0),
      renderSignals: .init(
        phase: phase < 0 ? phase + 1 : phase, dayNightFraction: 0, occultedFraction: 1 - normalized,
        events: [
          .init(
            id: "binary-eclipse", kind: "binary-eclipse", label: "Binary eclipse active",
            active: normalized < 0.999999)
        ]),
      warnings: [], observables: observables)
  }

  /// Integrates the source disk once, masking it only when the other luminous star is in front.
  private func binaryVisibleFlux(
    source: BinaryStar, position: Vector3, foreground: BinaryStar, foregroundPosition: Vector3
  ) -> Double {
    guard source.luminosityScale > 0 else { return 0 }
    guard foregroundPosition.z > position.z else { return source.luminosityScale }
    if !source.star.limbDarkeningLawPresent {
      let occulter = (
        x: foregroundPosition.x - position.x, y: foregroundPosition.y - position.y,
        radius: foreground.star.radiusMetres
      )
      return source.luminosityScale
        * DiskIntegration.uniformDiskHardOcculterFlux(
          starRadius: source.star.radiusMetres, occulters: [occulter], patches: [],
          gridResolution: scenario.gridResolution)
    }
    let resolution = DiskIntegration.resolution(scenario.gridResolution, fallback: 60)
    let radius = source.star.radiusMetres
    let dy = 2 * radius / Double(resolution)
    var total = 0.0
    var visible = 0.0
    for iy in 0..<resolution {
      let y = -radius + (Double(iy) + 0.5) * dy
      let xMax = sqrt(max(0, radius * radius - y * y))
      let dx = 2 * xMax / Double(resolution)
      for ix in 0..<resolution {
        let x = -xMax + (Double(ix) + 0.5) * dx
        let mu = sqrt(max(0, 1 - (x * x + y * y) / (radius * radius)))
        let weight =
          QuadraticLimbDarkening.intensity(
            mu: mu, u1: source.star.limbDarkeningU1, u2: source.star.limbDarkeningU2) * dx * dy
        total += weight
        let dxForeground = position.x + x - foregroundPosition.x
        let dyForeground = position.y + y - foregroundPosition.y
        if dxForeground * dxForeground + dyForeground * dyForeground >= foreground.star.radiusMetres
          * foreground.star.radiusMetres
        {
          visible += weight
        }
      }
    }
    return source.luminosityScale * (total > 0 ? visible / total : 1)
  }

  /// Composes the primary star's pre- and post-transit flux with the spot modulation S(t) and the
  /// additive stellar variability `var`.
  ///
  /// As the Browser `computeStellarComponents`, S multiplies the primary luminosity only with spot
  /// evolution (static patches give S = 1) and `var` is weighted by the primary's visibility:
  /// `pre = S + var`, `after = S · unionFlux + var · unionFlux`, and
  /// `transitFactor = clamp01(after / pre)`, or 1 for a non-positive `pre`.
  private func stellarComponents(
    unionFlux: Double, patches: [BrightnessPatch], variability: Double
  ) -> (preTransit: Double, transitFactor: Double) {
    let spot =
      scenario.spotEvolution == nil
      ? 1
      : StellarSurface.spottedDiskFluxFactor(
        starRadius: scenario.star.radiusMetres, patches: patches,
        u1: scenario.star.limbDarkeningU1, u2: scenario.star.limbDarkeningU2,
        gridResolution: scenario.gridResolution)
    let preTransit = spot + variability
    let afterTransit = spot * unionFlux + variability * unionFlux
    let transitFactor = preTransit > 0 ? min(1, max(0, afterTransit / preTransit)) : 1
    return (preTransit, transitFactor)
  }

  /// Returns the primary star's visible fraction behind the planet and moon silhouettes in front.
  ///
  /// As the Browser `starVisibilityFromOcculters`, a star without a resolved limb-darkening law
  /// and only circular occulters takes the uniform-disk Cartesian integrator; a law or an oblate
  /// ellipse takes the midpoint chord grid.
  private func transitVisibility(_ input: [Occulter], patches: [StellarSurface.PreparedPatch])
    -> Double
  {
    let front = input.filter { $0.center.z > 0 }
    guard !front.isEmpty, scenario.star.radiusMetres > 0 else { return 1 }
    guard !scenario.star.limbDarkeningLawPresent else {
      return limbDarkenedUnionFlux(front, patches: patches)
    }
    var circles: [(x: Double, y: Double, radius: Double)] = []
    for occulter in front {
      guard case .circle(let center, let radius) = occulter else {
        return limbDarkenedUnionFlux(front, patches: patches)
      }
      circles.append((center.x, center.y, radius))
    }
    return DiskIntegration.uniformDiskHardOcculterFlux(
      starRadius: scenario.star.radiusMetres, occulters: circles, patches: patches,
      gridResolution: scenario.gridResolution)
  }

  /// Samples the stellar disk once so overlapping occulters do not double-count blocked flux.
  ///
  /// As the Browser mixed-shape integrator, a cell is blocked when it lies strictly inside any
  /// opaque circle or oblate ellipse; the grid is the same for both shapes. Brightness patches
  /// multiply the limb-darkened intensity and the flux is normalised to the same patched star:
  /// `1 − blocked / total` for circles (`normalizedLimbFlux`) and `(total − blocked) / total` with
  /// an ellipse (`starVisibilityWithShapeOcculters`).
  private func limbDarkenedUnionFlux(
    _ input: [Occulter], patches: [StellarSurface.PreparedPatch]
  ) -> Double {
    let star = scenario.star
    let radius = star.radiusMetres
    let occulters = input.filter {
      $0.center.z > 0 && hypot($0.center.x, $0.center.y) < radius + $0.reach
    }.map(PreparedOcculter.init)
    guard !occulters.isEmpty else { return 1 }
    var total = 0.0
    var blocked = 0.0
    DiskIntegration.forEachChordCell(
      starRadius: radius,
      resolution: DiskIntegration.resolution(scenario.gridResolution, fallback: 60)
    ) { x, y, mu, area in
      var intensity = QuadraticLimbDarkening.intensity(
        mu: mu, u1: star.limbDarkeningU1, u2: star.limbDarkeningU2)
      if !patches.isEmpty {
        intensity *= StellarSurface.patchFactor(x: x, y: y, prepared: patches)
      }
      let weighted = intensity * area
      total += weighted
      if occulters.contains(where: { $0.blocks(x: x, y: y) }) {
        blocked += weighted
      }
    }
    // As the Browser `normalizedLimbFlux`, a fully dark patched disk counts as unobscured.
    guard total > 1e-12 else { return 1 }
    // The Browser picks the shape path from every occulter in front, overlapping or not.
    let hasEllipse = input.contains {
      if case .ellipse = $0, $0.center.z > 0 { return true }
      return false
    }
    return min(1, max(0, hasEllipse ? (total - blocked) / total : 1 - blocked / total))
  }

  /// Solves a linearized transit center and contacts when the body crosses the stellar disk.
  private func event(at time: Double, position: Vector3, velocity: Vector3, radius: Double) -> (
    Double, Double, Double, Double
  )? {
    let speed2 = velocity.x * velocity.x + velocity.y * velocity.y
    guard speed2 > 0 else { return nil }
    let dt = -(position.x * velocity.x + position.y * velocity.y) / speed2
    let x = position.x + velocity.x * dt
    let y = position.y + velocity.y * dt
    let z = position.z + velocity.z * dt
    let impact = hypot(x, y)
    let sum = scenario.star.radiusMetres + radius
    guard impact < sum, z > 0 else { return nil }
    let duration = 2 * sqrt(max(0, sum * sum - impact * impact)) / sqrt(speed2)
    let center = time + dt
    return (center, duration, center - duration / 2, center + duration / 2)
  }

  /// Builds optional planet and moon contact diagnostics from their current kinematics.
  private func timingDiagnostics(
    at time: Double, planet: Vector3, planetVelocity: Vector3, moon: Vector3?,
    moonVelocity: Vector3?
  ) -> TransitTimingDiagnostics {
    var result = TransitTimingDiagnostics()
    if let event = event(
      at: time, position: planet, velocity: planetVelocity, radius: scenario.planet.radiusMetres)
    {
      result.planetTransitCenterSec = event.0
      result.planetTransitDurationSec = event.1
      result.planetIngressSec = event.2
      result.planetEgressSec = event.3
    }
    if let moon, let moonVelocity, let radius = scenario.moon?.radiusMetres,
      let event = event(at: time, position: moon, velocity: moonVelocity, radius: radius)
    {
      result.moonTransitCenterSec = event.0
      result.moonTransitDurationSec = event.1
      result.moonIngressSec = event.2
      result.moonEgressSec = event.3
    }
    return result
  }
}
