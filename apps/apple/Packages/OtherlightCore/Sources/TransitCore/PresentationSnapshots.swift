// Defines simulation output snapshots consumed by education and visualization modules.
import Foundation

/// Names a simulated body and its sky-plane position for rendering.
public struct SkyPoint: Codable, Sendable, Hashable {
  public var body: String
  public var position: Vector3
  /// Creates a named body snapshot at a sky-plane position.
  public init(body: String, position: Vector3) {
    self.body = body
    self.position = position
  }
}

/// Stores calculated and observed-minus-calculated timing information for one transit index.
public struct TransitTimingSignal: Codable, Sendable, Hashable {
  public var transitNumber: Int?
  public var ephemerisEpochSeconds: Double?
  public var ephemerisPeriodSeconds: Double?
  public var calculatedSeconds: Double?
  public var observedMinusCalculatedSeconds: Double?
  public var durationVariationSeconds: Double?
  public var isValid: Bool
  /// Creates a timing sample with its explicit reference ephemeris and solved residuals.
  public init(
    transitNumber: Int?, ephemerisEpochSeconds: Double?, ephemerisPeriodSeconds: Double?,
    calculatedSeconds: Double?, observedMinusCalculatedSeconds: Double?,
    durationVariationSeconds: Double?, isValid: Bool
  ) {
    self.transitNumber = transitNumber
    self.ephemerisEpochSeconds = ephemerisEpochSeconds
    self.ephemerisPeriodSeconds = ephemerisPeriodSeconds
    self.calculatedSeconds = calculatedSeconds
    self.observedMinusCalculatedSeconds = observedMinusCalculatedSeconds
    self.durationVariationSeconds = durationVariationSeconds
    self.isValid =
      isValid && ephemerisEpochSeconds?.isFinite == true
      && ephemerisPeriodSeconds?.isFinite == true && (ephemerisPeriodSeconds ?? 0) > 0
      && transitNumber != nil && calculatedSeconds?.isFinite == true
      && observedMinusCalculatedSeconds?.isFinite == true
      && (durationVariationSeconds == nil || durationVariationSeconds?.isFinite == true)
  }

  /// An unavailable signal carries no fabricated timing values.
  public static let unavailable = TransitTimingSignal(
    transitNumber: nil, ephemerisEpochSeconds: nil, ephemerisPeriodSeconds: nil,
    calculatedSeconds: nil, observedMinusCalculatedSeconds: nil, durationVariationSeconds: nil,
    isValid: false)

  /// An unavailable event can still expose the reference ephemeris used for the attempted solve.
  public static func unavailable(referenceEpochSeconds: Double, referencePeriodSeconds: Double)
    -> TransitTimingSignal
  {
    TransitTimingSignal(
      transitNumber: nil, ephemerisEpochSeconds: referenceEpochSeconds,
      ephemerisPeriodSeconds: referencePeriodSeconds, calculatedSeconds: nil,
      observedMinusCalculatedSeconds: nil, durationVariationSeconds: nil, isValid: false)
  }

  /// Creates a timing signal for one solved event against a reference linear ephemeris.
  public static func solved(
    transitNumber: Int, ephemerisEpochSeconds: Double, ephemerisPeriodSeconds: Double,
    calculatedSeconds: Double, observedSeconds: Double, durationVariationSeconds: Double
  ) -> TransitTimingSignal {
    TransitTimingSignal(
      transitNumber: transitNumber, ephemerisEpochSeconds: ephemerisEpochSeconds,
      ephemerisPeriodSeconds: ephemerisPeriodSeconds, calculatedSeconds: calculatedSeconds,
      observedMinusCalculatedSeconds: observedSeconds - calculatedSeconds,
      durationVariationSeconds: durationVariationSeconds, isValid: true)
  }

  /// Names the serialized solved-event fields.
  private enum CodingKeys: String, CodingKey {
    case transitNumber, ephemerisEpochSeconds, ephemerisPeriodSeconds, calculatedSeconds
    case observedMinusCalculatedSeconds, durationVariationSeconds, isValid
  }

  /// Reads legacy timing as unavailable and requires an explicit finite ephemeris for solved data.
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    ephemerisEpochSeconds = try container.decodeIfPresent(
      Double.self, forKey: .ephemerisEpochSeconds)
    ephemerisPeriodSeconds = try container.decodeIfPresent(
      Double.self, forKey: .ephemerisPeriodSeconds)
    isValid = try container.decodeIfPresent(Bool.self, forKey: .isValid) ?? false
    if isValid {
      transitNumber = try container.decodeIfPresent(Int.self, forKey: .transitNumber)
      calculatedSeconds = try container.decodeIfPresent(Double.self, forKey: .calculatedSeconds)
      observedMinusCalculatedSeconds = try container.decodeIfPresent(
        Double.self, forKey: .observedMinusCalculatedSeconds)
      durationVariationSeconds = try container.decodeIfPresent(
        Double.self, forKey: .durationVariationSeconds)
      let hasReference =
        ephemerisEpochSeconds?.isFinite == true
        && ephemerisPeriodSeconds?.isFinite == true
        && (ephemerisPeriodSeconds ?? 0) > 0
      let hasEvent =
        transitNumber != nil && calculatedSeconds?.isFinite == true
        && observedMinusCalculatedSeconds?.isFinite == true
        && (durationVariationSeconds == nil || durationVariationSeconds?.isFinite == true)
      if !hasReference || !hasEvent {
        isValid = false
        transitNumber = nil
        calculatedSeconds = nil
        observedMinusCalculatedSeconds = nil
        durationVariationSeconds = nil
      }
    } else {
      transitNumber = nil
      calculatedSeconds = nil
      observedMinusCalculatedSeconds = nil
      durationVariationSeconds = nil
    }
  }

  /// Encodes optional values without fabricating residuals for unavailable events.
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encodeIfPresent(transitNumber, forKey: .transitNumber)
    try container.encodeIfPresent(ephemerisEpochSeconds, forKey: .ephemerisEpochSeconds)
    try container.encodeIfPresent(ephemerisPeriodSeconds, forKey: .ephemerisPeriodSeconds)
    try container.encodeIfPresent(calculatedSeconds, forKey: .calculatedSeconds)
    try container.encodeIfPresent(
      observedMinusCalculatedSeconds, forKey: .observedMinusCalculatedSeconds)
    try container.encodeIfPresent(durationVariationSeconds, forKey: .durationVariationSeconds)
    try container.encode(isValid, forKey: .isValid)
  }
}

/// Holds optional contact and center times for planet and moon transits.
public struct TransitTimingDiagnostics: Codable, Sendable, Hashable {
  public var planetTransitCenterSec: Double?
  public var planetTransitDurationSec: Double?
  public var planetIngressSec: Double?
  public var planetEgressSec: Double?
  public var planetDurationVariationSec: Double?
  public var moonTransitCenterSec: Double?
  public var moonTransitDurationSec: Double?
  public var moonIngressSec: Double?
  public var moonEgressSec: Double?
  /// Creates empty optional transit timing diagnostics.
  public init() {}
}

/// Breaks total flux into transit and phase contributions for explanation and plotting.
public struct FluxComponents: Codable, Sendable, Hashable {
  public var total: Double
  public var transitFactor: Double
  public var stellarPreTransit: Double
  public var planetPhase: Double
  public var moonPhase: Double
  /// Creates flux components for a rendered simulation step.
  public init(
    total: Double, transitFactor: Double, stellarPreTransit: Double, planetPhase: Double,
    moonPhase: Double
  ) {
    self.total = total
    self.transitFactor = transitFactor
    self.stellarPreTransit = stellarPreTransit
    self.planetPhase = planetPhase
    self.moonPhase = moonPhase
  }
}

/// Describes one named rendering condition for presentation layers.
public struct RenderEvent: Codable, Sendable, Hashable {
  public let id: String
  public let kind: String
  public let label: String
  public let active: Bool
  /// Creates a named rendering event and its active state.
  public init(id: String, kind: String, label: String, active: Bool) {
    self.id = id
    self.kind = kind
    self.label = label
    self.active = active
  }
}

/// Provides normalized phase, occultation, and event signals for view layers.
public struct RenderSignals: Codable, Sendable, Hashable {
  public var phase: Double
  public var dayNightFraction: Double
  public var occultedFraction: Double
  public var events: [RenderEvent]
  /// Creates normalized signals for phase, occultation, and rendering events.
  public init(
    phase: Double, dayNightFraction: Double, occultedFraction: Double, events: [RenderEvent] = []
  ) {
    self.phase = phase
    self.dayNightFraction = dayNightFraction
    self.occultedFraction = occultedFraction
    self.events = events
  }
}

/// Captures the complete simulation snapshot consumed by education and visualization modules.
public struct EducationStep: Codable, Sendable, Hashable {
  public var timeSeconds: Double
  public var skyPoints: [SkyPoint]
  public var flux: Double
  public var fluxComponents: FluxComponents
  public var timing: TransitTimingSignal
  public var transitTiming: TransitTimingDiagnostics
  public var renderSignals: RenderSignals
  public var warnings: [String]
  /// The radial-velocity and astrometric observables (nil: not evaluated). The binary lab fills
  /// the star and companion radial velocities and the primary's astrometric offset, without a
  /// moon velocity or a Rossiter–McLaughlin anomaly.
  public var observables: StepObservables?
  /// Creates a complete education snapshot for one simulation time.
  public init(
    timeSeconds: Double, skyPoints: [SkyPoint], flux: Double, fluxComponents: FluxComponents? = nil,
    timing: TransitTimingSignal, transitTiming: TransitTimingDiagnostics = .init(),
    renderSignals: RenderSignals, warnings: [String], observables: StepObservables? = nil
  ) {
    self.timeSeconds = timeSeconds
    self.skyPoints = skyPoints
    self.flux = flux
    self.fluxComponents =
      fluxComponents
      ?? .init(total: flux, transitFactor: flux, stellarPreTransit: 1, planetPhase: 0, moonPhase: 0)
    self.timing = timing
    self.transitTiming = transitTiming
    self.renderSignals = renderSignals
    self.warnings = warnings
    self.observables = observables
  }
}
