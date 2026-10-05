// Converts between Browser V4 envelopes and accepted native scenario models.
import Foundation

/// Converts the bounded browser V4 interchange envelope into native simulation inputs.
public enum BrowserV4Import {
  /// Reads the V4 runtime selection while preserving the native app's local execution boundary.
  public static func runtimeConfiguration(
    from dto: BrowserV4ScenarioDTO
  ) -> EducationRuntimeConfiguration {
    .init(
      mode: dto.runtime?.mode == EducationRuntimeMode.reference.rawValue
        ? .reference : .interactive,
      referenceSubsteps: dto.runtime?.referenceSubsteps
        ?? EducationRuntimeConfiguration.defaultReferenceSubsteps)
  }

  /// Converts the supported browser V4 DTO into the native model, defaulting only optional V4 fields.
  ///
  /// Documents that use Browser V4 features without a native representation throw
  /// `BrowserV4UnsupportedFeatureError` instead of being silently simplified.
  public static func scenario(from dto: BrowserV4ScenarioDTO, identifier: String) throws
    -> EducationScenarioV4
  {
    guard dto.version == "4" else {
      throw ValidationError([
        .outOfRange(field: "version", value: Double(dto.version) ?? -.infinity)
      ])
    }
    guard let mode = EducationScenarioMode(rawValue: dto.mode) else {
      throw ValidationError([.nonPositive(field: "mode")])
    }
    guard let star = dto.bodies.stars.first else {
      throw ValidationError([.nonPositive(field: "bodies.stars")])
    }
    let unsupported = BrowserV4FeatureGate.unsupportedFeatures(in: dto, mode: mode)
    guard unsupported.isEmpty else { throw BrowserV4UnsupportedFeatureError(features: unsupported) }
    let limb = limbDarkening(dto.photometry?.limbDarkeningModel, star: star)
    if mode == .detachedBinaryLab {
      return try detachedBinaryScenario(
        dto, identifier: identifier, star: star, limb: limb)
    }
    guard let planet = dto.bodies.planets.first else {
      throw ValidationError([.nonPositive(field: "bodies.planets")])
    }
    let scenario = EducationScenarioV4(
      identifier: identifier,
      star: .init(
        radiusMetres: star.r, massKilograms: star.m ?? 0, limbDarkeningU1: limb.u1,
        limbDarkeningU2: limb.u2),
      planet: .init(
        radiusMetres: planet.r, massKilograms: planet.m ?? 0, orbit: orbit(planet.orbit)),
      moon: dto.bodies.moons.first.map {
        .init(radiusMetres: $0.r, massKilograms: $0.m ?? 0, orbit: orbit($0.orbit))
      },
      gridResolution: dto.photometry?.gridRes ?? defaultGridResolution,
      planetPhase: phase(dto.photometry?.phaseCurve),
      moonPhase: phase(dto.photometry?.moonPhaseCurve),
      dayNightVisibility: dayNight(dto.photometry?.dayNightVisibility))
    return try validated(scenario)
  }

  /// Matches the Browser limb-darkened integrator's grid fallback when `gridRes` is absent.
  static let defaultGridResolution = 60

  /// Resolves a star's quadratic law as the Browser does; absent or empty models are uniform disks.
  static func limbDarkening(
    _ model: BrowserV4ScenarioDTO.LimbDarkeningModelDTO?, star: BrowserV4ScenarioDTO.StarDTO
  ) -> (u1: Double, u2: Double) {
    switch BrowserV4LimbDarkeningLaw.resolve(model, star: star) {
    case .quadratic(let u1, let u2): (u1, u2)
    case .uniform, .unsupported: (0, 0)
    }
  }

  /// Converts V4 orbit fields to the native SI orbit representation.
  static func orbit(_ value: BrowserV4ScenarioDTO.OrbitDTO) -> KeplerOrbit {
    .init(
      semiMajorAxisMetres: value.a, periodSeconds: value.period, eccentricity: value.e,
      inclinationRadians: value.inc, argumentOfPeriapsisRadians: value.omega,
      meanAnomalyAtEpochRadians: -2 * .pi * value.t0 / value.period)
  }

  /// Converts optional V4 phase parameters with the Browser defaults for absent fields.
  ///
  /// Absent `physicalScaling` means scaled amplitudes and absent `thermalModel` means cosine, as
  /// in the Browser `normalizePhaseCurveModel`.
  static func phase(_ value: BrowserV4ScenarioDTO.PhaseCurveDTO?) -> PhaseCurve? {
    value.map {
      .init(
        enabled: $0.enabled ?? false, reflectedAmplitude: $0.reflAmp ?? 0,
        thermalAmplitude: $0.thermAmp ?? 0, lambertian: $0.lambertian ?? false,
        reflectedOffsetRadians: $0.reflOffset ?? 0, thermalOffsetRadians: $0.thermOffset ?? 0,
        constantFlux: $0.constant ?? 0,
        reflectedModel: PhaseCurve.ReflectedModel(rawValue: $0.reflModel ?? "")
          ?? (($0.lambertian ?? false) ? .lambert : .cosine),
        thermalModel: PhaseCurve.ThermalModel(rawValue: $0.thermalModel ?? "") ?? .cosine,
        clampsWeights: $0.clamp ?? true, usesPhysicalScaling: $0.physicalScaling ?? true)
    }
  }

  /// Converts the V4 day-night visibility override without resolving its absent fields.
  static func dayNight(_ value: BrowserV4ScenarioDTO.DayNightVisibilityDTO?) -> DayNightVisibility?
  {
    value.map {
      .init(
        enabled: $0.enabled ?? false,
        reflectedModel: $0.reflectedModel.flatMap(PhaseCurve.ReflectedModel.init(rawValue:)),
        thermalModel: $0.thermalModel.flatMap(PhaseCurve.ThermalModel.init(rawValue:)),
        clamp: $0.clamp)
    }
  }

  /// Converts the detached-binary V4 branch without allowing general-lab defaults to leak in.
  ///
  /// Absent masses stay zero (the Browser then keeps the primary fixed), absent luminosity scales
  /// use the Browser fallbacks 1 and 0.3, and an absent `binaryLab` uses the default gates.
  static func detachedBinaryScenario(
    _ dto: BrowserV4ScenarioDTO, identifier: String, star: BrowserV4ScenarioDTO.StarDTO,
    limb: (u1: Double, u2: Double)
  ) throws -> EducationScenarioV4 {
    guard let secondary = dto.bodies.stars.dropFirst().first,
      let binaryOrbit = dto.orbits?.binary
    else {
      throw ValidationError([.nonPositive(field: "bodies.stars/orbits.binary")])
    }
    let binaryLab = dto.binaryLab.map {
      BinaryLabConfiguration(
        enabled: $0.enabled, hideSkyUntilReveal: $0.hideSkyUntilReveal,
        requireHypothesis: $0.requireHypothesis,
        lockParamsUntilHypothesis: $0.lockParamsUntilHypothesis)
    }
    let primary = BinaryStar(
      identifier: star.id,
      star: .init(
        radiusMetres: star.r, massKilograms: star.m ?? 0, limbDarkeningU1: limb.u1,
        limbDarkeningU2: limb.u2), luminosityScale: star.luminosityScale ?? 1)
    let companion = BinaryStar(
      identifier: secondary.id,
      star: .init(
        radiusMetres: secondary.r, massKilograms: secondary.m ?? 0,
        limbDarkeningU1: limb.u1, limbDarkeningU2: limb.u2),
      luminosityScale: secondary.luminosityScale ?? 0.3)
    let scenario = EducationScenarioV4(
      identifier: identifier, star: primary.star,
      planet: .init(radiusMetres: 1, orbit: orbit(binaryOrbit)),
      gridResolution: dto.photometry?.gridRes ?? defaultGridResolution, mode: .detachedBinaryLab,
      detachedBinary: .init(
        primary: primary, secondary: companion, relativeOrbit: orbit(binaryOrbit)),
      binaryLab: binaryLab ?? .default)
    return try validated(scenario)
  }

  /// Throws every ordered model validation issue before a decoded scenario can replace state.
  static func validated(_ scenario: EducationScenarioV4) throws -> EducationScenarioV4 {
    let issues = SimulationEngine.validate(scenario)
    guard issues.isEmpty else { throw ValidationError(issues) }
    return scenario
  }
}

/// Encodes native scenarios into the browser V4 envelope for parity-sensitive consumers.
public enum BrowserV4Export {
  /// Encodes the currently accepted native Education scenario as a canonical browser V4 envelope.
  public static func scenario(
    from scenario: EducationScenarioV4, lessonID: String? = nil,
    runtime: EducationRuntimeConfiguration = .init()
  ) -> BrowserV4ScenarioDTO {
    if let binary = scenario.detachedBinary {
      return detachedBinaryDTO(binary, scenario: scenario, lessonID: lessonID, runtime: runtime)
    }
    let planetOrbit = orbit(scenario.planet.orbit)
    var hierarchy = [
      BrowserV4ScenarioDTO.HierarchyDTO(
        childId: "planet-1", parentId: "star-a", relation: "orbits")
    ]
    if scenario.moon != nil {
      hierarchy.append(.init(childId: "moon-1", parentId: "planet-1", relation: "orbits"))
    }
    return BrowserV4ScenarioDTO(
      version: "4", mode: "general-lab", runtime: runtimeDTO(runtime),
      observer: .init(dir: .init(x: 0, y: 0, z: 1)),
      bodies: .init(
        stars: [
          .init(
            id: "star-a", r: scenario.star.radiusMetres, m: scenario.star.massKilograms,
            luminosityScale: 1),
          .init(id: "star-b", r: scenario.star.radiusMetres, m: 0, luminosityScale: 0),
        ],
        planets: [
          .init(
            id: "planet-1", r: scenario.planet.radiusMetres, m: scenario.planet.massKilograms,
            orbit: planetOrbit, parentStarId: "star-a", parentSystem: "star")
        ],
        moons: scenario.moon.map {
          [
            .init(
              id: "moon-1", r: $0.radiusMetres, m: $0.massKilograms,
              orbit: orbit($0.orbit), parentPlanetId: "planet-1")
          ]
        } ?? []),
      orbits: .init(binary: planetOrbit, hierarchy: hierarchy),
      photometry: .init(
        gridRes: scenario.gridResolution,
        limbDarkeningModel: .init(
          default: .init(
            kind: "quadratic", u1: scenario.star.limbDarkeningU1,
            u2: scenario.star.limbDarkeningU2)),
        phaseCurve: phase(scenario.planetPhase), moonPhaseCurve: phase(scenario.moonPhase),
        dayNightVisibility: scenario.dayNightVisibility.map {
          .init(
            enabled: $0.enabled, reflectedModel: $0.reflectedModel?.rawValue,
            thermalModel: $0.thermalModel?.rawValue, clamp: $0.clamp)
        }),
      didactics: .init(activeLessonId: lessonID), binaryLab: nil)
  }

  /// Converts native orbital elements while retaining V4's serialized field names.
  static func orbit(_ value: KeplerOrbit) -> BrowserV4ScenarioDTO.OrbitDTO {
    .init(
      a: value.semiMajorAxisMetres, e: value.eccentricity, inc: value.inclinationRadians,
      longitudeOfAscendingNode: 0, omega: value.argumentOfPeriapsisRadians,
      period: value.periodSeconds,
      t0: -value.meanAnomalyAtEpochRadians * value.periodSeconds / (2 * .pi))
  }

  /// Converts an optional native phase curve without changing absent-curve semantics.
  static func phase(_ value: PhaseCurve?) -> BrowserV4ScenarioDTO.PhaseCurveDTO? {
    value.map {
      .init(
        enabled: $0.enabled, reflAmp: $0.reflectedAmplitude, thermAmp: $0.thermalAmplitude,
        reflOffset: $0.reflectedOffsetRadians, thermOffset: $0.thermalOffsetRadians,
        constant: $0.constantFlux, reflModel: $0.reflectedModel.rawValue,
        thermalModel: $0.thermalModel.rawValue, lambertian: $0.lambertian,
        clamp: $0.clampsWeights, physicalScaling: $0.usesPhysicalScaling)
    }
  }

  /// Encodes a detached binary without manufacturing general-lab planets or moons.
  static func detachedBinaryDTO(
    _ binary: DetachedBinary, scenario: EducationScenarioV4, lessonID: String?,
    runtime: EducationRuntimeConfiguration
  ) -> BrowserV4ScenarioDTO {
    BrowserV4ScenarioDTO(
      version: "4", mode: EducationScenarioMode.detachedBinaryLab.rawValue,
      runtime: runtimeDTO(runtime), observer: .init(dir: .init(x: 0, y: 0, z: 1)),
      bodies: .init(
        stars: [
          .init(
            id: binary.primary.identifier, r: binary.primary.star.radiusMetres,
            m: binary.primary.star.massKilograms, luminosityScale: binary.primary.luminosityScale),
          .init(
            id: binary.secondary.identifier, r: binary.secondary.star.radiusMetres,
            m: binary.secondary.star.massKilograms,
            luminosityScale: binary.secondary.luminosityScale),
        ], planets: [], moons: []),
      orbits: .init(binary: orbit(binary.relativeOrbit), hierarchy: []),
      photometry: .init(
        gridRes: scenario.gridResolution,
        limbDarkeningModel: .init(
          default: .init(
            kind: "quadratic", u1: binary.primary.star.limbDarkeningU1,
            u2: binary.primary.star.limbDarkeningU2)),
        phaseCurve: nil, moonPhaseCurve: nil),
      didactics: .init(activeLessonId: lessonID),
      binaryLab: .init(
        enabled: scenario.binaryLab?.enabled ?? true,
        hideSkyUntilReveal: scenario.binaryLab?.hideSkyUntilReveal ?? true,
        requireHypothesis: scenario.binaryLab?.requireHypothesis ?? true,
        lockParamsUntilHypothesis: scenario.binaryLab?.lockParamsUntilHypothesis ?? true))
  }

  /// Projects native runtime settings to the Browser V4 metadata envelope.
  static func runtimeDTO(_ runtime: EducationRuntimeConfiguration)
    -> BrowserV4ScenarioDTO.RuntimeDTO
  {
    .init(
      mode: runtime.mode.rawValue, executionMode: "interactive",
      referenceSubsteps: runtime.referenceSubsteps)
  }
}
