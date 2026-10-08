// Validates bounded Education scenario inputs in the established issue order.
import Foundation

/// Bounded-input validation of the Education engine.
extension SimulationEngine {
  /// Returns all bounded-model input violations without mutating the scenario.
  public static func validate(_ scenario: EducationScenarioV4) -> [ValidationIssue] {
    var issues: [ValidationIssue] = []
    validateIdentity(scenario, into: &issues)
    validatePrimaryValues(scenario, into: &issues)
    validateEccentricity(scenario, into: &issues)
    validateGridResolution(scenario, into: &issues)
    if scenario.mode == .detachedBinaryLab, !validateDetachedBinary(scenario, into: &issues) {
      return issues
    }
    validateLimbDarkening(scenario, into: &issues)
    validatePhaseCurve(scenario.planetPhase, field: "photometry.phaseCurve", into: &issues)
    validatePhaseCurve(scenario.moonPhase, field: "photometry.moonPhaseCurve", into: &issues)
    validateNodeLongitudes(scenario, into: &issues)
    validateMoon(scenario.moon, into: &issues)
    validateShape(scenario.planet.shape, field: "planet.shape", into: &issues)
    validateShape(scenario.moon?.shape, field: "moon.shape", into: &issues)
    validateBrightnessPatches(scenario.brightnessPatches, into: &issues)
    validateSpotEvolution(scenario.spotEvolution, into: &issues)
    validateStellarVariability(scenario.stellarVariability, into: &issues)
    validateStellarSurface(scenario.stellarSurface, into: &issues)
    validateStellarSpin(scenario.star.spin, into: &issues)
    return issues
  }

  /// Reports a non-positive or non-finite spin period and a non-finite axis angle or obliquity.
  private static func validateStellarSpin(
    _ spin: StellarSpin?, into issues: inout [ValidationIssue]
  ) {
    guard let spin else { return }
    appendFiniteAndPositiveIssues(
      finite: [
        ("axisPositionAngleRadians", spin.axisPositionAngleRadians),
        ("obliquityRadians", spin.obliquityRadians),
      ],
      positive: [("rotationPeriodSeconds", spin.rotationPeriodSeconds)], field: "star.spin",
      into: &issues)
  }

  /// Reports non-finite variability amplitudes, offsets, clamp bounds, and alphas, non-positive
  /// flare timescales, and non-positive pulsation periods.
  private static func validateStellarVariability(
    _ model: StellarVariability?, into issues: inout [ValidationIssue]
  ) {
    guard let model else { return }
    let field = "stellarVariability"
    var finite: [(String, Double?)] = [
      ("beamingAmplitude", model.beamingAmplitude),
      ("ellipsoidalAmplitude", model.ellipsoidalAmplitude),
      ("beamingOffsetRadians", model.beamingOffsetRadians),
      ("ellipsoidalOffsetRadians", model.ellipsoidalOffsetRadians),
      ("constant", model.constant), ("clampMin", model.clampMin), ("clampMax", model.clampMax),
      ("beamingAlpha", model.beamingAlpha), ("ellipsoidalAlpha", model.ellipsoidalAlpha),
      ("flare.peakSeconds", model.flare?.peakSeconds), ("flare.amplitude", model.flare?.amplitude),
    ]
    var positive: [(String, Double?)] = [
      ("flare.riseSeconds", model.flare?.riseSeconds),
      ("flare.decaySeconds", model.flare?.decaySeconds),
    ]
    for (index, mode) in (model.pulsations ?? []).enumerated() {
      finite += [
        ("pulsations[\(index)].amplitude", mode.amplitude),
        ("pulsations[\(index)].phaseRadians", mode.phaseRadians),
      ]
      positive.append(("pulsations[\(index)].periodSeconds", mode.periodSeconds))
    }
    appendFiniteAndPositiveIssues(finite: finite, positive: positive, field: field, into: &issues)
  }

  /// Reports non-finite stellar-surface fields and non-positive timescales and periods.
  private static func validateStellarSurface(
    _ surface: StellarSurfaceActivity?, into issues: inout [ValidationIssue]
  ) {
    guard let surface else { return }
    appendFiniteAndPositiveIssues(
      finite: [
        ("granulationSigma", surface.granulationSigma),
        ("activityCycleAmplitude", surface.activityCycleAmplitude),
        ("differentialRotationK", surface.differentialRotationK),
      ],
      positive: [
        ("granulationTimescaleSeconds", surface.granulationTimescaleSeconds),
        ("activityCyclePeriodSeconds", surface.activityCyclePeriodSeconds),
        ("rotationPeriodSeconds", surface.rotationPeriodSeconds),
      ], field: "stellarSurface", into: &issues)
  }

  /// Appends non-finite issues for present values and non-positive issues for present positives.
  private static func appendFiniteAndPositiveIssues(
    finite: [(String, Double?)], positive: [(String, Double?)], field: String,
    into issues: inout [ValidationIssue]
  ) {
    for case (let name, let value?) in finite where !value.isFinite {
      issues.append(.nonFinite(field: "\(field).\(name)"))
    }
    for case (let name, let value?) in positive {
      if !value.isFinite {
        issues.append(.nonFinite(field: "\(field).\(name)"))
      } else if value <= 0 {
        issues.append(.nonPositive(field: "\(field).\(name)"))
      }
    }
  }

  /// Reports non-finite patch fields, negative factors, and non-positive radii.
  private static func validateBrightnessPatches(
    _ patches: [BrightnessPatch], into issues: inout [ValidationIssue]
  ) {
    for (index, patch) in patches.enumerated() {
      let field = "brightnessPatches[\(index)]"
      var values = [("x", patch.x), ("y", patch.y)]
      let radii: [(String, Double)]
      switch patch.shape {
      case .circle(let radius): radii = [("radius", radius)]
      case .ellipse(let rx, let ry, let angle):
        radii = [("rx", rx), ("ry", ry)]
        values.append(("angleRadians", angle))
      }
      for (name, value) in values where !value.isFinite {
        issues.append(.nonFinite(field: "\(field).\(name)"))
      }
      if !patch.factor.isFinite {
        issues.append(.nonFinite(field: "\(field).factor"))
      } else if patch.factor < 0 {
        issues.append(.outOfRange(field: "\(field).factor", value: patch.factor))
      }
      for (name, value) in radii {
        if !value.isFinite {
          issues.append(.nonFinite(field: "\(field).\(name)"))
        } else if value <= 0 {
          issues.append(.nonPositive(field: "\(field).\(name)"))
        }
      }
    }
  }

  /// Reports non-finite spot-evolution fields, coverage outside [0, 1], and non-positive periods
  /// and lifetimes.
  private static func validateSpotEvolution(
    _ spot: SpotEvolution?, into issues: inout [ValidationIssue]
  ) {
    guard let spot else { return }
    for (name, value) in [
      ("rotationPhase0Radians", spot.rotationPhase0Radians),
      ("driftRateRadiansPerSecond", spot.driftRateRadiansPerSecond),
      ("referenceEpochSeconds", spot.referenceEpochSeconds),
    ] where !value.isFinite {
      issues.append(.nonFinite(field: "spotEvolution.\(name)"))
    }
    if !spot.coverage.isFinite {
      issues.append(.nonFinite(field: "spotEvolution.coverage"))
    } else if !(0...1).contains(spot.coverage) {
      issues.append(.outOfRange(field: "spotEvolution.coverage", value: spot.coverage))
    }
    for (name, value) in [
      ("rotationPeriodSeconds", spot.rotationPeriodSeconds),
      ("lifetimeSeconds", spot.lifetimeSeconds),
    ] {
      guard let value else { continue }
      if !value.isFinite {
        issues.append(.nonFinite(field: "spotEvolution.\(name)"))
      } else if value <= 0 {
        issues.append(.nonPositive(field: "spotEvolution.\(name)"))
      }
    }
  }

  /// Reports a non-finite or out-of-range authored oblateness, a non-finite shape angle, and a
  /// non-finite or non-positive equatorial radius.
  ///
  /// As the Browser, an oblateness of at least 1 is rejected and a non-positive one has no effect.
  private static func validateShape(
    _ shape: BodyShape?, field: String, into issues: inout [ValidationIssue]
  ) {
    guard let shape else { return }
    if !shape.oblateness.isFinite {
      issues.append(.nonFinite(field: "\(field).oblateness"))
    } else if shape.oblateness >= 1 {
      issues.append(.outOfRange(field: "\(field).oblateness", value: shape.oblateness))
    }
    if !shape.angleRadians.isFinite {
      issues.append(.nonFinite(field: "\(field).angleRadians"))
    }
    appendFiniteAndPositiveIssues(
      finite: [], positive: [("equatorialRadiusMetres", shape.equatorialRadiusMetres)],
      field: field, into: &issues)
  }

  /// Validates every angular element of the orbit actually evaluated by this mode.
  private static func validateNodeLongitudes(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    let name = scenario.detachedBinary == nil ? "planet.orbit" : "detachedBinary.relativeOrbit"
    let orbit = scenario.detachedBinary?.relativeOrbit ?? scenario.planet.orbit
    for (field, value) in [
      ("inclinationRadians", orbit.inclinationRadians),
      ("argumentOfPeriapsisRadians", orbit.argumentOfPeriapsisRadians),
      ("meanAnomalyAtEpochRadians", orbit.meanAnomalyAtEpochRadians),
      ("longitudeOfAscendingNodeRadians", orbit.longitudeOfAscendingNodeRadians),
    ] where !value.isFinite {
      issues.append(.nonFinite(field: "\(name).\(field)"))
    }
    if !scenario.epochSeconds.isFinite { issues.append(.nonFinite(field: "epochSeconds")) }
  }

  /// Reports moon radius and relative-orbit violations with the Browser V4 orbit rules.
  private static func validateMoon(_ moon: Moon?, into issues: inout [ValidationIssue]) {
    guard let moon else { return }
    for (name, value) in [
      ("moon.radiusMetres", moon.radiusMetres),
      ("moon.orbit.semiMajorAxisMetres", moon.orbit.semiMajorAxisMetres),
      ("moon.orbit.periodSeconds", moon.orbit.periodSeconds),
    ] {
      if !value.isFinite {
        issues.append(.nonFinite(field: name))
      } else if value <= 0 {
        issues.append(.nonPositive(field: name))
      }
    }
    if !(0..<1).contains(moon.orbit.eccentricity) {
      issues.append(.outOfRange(field: "moon.orbit.eccentricity", value: moon.orbit.eccentricity))
    }
    for (name, value) in [
      ("moon.orbit.inclinationRadians", moon.orbit.inclinationRadians),
      ("moon.orbit.argumentOfPeriapsisRadians", moon.orbit.argumentOfPeriapsisRadians),
      ("moon.orbit.meanAnomalyAtEpochRadians", moon.orbit.meanAnomalyAtEpochRadians),
      ("moon.orbit.longitudeOfAscendingNodeRadians", moon.orbit.longitudeOfAscendingNodeRadians),
    ] where !value.isFinite {
      issues.append(.nonFinite(field: name))
    }
    if let epoch = moon.orientationDrift?.referenceEpochSeconds, !epoch.isFinite {
      issues.append(.nonFinite(field: "moon.orientationDrift.referenceEpochSeconds"))
    }
  }

  /// Reports the stable identifier violation before numerical violations.
  private static func validateIdentity(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    if scenario.identifier.isEmpty { issues.append(.invalidIdentifier) }
  }

  /// Reports the general-lab positive SI quantities in their established error order.
  private static func validatePrimaryValues(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    // Detached-binary component masses may be absent (zero); validateDetachedBinary checks them.
    let starMass: [(String, Double)] =
      scenario.mode == .detachedBinaryLab
      ? [] : [("star.massKilograms", scenario.star.massKilograms)]
    let orbit = scenario.detachedBinary?.relativeOrbit ?? scenario.planet.orbit
    let prefix = scenario.detachedBinary == nil ? "planet.orbit" : "detachedBinary.relativeOrbit"
    let positive: [(String, Double)] =
      [("star.radiusMetres", scenario.star.radiusMetres)] + starMass + [
        ("planet.radiusMetres", scenario.planet.radiusMetres),
        ("\(prefix).semiMajorAxisMetres", orbit.semiMajorAxisMetres),
        ("\(prefix).periodSeconds", orbit.periodSeconds),
      ]
    for (name, value) in positive {
      if !value.isFinite {
        issues.append(.nonFinite(field: name))
      } else if value <= 0 {
        issues.append(.nonPositive(field: name))
      }
    }
  }

  /// Reports the orbit eccentricity after the other primary orbital quantities.
  private static func validateEccentricity(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    let orbit = scenario.detachedBinary?.relativeOrbit ?? scenario.planet.orbit
    let prefix = scenario.detachedBinary == nil ? "planet.orbit" : "detachedBinary.relativeOrbit"
    if !(0..<1).contains(orbit.eccentricity) {
      issues.append(
        .outOfRange(field: "\(prefix).eccentricity", value: orbit.eccentricity))
    }
  }

  /// Reports a non-finite authored disk resolution before detached-binary details.
  ///
  /// As the Browser `clampGridRes`, non-positive and non-integral values are accepted: they are
  /// floored and clamped up to each integrator's minimum.
  private static func validateGridResolution(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    if let value = scenario.gridResolution, !value.isFinite {
      issues.append(.nonFinite(field: "gridResolution"))
    }
  }

  /// Validates binary components and reports whether its required model was present.
  ///
  /// Masses may be zero: as in the Browser, the barycentric split then keeps the primary fixed.
  private static func validateDetachedBinary(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) -> Bool {
    guard let binary = scenario.detachedBinary else {
      issues.append(.nonPositive(field: "detachedBinary"))
      return false
    }
    for (name, value) in [
      ("detachedBinary.primary.radiusMetres", binary.primary.star.radiusMetres),
      ("detachedBinary.secondary.radiusMetres", binary.secondary.star.radiusMetres),
      ("detachedBinary.primary.massKilograms", binary.primary.star.massKilograms),
      ("detachedBinary.secondary.massKilograms", binary.secondary.star.massKilograms),
      ("detachedBinary.primary.luminosityScale", binary.primary.luminosityScale),
      ("detachedBinary.secondary.luminosityScale", binary.secondary.luminosityScale),
    ] {
      if !value.isFinite {
        issues.append(.nonFinite(field: name))
      } else if value <= 0 && name.hasSuffix("radiusMetres") {
        issues.append(.nonPositive(field: name))
      } else if !name.hasSuffix("radiusMetres") && value < 0 {
        issues.append(.outOfRange(field: name, value: value))
      }
    }
    return true
  }

  /// Reports non-finite limb-darkening values, and non-zero ones of a star without a law, after
  /// binary component validation.
  private static func validateLimbDarkening(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    for (name, value) in [
      ("star.limbDarkeningU1", scenario.star.limbDarkeningU1),
      ("star.limbDarkeningU2", scenario.star.limbDarkeningU2),
    ] {
      if !value.isFinite {
        issues.append(.nonFinite(field: name))
      } else if !scenario.star.limbDarkeningLawPresent, value != 0 {
        // A star without a law is a uniform disk, so its coefficients must be 0.
        issues.append(.outOfRange(field: name, value: value))
      }
    }
  }

  /// Reports invalid active or preserved phase parameters without changing their serialized values.
  private static func validatePhaseCurve(
    _ curve: PhaseCurve?, field: String, into issues: inout [ValidationIssue]
  ) {
    guard let curve else { return }
    for (name, value) in [
      ("reflectedAmplitude", curve.reflectedAmplitude),
      ("thermalAmplitude", curve.thermalAmplitude),
      ("constantFlux", curve.constantFlux),
    ] {
      guard value.isFinite else {
        issues.append(.nonFinite(field: "\(field).\(name)"))
        continue
      }
      if value < 0 { issues.append(.outOfRange(field: "\(field).\(name)", value: value)) }
    }
    for (name, value) in [
      ("reflectedOffsetRadians", curve.reflectedOffsetRadians),
      ("thermalOffsetRadians", curve.thermalOffsetRadians),
    ] where !value.isFinite {
      issues.append(.nonFinite(field: "\(field).\(name)"))
    }
  }
}
