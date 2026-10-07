// Defines SI-domain models and scenario inputs for the deterministic simulation kernel.
import Foundation

/// Enumerates the SI units used by the simulation's physical quantities.
public enum SIUnit: String, Codable, Sendable { case metres, seconds, kilograms, radians, watts }

/// Couples a finite scalar with its declared SI unit for interchange boundaries.
public struct SIValue: Codable, Sendable, Hashable {
  public let value: Double
  public let unit: SIUnit
  /// Creates a finite scalar carrying the supplied SI unit.
  public init(_ value: Double, unit: SIUnit) throws {
    guard value.isFinite else { throw ValidationError([.nonFinite(field: unit.rawValue)]) }
    self.value = value
    self.unit = unit
  }
}

/// Represents a Cartesian vector for orbital positions and velocities in SI units.
public struct Vector3: Codable, Sendable, Hashable {
  public var x: Double
  public var y: Double
  public var z: Double
  /// Creates a Cartesian vector from its three components.
  public init(x: Double, y: Double, z: Double) {
    self.x = x
    self.y = y
    self.z = z
  }
  public static let zero = Vector3(x: 0, y: 0, z: 0)
  public var length: Double { sqrt(x * x + y * y + z * z) }
  /// Adds corresponding components of two vectors.
  public static func + (lhs: Self, rhs: Self) -> Self {
    .init(x: lhs.x + rhs.x, y: lhs.y + rhs.y, z: lhs.z + rhs.z)
  }
  /// Subtracts corresponding components of two vectors.
  public static func - (lhs: Self, rhs: Self) -> Self {
    .init(x: lhs.x - rhs.x, y: lhs.y - rhs.y, z: lhs.z - rhs.z)
  }
  /// Scales each vector component by a scalar.
  public static func * (lhs: Self, rhs: Double) -> Self {
    .init(x: lhs.x * rhs, y: lhs.y * rhs, z: lhs.z * rhs)
  }
}

/// Stores the fixed Keplerian elements used by the deterministic teaching model.
public struct KeplerOrbit: Codable, Sendable, Hashable {
  public var semiMajorAxisMetres: Double
  public var periodSeconds: Double
  public var eccentricity: Double
  public var inclinationRadians: Double
  public var argumentOfPeriapsisRadians: Double
  public var meanAnomalyAtEpochRadians: Double
  public var longitudeOfAscendingNodeRadians: Double
  /// Creates a Keplerian orbit from its SI elements and optional defaults.
  public init(
    semiMajorAxisMetres: Double, periodSeconds: Double, eccentricity: Double = 0,
    inclinationRadians: Double = .pi / 2, argumentOfPeriapsisRadians: Double = 0,
    meanAnomalyAtEpochRadians: Double = 0, longitudeOfAscendingNodeRadians: Double = 0
  ) {
    self.semiMajorAxisMetres = semiMajorAxisMetres
    self.periodSeconds = periodSeconds
    self.eccentricity = eccentricity
    self.inclinationRadians = inclinationRadians
    self.argumentOfPeriapsisRadians = argumentOfPeriapsisRadians
    self.meanAnomalyAtEpochRadians = meanAnomalyAtEpochRadians
    self.longitudeOfAscendingNodeRadians = longitudeOfAscendingNodeRadians
  }
  /// Names the serialized orbit fields.
  private enum CodingKeys: String, CodingKey {
    case semiMajorAxisMetres, periodSeconds, eccentricity, inclinationRadians
    case argumentOfPeriapsisRadians, meanAnomalyAtEpochRadians, longitudeOfAscendingNodeRadians
  }
  /// Decodes an orbit, reading an absent node longitude from older documents as zero.
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      semiMajorAxisMetres: try container.decode(Double.self, forKey: .semiMajorAxisMetres),
      periodSeconds: try container.decode(Double.self, forKey: .periodSeconds),
      eccentricity: try container.decode(Double.self, forKey: .eccentricity),
      inclinationRadians: try container.decode(Double.self, forKey: .inclinationRadians),
      argumentOfPeriapsisRadians: try container.decode(
        Double.self, forKey: .argumentOfPeriapsisRadians),
      meanAnomalyAtEpochRadians: try container.decode(
        Double.self, forKey: .meanAnomalyAtEpochRadians),
      longitudeOfAscendingNodeRadians: try container.decodeIfPresent(
        Double.self, forKey: .longitudeOfAscendingNodeRadians) ?? 0)
  }
  /// Solves the orbit at elapsed seconds to project its body into the observer frame.
  public func position(at seconds: Double) -> Vector3 {
    let eccentric = Self.eccentricAnomaly(
      mean: meanAnomalyAtEpochRadians + 2 * .pi * seconds / periodSeconds,
      eccentricity: eccentricity)
    let orbitalX = semiMajorAxisMetres * (cos(eccentric) - eccentricity)
    let orbitalY =
      semiMajorAxisMetres * sqrt(max(0, 1 - eccentricity * eccentricity)) * sin(eccentric)
    let angle = argumentOfPeriapsisRadians
    let x = orbitalX * cos(angle) - orbitalY * sin(angle)
    let y = orbitalX * sin(angle) + orbitalY * cos(angle)
    return rotatedByNode(
      Vector3(x: -y * cos(inclinationRadians), y: x, z: y * sin(inclinationRadians)))
  }
  /// Returns the analytic observer-frame velocity, using the exact circular form the Browser uses.
  public func velocity(at seconds: Double) -> Vector3 {
    let rate = 2 * .pi / periodSeconds
    if eccentricity == 0 {
      let argument =
        Self.wrap(meanAnomalyAtEpochRadians + 2 * .pi * seconds / periodSeconds)
        + argumentOfPeriapsisRadians
      return rotatedByNode(
        Vector3(
          x: -semiMajorAxisMetres * cos(argument) * cos(inclinationRadians) * rate,
          y: -semiMajorAxisMetres * sin(argument) * rate,
          z: semiMajorAxisMetres * cos(argument) * sin(inclinationRadians) * rate))
    }
    let eccentric = Self.eccentricAnomaly(
      mean: meanAnomalyAtEpochRadians + 2 * .pi * seconds / periodSeconds,
      eccentricity: eccentricity)
    let anomalyRate = rate / (1 - eccentricity * cos(eccentric))
    let orbitalX = -semiMajorAxisMetres * sin(eccentric) * anomalyRate
    let orbitalY =
      semiMajorAxisMetres * sqrt(max(0, 1 - eccentricity * eccentricity)) * cos(eccentric)
      * anomalyRate
    let angle = argumentOfPeriapsisRadians
    let x = orbitalX * cos(angle) - orbitalY * sin(angle)
    let y = orbitalX * sin(angle) + orbitalY * cos(angle)
    return rotatedByNode(
      Vector3(x: -y * cos(inclinationRadians), y: x, z: y * sin(inclinationRadians)))
  }
  /// Applies the Browser's final `Rz(Ω)` as a planar rotation of the observer-frame x-y plane.
  ///
  /// The sky basis for the observer along +z is a fixed rotation of the inertial frame, so the
  /// inertial node rotation acts on sky `(x, y)` as `(x cos Ω - y sin Ω, x sin Ω + y cos Ω)`.
  private func rotatedByNode(_ vector: Vector3) -> Vector3 {
    let node = longitudeOfAscendingNodeRadians
    guard node != 0 else { return vector }
    return Vector3(
      x: vector.x * cos(node) - vector.y * sin(node),
      y: vector.x * sin(node) + vector.y * cos(node), z: vector.z)
  }
  /// Solves elliptic Kepler's equation with the Browser's bounded, damped Newton scheme.
  ///
  /// The mean anomaly is wrapped to (-π, π]; the start value, derivative floor, 1 rad step limit,
  /// clamping, tolerance, and iteration budget mirror `apps/browser/src/domain/orbits/kepler.ts`.
  public static func eccentricAnomaly(mean: Double, eccentricity e: Double) -> Double {
    let wrapped = wrapToPi(mean)
    guard mean.isFinite, e.isFinite, e > 0 else { return wrapped }
    var eccentric = initialEccentricAnomaly(wrapped, eccentricity: e)
    for _ in 0..<(e > 0.95 ? 60 : 30) {
      let residual = eccentric - e * sin(eccentric) - wrapped
      if abs(residual) <= 1e-12 { break }
      let step = newtonStep(residual: residual, derivative: 1 - e * cos(eccentric))
      eccentric = min(.pi, max(-.pi, eccentric + step))
      if abs(step) <= 1e-12 { break }
    }
    return wrapToPi(eccentric)
  }
  /// Starts near the root for moderate eccentricity and at ±π for highly eccentric orbits.
  private static func initialEccentricAnomaly(_ wrapped: Double, eccentricity e: Double) -> Double {
    if e < 0.8 { return wrapToPi(wrapped + e * sin(wrapped) * (1 + e * cos(wrapped))) }
    if abs(wrapped) < 1e-12 { return 0 }
    return wrapped > 0 ? .pi : -.pi
  }
  /// Returns a Newton step with the derivative floored at 1e-14 and the step limited to 1 rad.
  private static func newtonStep(residual: Double, derivative: Double) -> Double {
    var slope = derivative
    if abs(slope) < 1e-14 {
      let positive = slope == 0 ? residual > 0 : slope > 0
      slope = positive ? 1e-14 : -1e-14
    }
    let step = -residual / slope
    return abs(step) > 1 ? (step > 0 ? 1 : -1) : step
  }
  /// Reduces an angle to one signed revolution remainder.
  static func wrap(_ value: Double) -> Double { value.truncatingRemainder(dividingBy: 2 * .pi) }
  /// Wraps an angle to (-π, π] with the Browser's `wrapToPi` convention.
  static func wrapToPi(_ value: Double) -> Double {
    guard value.isFinite else { return value }
    var shifted = (value + .pi).truncatingRemainder(dividingBy: 2 * .pi)
    if shifted < 0 { shifted += 2 * .pi }
    let wrapped = shifted - .pi
    return wrapped <= -.pi ? .pi : wrapped
  }
}

/// Defines the transiting planet and its fixed orbit around the scenario star.
public struct Planet: Codable, Sendable, Hashable {
  /// The circular radius (the Browser `safeBodyRadius` for an oblate body), mass, orbit, and the
  /// optional authored oblate shape. Changing the radius rescales the shape's equatorial radius.
  public var radiusMetres: Double {
    didSet { if radiusMetres != oldValue { shape?.rescale(toCircularRadius: radiusMetres) } }
  }
  public var massKilograms: Double
  public var orbit: KeplerOrbit
  public var shape: BodyShape?
  /// Creates a planet with its physical properties, orbit, and optional authored shape.
  public init(
    radiusMetres: Double, massKilograms: Double = 0, orbit: KeplerOrbit, shape: BodyShape? = nil
  ) {
    self.radiusMetres = radiusMetres
    self.massKilograms = massKilograms
    self.orbit = orbit
    self.shape = shape
  }
}

/// Defines an optional moon relative to the scenario planet.
public struct Moon: Codable, Sendable, Hashable {
  /// The circular radius; changing it rescales the shape's equatorial radius.
  public var radiusMetres: Double {
    didSet { if radiusMetres != oldValue { shape?.rescale(toCircularRadius: radiusMetres) } }
  }
  public var massKilograms: Double
  public var orbit: KeplerOrbit
  public var orientationDrift: OrbitOrientationDrift?
  /// The optional authored oblate shape; `radiusMetres` is then the Browser `safeBodyRadius`.
  public var shape: BodyShape?
  /// Creates a moon with its physical properties, relative orbit, optional orientation drift, and
  /// optional authored shape.
  public init(
    radiusMetres: Double, massKilograms: Double = 0, orbit: KeplerOrbit,
    orientationDrift: OrbitOrientationDrift? = nil, shape: BodyShape? = nil
  ) {
    self.radiusMetres = radiusMetres
    self.massKilograms = massKilograms
    self.orbit = orbit
    self.orientationDrift = orientationDrift
    self.shape = shape
  }
  /// Returns the relative orbit with any orientation drift applied at absolute scenario seconds.
  public func effectiveOrbit(atAbsoluteSeconds seconds: Double) -> KeplerOrbit {
    orientationDrift.map { $0.driftedOrbit(orbit, atAbsoluteSeconds: seconds) } ?? orbit
  }
}

/// Selects the bounded local Education model encoded by the browser V4 scenario.
public enum EducationScenarioMode: String, Codable, Sendable, Hashable {
  case generalLab = "general-lab"
  case detachedBinaryLab = "detached-binary-lab"
}

/// Controls the learner-facing gates carried by a V4 detached-binary lab scenario.
public struct BinaryLabConfiguration: Codable, Sendable, Hashable {
  public var enabled: Bool
  public var hideSkyUntilReveal: Bool
  public var requireHypothesis: Bool
  public var lockParamsUntilHypothesis: Bool
  public static let `default` = Self(
    enabled: true, hideSkyUntilReveal: true, requireHypothesis: true,
    lockParamsUntilHypothesis: true)
  /// Creates detached-binary learner gates from their V4 settings.
  public init(
    enabled: Bool, hideSkyUntilReveal: Bool, requireHypothesis: Bool,
    lockParamsUntilHypothesis: Bool
  ) {
    self.enabled = enabled
    self.hideSkyUntilReveal = hideSkyUntilReveal
    self.requireHypothesis = requireHypothesis
    self.lockParamsUntilHypothesis = lockParamsUntilHypothesis
  }
}

/// Stores one luminous component of a portable detached binary.
public struct BinaryStar: Codable, Sendable, Hashable {
  public var identifier: String
  public var star: Star
  public var luminosityScale: Double
  /// Creates a luminous binary component with its identifier and scale.
  public init(identifier: String, star: Star, luminosityScale: Double) {
    self.identifier = identifier
    self.star = star
    self.luminosityScale = luminosityScale
  }
}

/// Defines the fixed two-star relative orbit used by the local detached-binary teaching model.
public struct DetachedBinary: Codable, Sendable, Hashable {
  public var primary: BinaryStar
  public var secondary: BinaryStar
  public var relativeOrbit: KeplerOrbit
  /// Creates a detached binary from its components and relative orbit.
  public init(primary: BinaryStar, secondary: BinaryStar, relativeOrbit: KeplerOrbit) {
    self.primary = primary
    self.secondary = secondary
    self.relativeOrbit = relativeOrbit
  }
}

/// Collects the bounded physical and rendering inputs for the education simulation.
public struct EducationScenarioV4: Codable, Sendable, Hashable {
  public var mode: EducationScenarioMode
  public var identifier: String
  public var epochSeconds: Double
  public var star: Star
  public var planet: Planet
  public var moon: Moon?
  /// The authored Browser `photometry.gridRes` (nil: absent), clamped per integrator on use.
  public var gridResolution: Double?
  public var planetPhase: PhaseCurve?
  public var moonPhase: PhaseCurve?
  public var detachedBinary: DetachedBinary?
  public var binaryLab: BinaryLabConfiguration?
  public var dayNightVisibility: DayNightVisibility?
  /// Mirrors `dynamics.physicsFeatures.nonSphericalFlux`: oblate planet and moon silhouettes.
  public var nonSphericalFlux: Bool
  /// The primary star's brightness patches and, when enabled, their spot evolution.
  public var brightnessPatches: [BrightnessPatch]
  public var spotEvolution: SpotEvolution?
  /// The enabled stellar variability terms and stellar-surface sines (nil: disabled).
  public var stellarVariability: StellarVariability?
  public var stellarSurface: StellarSurfaceActivity?
  /// Creates an education scenario from its physical, photometric, and teaching inputs.
  public init(
    identifier: String = "education-default", epochSeconds: Double = 0, star: Star, planet: Planet,
    moon: Moon? = nil, gridResolution: Double? = 220, planetPhase: PhaseCurve? = nil,
    moonPhase: PhaseCurve? = nil, mode: EducationScenarioMode = .generalLab,
    detachedBinary: DetachedBinary? = nil, binaryLab: BinaryLabConfiguration? = nil,
    dayNightVisibility: DayNightVisibility? = nil, nonSphericalFlux: Bool = false,
    brightnessPatches: [BrightnessPatch] = [], spotEvolution: SpotEvolution? = nil,
    stellarVariability: StellarVariability? = nil, stellarSurface: StellarSurfaceActivity? = nil
  ) {
    self.mode = mode
    self.identifier = identifier
    self.epochSeconds = epochSeconds
    self.star = star
    self.planet = planet
    self.moon = moon
    self.gridResolution = gridResolution
    self.planetPhase = planetPhase
    self.moonPhase = moonPhase
    self.detachedBinary = detachedBinary
    self.binaryLab = binaryLab
    self.dayNightVisibility = dayNightVisibility
    self.nonSphericalFlux = nonSphericalFlux
    self.brightnessPatches = brightnessPatches
    self.spotEvolution = spotEvolution
    self.stellarVariability = stellarVariability
    self.stellarSurface = stellarSurface
  }
  /// Names the serialized scenario fields.
  private enum CodingKeys: String, CodingKey {
    case mode, identifier, epochSeconds, star, planet, moon, gridResolution, planetPhase
    case moonPhase, detachedBinary, binaryLab, dayNightVisibility, nonSphericalFlux
    case brightnessPatches, spotEvolution, stellarVariability, stellarSurface
  }
  /// Decodes a scenario, reading an absent `nonSphericalFlux` from older documents as false and
  /// absent brightness patches, spot evolution, stellar variability, and surface activity as none.
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      identifier: try container.decode(String.self, forKey: .identifier),
      epochSeconds: try container.decode(Double.self, forKey: .epochSeconds),
      star: try container.decode(Star.self, forKey: .star),
      planet: try container.decode(Planet.self, forKey: .planet),
      moon: try container.decodeIfPresent(Moon.self, forKey: .moon),
      gridResolution: try container.decodeIfPresent(Double.self, forKey: .gridResolution),
      planetPhase: try container.decodeIfPresent(PhaseCurve.self, forKey: .planetPhase),
      moonPhase: try container.decodeIfPresent(PhaseCurve.self, forKey: .moonPhase),
      mode: try container.decode(EducationScenarioMode.self, forKey: .mode),
      detachedBinary: try container.decodeIfPresent(DetachedBinary.self, forKey: .detachedBinary),
      binaryLab: try container.decodeIfPresent(BinaryLabConfiguration.self, forKey: .binaryLab),
      dayNightVisibility: try container.decodeIfPresent(
        DayNightVisibility.self, forKey: .dayNightVisibility),
      nonSphericalFlux: try container.decodeIfPresent(Bool.self, forKey: .nonSphericalFlux)
        ?? false,
      brightnessPatches: try container.decodeIfPresent(
        [BrightnessPatch].self, forKey: .brightnessPatches) ?? [],
      spotEvolution: try container.decodeIfPresent(SpotEvolution.self, forKey: .spotEvolution),
      stellarVariability: try container.decodeIfPresent(
        StellarVariability.self, forKey: .stellarVariability),
      stellarSurface: try container.decodeIfPresent(
        StellarSurfaceActivity.self, forKey: .stellarSurface))
  }
}

/// Selects the portable execution semantics encoded by the browser V4 runtime field.
public enum EducationRuntimeMode: String, Codable, Sendable, Hashable {
  case interactive = "realtime"
  case reference
}

/// Carries the bounded reference sampling configuration without changing the native scenario model.
public struct EducationRuntimeConfiguration: Sendable, Hashable {
  public static let defaultReferenceSubsteps = 5
  public static let maximumReferenceSubsteps = 25
  public let mode: EducationRuntimeMode
  public let referenceSubsteps: Int
  /// Creates runtime configuration with bounded reference sampling.
  public init(
    mode: EducationRuntimeMode = .interactive,
    referenceSubsteps: Int = Self.defaultReferenceSubsteps
  ) {
    self.mode = mode
    self.referenceSubsteps = min(max(referenceSubsteps, 1), Self.maximumReferenceSubsteps)
  }
}

/// Configures the simple reflected and thermal phase terms used by the teaching model.
public struct PhaseCurve: Codable, Sendable, Hashable {
  /// Selects the reflected-light phase weighting model.
  public enum ReflectedModel: String, Codable, Sendable, Hashable, CaseIterable {
    case lambert, cosine
  }
  /// Selects the thermal-emission phase weighting model.
  public enum ThermalModel: String, Codable, Sendable, Hashable, CaseIterable {
    case constant, lambert, cosine
  }
  public var enabled: Bool
  public var reflectedAmplitude: Double
  public var thermalAmplitude: Double
  public var lambertian: Bool
  public var reflectedOffsetRadians: Double
  public var thermalOffsetRadians: Double
  public var constantFlux: Double
  public var reflectedModel: ReflectedModel
  public var thermalModel: ThermalModel
  public var clampsWeights: Bool
  public var usesPhysicalScaling: Bool
  /// Creates a phase curve from its reflected, thermal, and weighting controls.
  public init(
    enabled: Bool, reflectedAmplitude: Double, thermalAmplitude: Double, lambertian: Bool = true,
    reflectedOffsetRadians: Double = 0, thermalOffsetRadians: Double = 0,
    constantFlux: Double = 0, reflectedModel: ReflectedModel = .lambert,
    thermalModel: ThermalModel = .constant, clampsWeights: Bool = true,
    usesPhysicalScaling: Bool = false
  ) {
    self.enabled = enabled
    self.reflectedAmplitude = reflectedAmplitude
    self.thermalAmplitude = thermalAmplitude
    self.lambertian = lambertian
    self.reflectedOffsetRadians = reflectedOffsetRadians
    self.thermalOffsetRadians = thermalOffsetRadians
    self.constantFlux = constantFlux
    self.reflectedModel = reflectedModel
    self.thermalModel = thermalModel
    self.clampsWeights = clampsWeights
    self.usesPhysicalScaling = usesPhysicalScaling
  }
}

/// Carries the V4 day-night visibility override that, when enabled, replaces both phase models.
public struct DayNightVisibility: Codable, Sendable, Hashable {
  public var enabled: Bool
  public var reflectedModel: PhaseCurve.ReflectedModel?
  public var thermalModel: PhaseCurve.ThermalModel?
  public var clamp: Bool?
  /// Creates a day-night override; absent models and clamp keep their V4 meanings.
  public init(
    enabled: Bool, reflectedModel: PhaseCurve.ReflectedModel? = nil,
    thermalModel: PhaseCurve.ThermalModel? = nil, clamp: Bool? = nil
  ) {
    self.enabled = enabled
    self.reflectedModel = reflectedModel
    self.thermalModel = thermalModel
    self.clamp = clamp
  }
}
