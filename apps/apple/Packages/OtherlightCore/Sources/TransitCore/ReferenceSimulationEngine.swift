// Implements the temporally supersampled V4 reference runtime.
import Foundation

/// Evaluates the deterministic V4 reference path through temporal supersampling.
///
/// The reference path retains the center sample's geometry and timing diagnostics while averaging
/// flux-facing values across the fixed 0.2-second observation window used by the Browser runtime.
public struct ReferenceSimulationEngine: Sendable {
  public let scenario: EducationScenarioV4
  public let configuration: EducationRuntimeConfiguration
  private var interactive: SimulationEngine

  /// Creates a validated reference engine with a bounded deterministic sampling configuration.
  public init(
    scenario: EducationScenarioV4,
    configuration: EducationRuntimeConfiguration = .init(mode: .reference)
  ) throws {
    self.scenario = scenario
    self.configuration = configuration
    interactive = try SimulationEngine(scenario: scenario)
  }

  /// Evaluates the center snapshot and averages flux values over the V4 reference window.
  public mutating func step(at timeSeconds: Double) throws -> EducationStep {
    guard timeSeconds.isFinite else { throw ValidationError([.nonFinite(field: "timeSeconds")]) }
    guard configuration.mode == .reference else { return try interactive.step(at: timeSeconds) }

    let count = configuration.referenceSubsteps
    let samples = try (0..<count).map { index in
      let fraction = count <= 1 ? 0 : Double(index) / Double(count - 1)
      return try interactive.step(at: timeSeconds + (fraction - 0.5) * 0.2)
    }
    let center = samples[count / 2]
    let divisor = Double(samples.count)
    let components = FluxComponents(
      total: samples.reduce(0) { $0 + $1.fluxComponents.total } / divisor,
      transitFactor: samples.reduce(0) { $0 + $1.fluxComponents.transitFactor } / divisor,
      stellarPreTransit: samples.reduce(0) { $0 + $1.fluxComponents.stellarPreTransit } / divisor,
      planetPhase: samples.reduce(0) { $0 + $1.fluxComponents.planetPhase } / divisor,
      moonPhase: samples.reduce(0) { $0 + $1.fluxComponents.moonPhase } / divisor)
    var reference = center
    reference.flux = components.total
    reference.fluxComponents = components
    reference.renderSignals.occultedFraction = 1 - components.transitFactor
    return reference
  }

  /// Evaluates independent reference snapshots for each absolute SI time in seconds.
  public mutating func sample(times: [Double]) throws -> [EducationStep] {
    try times.map { try step(at: $0) }
  }
}
