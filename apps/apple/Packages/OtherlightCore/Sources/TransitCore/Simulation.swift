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
/// The engine uses fixed Kepler orbits, a sampled limb-darkened stellar disk, circular opaque
/// occulters, and additive phase terms. It intentionally omits N-body evolution and detailed
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
    var occluders = [(position: relativePlanet, radius: scenario.planet.radiusMetres)]
    let relativeMoon = state.moon.map { $0 - state.star }
    if let moonPosition = state.moon, let relativeMoon, let moon = scenario.moon {
      points.append(SkyPoint(body: "moon", position: moonPosition))
      occluders.append((relativeMoon, moon.radiusMetres))
    }

    let transitFactor = limbDarkenedUnionFlux(occluders)
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
    let total = transitFactor + planetPhase + moonPhase
    let diagnostics = timingDiagnostics(
      at: timeSeconds, planet: relativePlanet, planetVelocity: state.planetVelocity - state.starVelocity,
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
      RenderEvent(id: "conjunction", kind: "conjunction", label: "Conjunction", active: false),
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
        total: total, transitFactor: transitFactor, stellarPreTransit: 1, planetPhase: planetPhase,
        moonPhase: moonPhase),
      timing: .init(
        transitNumber: transitNumber,
        calculatedSeconds: scenario.epochSeconds + Double(transitNumber) * period,
        observedMinusCalculatedSeconds: oc), transitTiming: diagnostics,
      renderSignals: .init(
        phase: phase < 0 ? phase + 1 : phase, dayNightFraction: 0.5 * (1 + cos(2 * .pi * phase)),
        occultedFraction: 1 - transitFactor, events: events), warnings: [])
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
      warnings: [])
  }

  /// Integrates the source disk once, masking it only when the other luminous star is in front.
  private func binaryVisibleFlux(
    source: BinaryStar, position: Vector3, foreground: BinaryStar, foregroundPosition: Vector3
  ) -> Double {
    guard source.luminosityScale > 0 else { return 0 }
    guard foregroundPosition.z > position.z else { return source.luminosityScale }
    let resolution = max(60, min(1024, scenario.gridResolution))
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

  /// Samples the stellar disk once so overlapping occulters do not double-count blocked flux.
  private func limbDarkenedUnionFlux(_ input: [(position: Vector3, radius: Double)]) -> Double {
    let star = scenario.star
    let radius = star.radiusMetres
    let occulters = input.filter {
      $0.position.z > 0 && hypot($0.position.x, $0.position.y) < radius + $0.radius
    }
    guard !occulters.isEmpty else { return 1 }
    let resolution = max(60, min(1024, scenario.gridResolution))
    let dy = 2 * radius / Double(resolution)
    let r2 = radius * radius
    var total = 0.0
    var blocked = 0.0
    for iy in 0..<resolution {
      let y = -radius + (Double(iy) + 0.5) * dy
      let y2 = y * y
      let xMax = sqrt(max(0, r2 - y2))
      let dx = 2 * xMax / Double(resolution)
      let area = dx * dy
      for ix in 0..<resolution {
        let x = -xMax + (Double(ix) + 0.5) * dx
        let mu = sqrt(max(0, 1 - (x * x + y2) / r2))
        let intensity = QuadraticLimbDarkening.intensity(
          mu: mu, u1: star.limbDarkeningU1, u2: star.limbDarkeningU2)
        let weighted = intensity * area
        total += weighted
        if occulters.contains(where: {
          let dx = x - $0.position.x
          let dy = y - $0.position.y
          return dx * dx + dy * dy < $0.radius * $0.radius
        }) {
          blocked += weighted
        }
      }
    }
    return min(1, max(0, 1 - blocked / total))
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
