// Models phenomenological stellar variability and stellar-surface sines in normalized flux units.
import Foundation

/// Configures the Browser V4 `photometry.stellarVariability` terms when enabled.
///
/// Knob mode adds `A_b sin(φ + beamingOffset) − A_e cos(2(φ + ellipsoidalOffset))` with φ the
/// signed conjunction phase of the companion; physical mode (`physicalAmplitudes`) replaces both
/// amplitudes with Doppler beaming `−α_b 4 RV_star / c` and the ellipsoidal swing
/// `−α_e q (R*/|r|)³ sin²i cos(2(φ + ellipsoidalOffset))`. The Browser `phaseModel` has no effect.
public struct StellarVariability: Codable, Sendable, Hashable {
  /// Configures an enabled flare: a Gaussian rise before the peak and an exponential decay after it.
  public struct Flare: Codable, Sendable, Hashable {
    /// The peak time in absolute scenario seconds, the amplitude (≤ 0: no flare), and the rise and
    /// decay timescales in seconds.
    public var peakSeconds: Double
    public var amplitude: Double
    public var riseSeconds: Double
    public var decaySeconds: Double
    /// Creates a flare with the Browser defaults for absent fields.
    public init(
      peakSeconds: Double = 0, amplitude: Double = 0, riseSeconds: Double = 300,
      decaySeconds: Double = 1200
    ) {
      self.peakSeconds = peakSeconds
      self.amplitude = amplitude
      self.riseSeconds = riseSeconds
      self.decaySeconds = decaySeconds
    }
  }
  /// Configures one pulsation mode `amplitude · sin(2π t / period + phase)`.
  public struct PulsationMode: Codable, Sendable, Hashable {
    /// The amplitude, period in seconds, and phase in radians.
    public var amplitude: Double
    public var periodSeconds: Double
    public var phaseRadians: Double
    /// Creates a pulsation mode.
    public init(amplitude: Double, periodSeconds: Double, phaseRadians: Double = 0) {
      self.amplitude = amplitude
      self.periodSeconds = periodSeconds
      self.phaseRadians = phaseRadians
    }
  }
  /// The switch, knob amplitudes and phase offsets, constant offset, the enabled flare and
  /// pulsations (nil: disabled), and the stability clamp bounds (nil: ±1e3).
  public var enabled: Bool
  public var beamingAmplitude: Double
  public var ellipsoidalAmplitude: Double
  public var beamingOffsetRadians: Double
  public var ellipsoidalOffsetRadians: Double
  public var constant: Double
  public var flare: Flare?
  public var pulsations: [PulsationMode]?
  public var clampMin: Double?
  public var clampMax: Double?
  /// The physical-amplitude switch and its beaming and ellipsoidal scale factors (nil: 1).
  public var physicalAmplitudes: Bool
  public var beamingAlpha: Double?
  public var ellipsoidalAlpha: Double?
  /// Creates a stellar variability model with the Browser defaults for absent fields.
  public init(
    enabled: Bool = true, beamingAmplitude: Double = 0, ellipsoidalAmplitude: Double = 0,
    beamingOffsetRadians: Double = 0, ellipsoidalOffsetRadians: Double = 0, constant: Double = 0,
    flare: Flare? = nil, pulsations: [PulsationMode]? = nil, clampMin: Double? = nil,
    clampMax: Double? = nil, physicalAmplitudes: Bool = false, beamingAlpha: Double? = nil,
    ellipsoidalAlpha: Double? = nil
  ) {
    self.enabled = enabled
    self.beamingAmplitude = beamingAmplitude
    self.ellipsoidalAmplitude = ellipsoidalAmplitude
    self.beamingOffsetRadians = beamingOffsetRadians
    self.ellipsoidalOffsetRadians = ellipsoidalOffsetRadians
    self.constant = constant
    self.flare = flare
    self.pulsations = pulsations
    self.clampMin = clampMin
    self.clampMax = clampMax
    self.physicalAmplitudes = physicalAmplitudes
    self.beamingAlpha = beamingAlpha
    self.ellipsoidalAlpha = ellipsoidalAlpha
  }
}

/// Configures the Browser V4 `photometry.stellarSurface` block when enabled.
///
/// The native model stores this value only for an enabled block, so its presence means enabled.
/// Granulation and the activity cycle add sines in absolute observer time; the rotation period,
/// `useSurfacePatches`, and `differentialRotationK` are preserved for export.
public struct StellarSurfaceActivity: Codable, Sendable, Hashable {
  /// The granulation amplitude and timescale (nil: 300 s), and the activity-cycle period and
  /// amplitude; each sine needs its amplitude (and the cycle its period).
  public var granulationSigma: Double?
  public var granulationTimescaleSeconds: Double?
  public var activityCyclePeriodSeconds: Double?
  public var activityCycleAmplitude: Double?
  /// The stellar rotation period, and the preserved Browser `useSurfacePatches` and
  /// `differentialRotationK` fields.
  public var rotationPeriodSeconds: Double?
  public var usesSurfacePatches: Bool?
  public var differentialRotationK: Double?
  /// Creates a stellar-surface activity block.
  public init(
    granulationSigma: Double? = nil, granulationTimescaleSeconds: Double? = nil,
    activityCyclePeriodSeconds: Double? = nil, activityCycleAmplitude: Double? = nil,
    rotationPeriodSeconds: Double? = nil, usesSurfacePatches: Bool? = nil,
    differentialRotationK: Double? = nil
  ) {
    self.granulationSigma = granulationSigma
    self.granulationTimescaleSeconds = granulationTimescaleSeconds
    self.activityCyclePeriodSeconds = activityCyclePeriodSeconds
    self.activityCycleAmplitude = activityCycleAmplitude
    self.rotationPeriodSeconds = rotationPeriodSeconds
    self.usesSurfacePatches = usesSurfacePatches
    self.differentialRotationK = differentialRotationK
  }

  /// Returns the granulation and activity-cycle sines at absolute observer seconds, as the
  /// Browser `granulationFlux + activityCycleFlux`.
  public func surfaceActivityFlux(atAbsoluteSeconds seconds: Double) -> Double {
    granulationFlux(atAbsoluteSeconds: seconds) + activityCycleFlux(atAbsoluteSeconds: seconds)
  }

  /// Returns `sigma sin(2π t / max(1, timescale ?? 300))`, or 0 without a finite sigma.
  func granulationFlux(atAbsoluteSeconds seconds: Double) -> Double {
    guard let sigma = granulationSigma, sigma.isFinite else { return 0 }
    return sigma * sin(2 * .pi * seconds / max(1, granulationTimescaleSeconds ?? 300))
  }

  /// Returns `amp sin(2π t / max(1, period))`, or 0 without a finite period and amplitude.
  func activityCycleFlux(atAbsoluteSeconds seconds: Double) -> Double {
    guard let period = activityCyclePeriodSeconds, let amplitude = activityCycleAmplitude,
      period.isFinite, amplitude.isFinite
    else { return 0 }
    return amplitude * sin(2 * .pi * seconds / max(1, period))
  }
}

/// Holds the companion state that phases and scales the stellar variability harmonics.
///
/// Positions and velocities are the companion relative to the varying star; the observer direction
/// points from the star toward the observer. The star velocity (barycentric), masses, stellar
/// radius, and the orbit velocity scale `n a / sqrt(1 − e²)` are optional, as in the Browser.
public struct CompanionGeometry: Sendable, Hashable {
  /// The relative state, the observer direction, and the barycentric star velocity.
  public var relativePosition: Vector3
  public var relativeVelocity: Vector3
  public var observerDirection: Vector3
  public var starVelocity: Vector3?
  /// The star and companion masses in kilograms, stellar radius in metres, and velocity scale.
  public var starMassKilograms: Double?
  public var companionMassKilograms: Double?
  public var starRadiusMetres: Double?
  public var velocityScale: Double?
  /// Creates a companion geometry; the observer looks down +z by default.
  public init(
    relativePosition: Vector3, relativeVelocity: Vector3,
    observerDirection: Vector3 = Vector3(x: 0, y: 0, z: 1), starVelocity: Vector3? = nil,
    starMassKilograms: Double? = nil, companionMassKilograms: Double? = nil,
    starRadiusMetres: Double? = nil, velocityScale: Double? = nil
  ) {
    self.relativePosition = relativePosition
    self.relativeVelocity = relativeVelocity
    self.observerDirection = observerDirection
    self.starVelocity = starVelocity
    self.starMassKilograms = starMassKilograms
    self.companionMassKilograms = companionMassKilograms
    self.starRadiusMetres = starRadiusMetres
    self.velocityScale = velocityScale
  }

  /// Returns the Browser `orbitVelocityScale` `n a / sqrt(1 − e²)`, or nil for an invalid orbit.
  public static func velocityScale(of orbit: KeplerOrbit) -> Double? {
    let period = orbit.periodSeconds
    let a = orbit.semiMajorAxisMetres
    let e = orbit.eccentricity.isFinite ? orbit.eccentricity : 0
    guard period.isFinite, period > 0, a.isFinite, a > 0, e >= 0, e < 1 else { return nil }
    return 2 * .pi / period * a / sqrt(1 - e * e)
  }
}

/// Stellar variability evaluation mirroring the Browser `stellarVariability.ts`.
extension SimulationEngine {
  /// The speed of light in metres per second.
  static let speedOfLight = 299_792_458.0

  /// Returns the signed conjunction phase `ψ = atan2(−(v·ô) / vNorm, (r·ô) / |r|)`, or nil.
  ///
  /// Mirrors the Browser `signedConjunctionPhaseRad`: ψ = 0 at inferior conjunction, π at superior
  /// conjunction for circular motion; eccentric motion retains the legacy beaming surrogate.
  /// `vNorm` falls back to `|v|` when the
  /// supplied scale is absent or not finite and positive.
  public static func signedConjunctionPhase(
    relativePosition r: Vector3, relativeVelocity v: Vector3, observerDirection: Vector3,
    velocityScale: Double? = nil
  ) -> Double? {
    guard isFinite(r), isFinite(v), isFinite(observerDirection) else { return nil }
    let oHat = normalizedOrZero(observerDirection)
    let distance = r.length
    let norm = velocityScale.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? v.length
    guard distance > 1e-15, norm > 0, oHat.length > 0 else { return nil }
    let psi = atan2(-dot(v, oHat) / norm, dot(r, oHat) / distance)
    return psi.isFinite ? psi : nil
  }

  /// Returns geometric conjunction phase using the radial-free orbital tangent.
  private static func geometricConjunctionPhase(
    relativePosition r: Vector3, relativeVelocity v: Vector3, observerDirection: Vector3
  ) -> Double? {
    guard isFinite(r), isFinite(v), isFinite(observerDirection) else { return nil }
    let oHat = normalizedOrZero(observerDirection)
    let distance = r.length
    guard distance > 1e-15, oHat.length > 0 else { return nil }
    let radial = r * (1 / distance)
    let tangent = v - radial * dot(v, radial)
    guard tangent.length > 0 else { return nil }
    let cosine = dot(radial, oHat)
    let sine = -dot(tangent, oHat) / tangent.length
    guard hypot(cosine, sine) > 1e-12 else { return nil }
    let psi = atan2(sine, cosine)
    return psi.isFinite ? psi : nil
  }

  /// Returns the additive stellar variability flux at absolute observer seconds.
  ///
  /// As the Browser `stellarVariabilityFlux`: a disabled model or a non-finite time gives 0; knob
  /// mode short-circuits to 0 when every component is 0; the sum
  /// `((constant + harmonic) + flare) + pulsations` is clamped to the normalised bounds, and a
  /// non-finite sum gives 0. Without a geometry the harmonic terms are 0.
  public static func stellarVariabilityFlux(
    atAbsoluteSeconds seconds: Double, model: StellarVariability, geometry: CompanionGeometry?
  ) -> Double {
    guard model.enabled, seconds.isFinite else { return 0 }
    let beamingAmplitude = finiteOrZero(model.beamingAmplitude)
    let ellipsoidalAmplitude = finiteOrZero(model.ellipsoidalAmplitude)
    let constant = finiteOrZero(model.constant)
    let flare = flareContribution(at: seconds, model.flare)
    let pulsations = pulsationContribution(at: seconds, model.pulsations)
    if !model.physicalAmplitudes,
      [beamingAmplitude, ellipsoidalAmplitude, constant, flare, pulsations].allSatisfy({ $0 == 0 })
    {
      return 0
    }
    let phase = geometry.flatMap {
      signedConjunctionPhase(
        relativePosition: $0.relativePosition, relativeVelocity: $0.relativeVelocity,
        observerDirection: $0.observerDirection, velocityScale: $0.velocityScale)
    }
    let ellipsoidalPhase = geometry.flatMap {
      geometricConjunctionPhase(
        relativePosition: $0.relativePosition, relativeVelocity: $0.relativeVelocity,
        observerDirection: $0.observerDirection)
    }
    var harmonic = 0.0
    if model.physicalAmplitudes {
      if let geometry {
        harmonic =
          physicalBeaming(model, geometry) + physicalEllipsoidal(ellipsoidalPhase, model, geometry)
      }
    } else {
      if let phase {
        harmonic += beamingAmplitude * sin(phase + finiteOrZero(model.beamingOffsetRadians))
      }
      if let ellipsoidalPhase {
        harmonic -=
          ellipsoidalAmplitude
          * cos(2 * (ellipsoidalPhase + finiteOrZero(model.ellipsoidalOffsetRadians)))
      }
    }
    let out = constant + harmonic + flare + pulsations
    guard out.isFinite else { return 0 }
    let bounds = clampBounds(model)
    return min(bounds.max, max(bounds.min, out))
  }

  /// Returns `−α_b 4 RV_star / c` with `RV_star = −(v_star · ô)`, or 0 without a finite velocity.
  private static func physicalBeaming(_ model: StellarVariability, _ geometry: CompanionGeometry)
    -> Double
  {
    guard let starVelocity = geometry.starVelocity, isFinite(starVelocity),
      isFinite(geometry.observerDirection)
    else { return 0 }
    let oHat = normalizedOrZero(geometry.observerDirection)
    guard oHat.length > 0 else { return 0 }
    let radialVelocity = -dot(starVelocity, oHat)
    let alpha = model.beamingAlpha.flatMap { $0.isFinite ? $0 : nil } ?? 1
    return -alpha * 4 * radialVelocity / speedOfLight
  }

  /// Returns `−α_e q (R*/|r|)³ sin²i cos(2(φ + offset))`, or 0 without valid inputs.
  ///
  /// Requires a phase, finite positive star mass and radius, a finite non-negative companion mass,
  /// and `|r| > 0`; `sin²i = 1 − (n̂·ô)²` with `n̂ = normalize(r × v)`.
  private static func physicalEllipsoidal(
    _ phase: Double?, _ model: StellarVariability, _ geometry: CompanionGeometry
  ) -> Double {
    guard let phase, let starMass = geometry.starMassKilograms, starMass.isFinite, starMass > 0,
      let companionMass = geometry.companionMassKilograms, companionMass.isFinite,
      companionMass >= 0, let starRadius = geometry.starRadiusMetres, starRadius.isFinite,
      starRadius > 0, geometry.relativePosition.length > 0
    else { return 0 }
    let q = companionMass / starMass
    let ratio = starRadius / geometry.relativePosition.length
    let normal = normalizedOrZero(cross(geometry.relativePosition, geometry.relativeVelocity))
    let cosI = dot(normal, normalizedOrZero(geometry.observerDirection))
    let sin2I = 1 - cosI * cosI
    let alpha = model.ellipsoidalAlpha.flatMap { $0.isFinite ? $0 : nil } ?? 1
    let offset = finiteOrZero(model.ellipsoidalOffsetRadians)
    return -alpha * q * pow(ratio, 3) * sin2I * cos(2 * (phase + offset))
  }

  /// Returns the flare: `amp exp(−0.5 (dt/rise)²)` up to the peak and `amp exp(−dt/decay)` after.
  private static func flareContribution(at seconds: Double, _ flare: StellarVariability.Flare?)
    -> Double
  {
    guard let flare else { return 0 }
    let amplitude = max(0, finiteOrZero(flare.amplitude))
    let peak = flare.peakSeconds.isFinite ? flare.peakSeconds : 0
    let rise = max(1e-6, flare.riseSeconds.isFinite ? flare.riseSeconds : 300)
    let decay = max(1e-6, flare.decaySeconds.isFinite ? flare.decaySeconds : 1200)
    guard amplitude > 0 else { return 0 }
    let dt = seconds - peak
    if dt <= 0 { return amplitude * exp(-0.5 * (dt / rise) * (dt / rise)) }
    return amplitude * exp(-dt / decay)
  }

  /// Sums the active pulsation modes (finite non-zero amplitude, finite positive period).
  private static func pulsationContribution(
    at seconds: Double, _ modes: [StellarVariability.PulsationMode]?
  ) -> Double {
    guard let modes else { return 0 }
    var sum = 0.0
    for mode in modes {
      let amplitude = finiteOrZero(mode.amplitude)
      let period = mode.periodSeconds
      guard amplitude != 0, period.isFinite, period > 0 else { continue }
      sum += amplitude * sin(2 * .pi * seconds / period + finiteOrZero(mode.phaseRadians))
    }
    return sum.isFinite ? sum : 0
  }

  /// Normalises the clamp bounds: absent or non-finite bounds default to ±1e3, swapped bounds are
  /// ordered, and equal bounds fall back to ±1e3.
  static func clampBounds(_ model: StellarVariability) -> (min: Double, max: Double) {
    let low = model.clampMin.flatMap { $0.isFinite ? $0 : nil } ?? -1e3
    let high = model.clampMax.flatMap { $0.isFinite ? $0 : nil } ?? 1e3
    guard low != high else { return (-1e3, 1e3) }
    return (Swift.min(low, high), Swift.max(low, high))
  }

  /// Returns a finite value unchanged and replaces a non-finite one with 0.
  private static func finiteOrZero(_ value: Double) -> Double { value.isFinite ? value : 0 }

  /// Reports whether all components of a vector are finite.
  private static func isFinite(_ v: Vector3) -> Bool {
    v.x.isFinite && v.y.isFinite && v.z.isFinite
  }

  /// Returns the dot product of two vectors.
  private static func dot(_ a: Vector3, _ b: Vector3) -> Double {
    a.x * b.x + a.y * b.y + a.z * b.z
  }

  /// Returns the cross product of two vectors.
  private static func cross(_ a: Vector3, _ b: Vector3) -> Vector3 {
    Vector3(x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x)
  }

  /// Returns the unit vector, or the zero vector below a length of 1e-15, as `vNormalizeOrZero`.
  private static func normalizedOrZero(_ v: Vector3) -> Vector3 {
    let squared = dot(v, v)
    guard squared.isFinite, squared >= 1e-30 else { return .zero }
    let inverse = 1 / sqrt(squared)
    guard inverse.isFinite else { return .zero }
    return v * inverse
  }
}

/// Stellar variability of the general-lab primary star, phased from the planet.
extension SimulationEngine {
  /// Returns the Browser `stellarSurfaceVariability` (variability plus surface sines) at absolute
  /// observer seconds; detached-binary scenarios return 0.
  public func stellarVariabilityFlux(at timeSeconds: Double) -> Double {
    guard scenario.detachedBinary == nil, timeSeconds.isFinite else { return 0 }
    let state = Self.kinematics(of: scenario, elapsed: timeSeconds - scenario.epochSeconds)
    return stellarSurfaceVariability(state, atAbsoluteSeconds: timeSeconds)
  }

  /// Sums the stellar variability and surface sines with the planet as companion.
  ///
  /// As the Browser `variabilityCompanion`, the geometry is the planet relative to the star, the
  /// star's barycentric velocity, the star mass, the planet's own mass, the stellar radius, and
  /// the velocity scale of the authored planet orbit.
  func stellarSurfaceVariability(_ state: SystemKinematics, atAbsoluteSeconds seconds: Double)
    -> Double
  {
    var flux = 0.0
    if let model = scenario.stellarVariability {
      let geometry = CompanionGeometry(
        relativePosition: state.planet - state.star,
        relativeVelocity: state.planetVelocity - state.starVelocity,
        starVelocity: state.starVelocity, starMassKilograms: scenario.star.massKilograms,
        companionMassKilograms: scenario.planet.massKilograms,
        starRadiusMetres: scenario.star.radiusMetres,
        velocityScale: CompanionGeometry.velocityScale(of: scenario.planet.orbit))
      flux = Self.stellarVariabilityFlux(
        atAbsoluteSeconds: seconds, model: model, geometry: geometry)
    }
    guard let surface = scenario.stellarSurface else { return flux }
    return flux + surface.granulationFlux(atAbsoluteSeconds: seconds)
      + surface.activityCycleFlux(atAbsoluteSeconds: seconds)
  }
}
