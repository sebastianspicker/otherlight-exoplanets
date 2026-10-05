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
    validateMoon(scenario.moon, into: &issues)
    return issues
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
    ] where !value.isFinite {
      issues.append(.nonFinite(field: name))
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
    let positive: [(String, Double)] =
      [("star.radiusMetres", scenario.star.radiusMetres)] + starMass + [
      ("planet.radiusMetres", scenario.planet.radiusMetres),
      ("planet.orbit.semiMajorAxisMetres", scenario.planet.orbit.semiMajorAxisMetres),
      ("planet.orbit.periodSeconds", scenario.planet.orbit.periodSeconds),
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
    if !(0..<1).contains(scenario.planet.orbit.eccentricity) {
      issues.append(
        .outOfRange(field: "planet.orbit.eccentricity", value: scenario.planet.orbit.eccentricity))
    }
  }

  /// Reports a non-positive sampled disk resolution before detached-binary details.
  private static func validateGridResolution(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    if scenario.gridResolution <= 0 { issues.append(.nonPositive(field: "gridResolution")) }
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

  /// Reports non-finite limb-darkening values after binary component validation.
  private static func validateLimbDarkening(
    _ scenario: EducationScenarioV4, into issues: inout [ValidationIssue]
  ) {
    for (name, value) in [
      ("star.limbDarkeningU1", scenario.star.limbDarkeningU1),
      ("star.limbDarkeningU2", scenario.star.limbDarkeningU2),
    ] where !value.isFinite {
      issues.append(.nonFinite(field: name))
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
