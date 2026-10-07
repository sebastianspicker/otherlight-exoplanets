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
    let photometry = dto.photometry
    let scenario = EducationScenarioV4(
      identifier: identifier,
      star: Star(
        radiusMetres: star.r, massKilograms: star.m ?? 0, limbDarkeningU1: limb.u1,
        limbDarkeningU2: limb.u2, limbDarkeningLawPresent: limb.present,
        spin: stellarSpin(star.spin)),
      planet: self.planet(planet), moon: dto.bodies.moons.first.map { moon($0, dto: dto) },
      gridResolution: photometry?.gridRes, planetPhase: phase(photometry?.phaseCurve),
      moonPhase: phase(photometry?.moonPhaseCurve),
      dayNightVisibility: dayNight(photometry?.dayNightVisibility),
      nonSphericalFlux: nonSphericalFlux(dto),
      brightnessPatches: brightnessPatches(photometry?.brightnessPatches),
      spotEvolution: spotEvolution(photometry?.spotEvolution),
      stellarVariability: stellarVariability(photometry?.stellarVariability),
      stellarSurface: stellarSurface(photometry?.stellarSurface))
    return try validated(scenario)
  }

  /// Converts the first V4 planet with its authored shape and `safeBodyRadius`.
  static func planet(_ value: BrowserV4ScenarioDTO.PlanetDTO) -> Planet {
    let shape = bodyShape(value.shape, radius: value.r)
    return Planet(
      radiusMetres: shape?.circularRadiusMetres ?? value.r, massKilograms: value.m ?? 0,
      orbit: orbit(value.orbit), shape: shape)
  }

  /// Converts the first V4 moon with its authored shape, `safeBodyRadius`, and orientation drift.
  static func moon(_ value: BrowserV4ScenarioDTO.MoonDTO, dto: BrowserV4ScenarioDTO) -> Moon {
    let shape = bodyShape(value.shape, radius: value.r)
    return Moon(
      radiusMetres: shape?.circularRadiusMetres ?? value.r, massKilograms: value.m ?? 0,
      orbit: orbit(value.orbit),
      orientationDrift: moonOrientationDrift(dto.dynamics?["exomoonTimingShape"]), shape: shape)
  }

  /// Reads the `dynamics.physicsFeatures.nonSphericalFlux` switch.
  static func nonSphericalFlux(_ dto: BrowserV4ScenarioDTO) -> Bool {
    dto.dynamics?["physicsFeatures"]?["nonSphericalFlux"] == .bool(true)
  }

  /// Reads `photometry.brightnessPatches` as the Browser `sanitizeBrightnessPatches` does.
  ///
  /// Entries without a `circle` or `ellipse` shape, with a non-finite centre or factor, or with a
  /// non-positive radius are dropped silently, factors are clamped at 0, and an absent or
  /// non-finite ellipse angle is 0.
  static func brightnessPatches(_ value: BrowserV4JSONValue?) -> [BrightnessPatch] {
    guard case .array(let entries)? = value else { return [] }
    return entries.compactMap { entry in
      guard let x = entry["x"]?.finiteNumber, let y = entry["y"]?.finiteNumber,
        let factor = entry["factor"]?.finiteNumber, let shape = patchShape(entry)
      else { return nil }
      return BrightnessPatch(shape: shape, x: x, y: y, factor: max(0, factor))
    }
  }

  /// Reads a patch's `circle` or `ellipse` outline, or nil for another shape or a bad radius.
  static func patchShape(_ entry: BrowserV4JSONValue) -> BrightnessPatch.Shape? {
    switch entry["shape"] {
    case .string("circle"):
      guard let r = entry["r"]?.finiteNumber, r > 0 else { return nil }
      return .circle(radius: r)
    case .string("ellipse"):
      guard let rx = entry["rx"]?.finiteNumber, rx > 0, let ry = entry["ry"]?.finiteNumber,
        ry > 0
      else { return nil }
      return .ellipse(rx: rx, ry: ry, angleRadians: entry["angle"]?.finiteNumber ?? 0)
    default: return nil
    }
  }

  /// Reads an enabled `photometry.spotEvolution` block with the Browser `evolutionState` defaults.
  ///
  /// A disabled or absent block yields nil. Non-positive periods and lifetimes mean no rotation or
  /// decay, absent phases, drifts, and `tRef` are 0, and coverage defaults to 1 within [0, 1].
  static func spotEvolution(_ value: BrowserV4JSONValue?) -> SpotEvolution? {
    guard let value, value.isEnabled else { return nil }
    /// Returns a finite positive member, or nil.
    func positive(_ key: String) -> Double? {
      value[key]?.finiteNumber.flatMap { $0 > 0 ? $0 : nil }
    }
    return SpotEvolution(
      rotationPeriodSeconds: positive("rotationPeriodSec"),
      rotationPhase0Radians: value["rotationPhase0"]?.finiteNumber ?? 0,
      driftRateRadiansPerSecond: value["driftRateRadPerSec"]?.finiteNumber ?? 0,
      lifetimeSeconds: positive("lifetimeSec"),
      coverage: min(1, max(0, value["coverage"]?.finiteNumber ?? 1)),
      referenceEpochSeconds: value["tRef"]?.finiteNumber ?? 0)
  }

  /// Reads a gate-accepted planet or moon `shape` object with the authored radius as its
  /// equatorial radius; an absent angle is 0.
  ///
  /// Null, empty, and oblateness-free shapes have no effect in the Browser and import as nil.
  static func bodyShape(_ value: BrowserV4JSONValue?, radius: Double) -> BodyShape? {
    guard case .number(let oblateness)? = value?["oblateness"] else { return nil }
    guard case .number(let angle)? = value?["angle"] else {
      return BodyShape(oblateness: oblateness, equatorialRadiusMetres: radius)
    }
    return BodyShape(oblateness: oblateness, angleRadians: angle, equatorialRadiusMetres: radius)
  }

  /// Resolves a star's quadratic law as the Browser does; absent or empty models are uniform disks,
  /// which carry zero coefficients and no law.
  static func limbDarkening(
    _ model: BrowserV4ScenarioDTO.LimbDarkeningModelDTO?, star: BrowserV4ScenarioDTO.StarDTO
  ) -> (u1: Double, u2: Double, present: Bool) {
    switch BrowserV4LimbDarkeningLaw.resolve(model, star: star) {
    case .quadratic(let u1, let u2): (u1, u2, true)
    case .uniform: (0, 0, false)
    case .unsupported: (0, 0, true)
    }
  }

  /// Converts V4 orbit fields to the native SI orbit representation.
  static func orbit(_ value: BrowserV4ScenarioDTO.OrbitDTO) -> KeplerOrbit {
    .init(
      semiMajorAxisMetres: value.a, periodSeconds: value.period, eccentricity: value.e,
      inclinationRadians: value.inc, argumentOfPeriapsisRadians: value.omega,
      meanAnomalyAtEpochRadians: -2 * .pi * value.t0 / value.period,
      longitudeOfAscendingNodeRadians: value.longitudeOfAscendingNode)
  }

  /// Reads the moon orientation drift of an enabled `dynamics.exomoonTimingShape` block.
  ///
  /// As the Browser `effectiveMoonOrbit`, a disabled or absent block and a block without a finite
  /// non-zero rate or a finite override yield no drift; an absent or non-finite `tRef` is 0.
  static func moonOrientationDrift(_ shape: BrowserV4JSONValue?) -> OrbitOrientationDrift? {
    guard let shape, shape.isEnabled else { return nil }
    /// Reads a finite numeric member of the block, or nil when absent or non-finite.
    func number(_ key: String) -> Double? {
      if case .number(let value) = shape[key], value.isFinite { return value }
      return nil
    }
    let drift = OrbitOrientationDrift(
      omegaDotRadiansPerSecond: number("moonOmegaDot") ?? 0,
      inclinationDotRadiansPerSecond: number("moonIncDot") ?? 0,
      argumentOfPeriapsisDotRadiansPerSecond: number("moonOmegaSmallDot") ?? 0,
      longitudeOfAscendingNodeOverrideRadians: number("moonOmega0"),
      inclinationOverrideRadians: number("moonInc0"),
      argumentOfPeriapsisOverrideRadians: number("moonOmegaSmall0"),
      referenceEpochSeconds: number("tRef") ?? 0)
    return drift.hasDrift ? drift : nil
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
    limb: (u1: Double, u2: Double, present: Bool)
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
      star: Star(
        radiusMetres: star.r, massKilograms: star.m ?? 0, limbDarkeningU1: limb.u1,
        limbDarkeningU2: limb.u2, limbDarkeningLawPresent: limb.present),
      luminosityScale: star.luminosityScale ?? 1)
    let companion = BinaryStar(
      identifier: secondary.id,
      star: Star(
        radiusMetres: secondary.r, massKilograms: secondary.m ?? 0,
        limbDarkeningU1: limb.u1, limbDarkeningU2: limb.u2, limbDarkeningLawPresent: limb.present),
      luminosityScale: secondary.luminosityScale ?? 0.3)
    let scenario = EducationScenarioV4(
      identifier: identifier, star: primary.star,
      planet: Planet(radiusMetres: 1, orbit: orbit(binaryOrbit)),
      gridResolution: dto.photometry?.gridRes, mode: .detachedBinaryLab,
      detachedBinary: DetachedBinary(
        primary: primary, secondary: companion, relativeOrbit: orbit(binaryOrbit)),
      binaryLab: binaryLab ?? .default, nonSphericalFlux: nonSphericalFlux(dto))
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
            luminosityScale: 1, spin: scenario.star.spin.flatMap(stellarSpin)),
          .init(id: "star-b", r: scenario.star.radiusMetres, m: 0, luminosityScale: 0),
        ],
        planets: [
          .init(
            id: "planet-1",
            r: scenario.planet.shape?.equatorialRadiusMetres ?? scenario.planet.radiusMetres,
            m: scenario.planet.massKilograms, orbit: planetOrbit, parentStarId: "star-a",
            parentSystem: "star", shape: shape(scenario.planet.shape))
        ],
        moons: scenario.moon.map {
          [
            .init(
              id: "moon-1", r: $0.shape?.equatorialRadiusMetres ?? $0.radiusMetres,
              m: $0.massKilograms,
              orbit: orbit($0.orbit), parentPlanetId: "planet-1", shape: shape($0.shape))
          ]
        } ?? []),
      orbits: .init(binary: planetOrbit, hierarchy: hierarchy),
      photometry: .init(
        gridRes: scenario.gridResolution, limbDarkeningModel: limbDarkeningModel(scenario.star),
        phaseCurve: phase(scenario.planetPhase), moonPhaseCurve: phase(scenario.moonPhase),
        dayNightVisibility: scenario.dayNightVisibility.map {
          .init(
            enabled: $0.enabled, reflectedModel: $0.reflectedModel?.rawValue,
            thermalModel: $0.thermalModel?.rawValue, clamp: $0.clamp)
        }, brightnessPatches: brightnessPatches(scenario.brightnessPatches),
        stellarVariability: scenario.stellarVariability.map(stellarVariability),
        spotEvolution: scenario.spotEvolution.map(spotEvolution),
        stellarSurface: scenario.stellarSurface.map(stellarSurface)),
      didactics: .init(activeLessonId: lessonID), binaryLab: nil,
      dynamics: dynamics(scenario))
  }

  /// Encodes the primary star's patches as `photometry.brightnessPatches`, or nil without any.
  static func brightnessPatches(_ patches: [BrightnessPatch]) -> BrowserV4JSONValue? {
    guard !patches.isEmpty else { return nil }
    return .array(
      patches.map { patch in
        var members: [String: BrowserV4JSONValue] = [
          "x": .number(patch.x), "y": .number(patch.y), "factor": .number(patch.factor),
        ]
        switch patch.shape {
        case .circle(let radius):
          members["shape"] = .string("circle")
          members["r"] = .number(radius)
        case .ellipse(let rx, let ry, let angle):
          members["shape"] = .string("ellipse")
          members["rx"] = .number(rx)
          members["ry"] = .number(ry)
          members["angle"] = .number(angle)
        }
        return .object(members)
      })
  }

  /// Encodes a spot evolution as an enabled `photometry.spotEvolution` block.
  static func spotEvolution(_ spot: SpotEvolution) -> BrowserV4JSONValue {
    var members: [String: BrowserV4JSONValue] = [
      "enabled": .bool(true), "rotationPhase0": .number(spot.rotationPhase0Radians),
      "driftRateRadPerSec": .number(spot.driftRateRadiansPerSecond),
      "coverage": .number(spot.coverage), "tRef": .number(spot.referenceEpochSeconds),
    ]
    if let period = spot.rotationPeriodSeconds { members["rotationPeriodSec"] = .number(period) }
    if let lifetime = spot.lifetimeSeconds { members["lifetimeSec"] = .number(lifetime) }
    return .object(members)
  }

  /// Encodes a star's quadratic law as the default `limbDarkeningModel`, or no model for a star
  /// without a law, which the Browser then renders as a uniform disk.
  static func limbDarkeningModel(_ star: Star) -> BrowserV4ScenarioDTO.LimbDarkeningModelDTO? {
    guard star.limbDarkeningLawPresent else { return nil }
    return .init(
      default: .init(kind: "quadratic", u1: star.limbDarkeningU1, u2: star.limbDarkeningU2))
  }

  /// Encodes an authored body shape as the Browser `shape` object.
  static func shape(_ value: BodyShape?) -> BrowserV4JSONValue? {
    value.map {
      .object(["oblateness": .number($0.oblateness), "angle": .number($0.angleRadians)])
    }
  }

  /// Merges the moon drift block and the `physicsFeatures.nonSphericalFlux` switch into `dynamics`.
  static func dynamics(_ scenario: EducationScenarioV4) -> BrowserV4JSONValue? {
    var members: [String: BrowserV4JSONValue] = [:]
    if case .object(let drift)? = scenario.moon?.orientationDrift.flatMap(dynamics) {
      members.merge(drift) { _, new in new }
    }
    if scenario.nonSphericalFlux {
      members["physicsFeatures"] = .object(["nonSphericalFlux": .bool(true)])
    }
    return members.isEmpty ? nil : .object(members)
  }

  /// Encodes a moon orientation drift as an enabled `dynamics.exomoonTimingShape` block.
  ///
  /// Non-finite rates and epochs are written as 0 and non-finite overrides are omitted, which keeps
  /// the JSON valid without changing the drift the Browser evaluates.
  static func dynamics(_ drift: OrbitOrientationDrift) -> BrowserV4JSONValue? {
    guard drift.hasDrift else { return nil }
    /// Returns a finite value unchanged and replaces a non-finite one with 0.
    func finite(_ value: Double) -> BrowserV4JSONValue { .number(value.isFinite ? value : 0) }
    var shape: [String: BrowserV4JSONValue] = [
      "enabled": .bool(true), "velDt": .number(2),
      "moonOmegaDot": finite(drift.omegaDotRadiansPerSecond),
      "moonIncDot": finite(drift.inclinationDotRadiansPerSecond),
      "moonOmegaSmallDot": finite(drift.argumentOfPeriapsisDotRadiansPerSecond),
      "tRef": finite(drift.referenceEpochSeconds),
    ]
    let overrides = [
      ("moonOmega0", drift.longitudeOfAscendingNodeOverrideRadians),
      ("moonInc0", drift.inclinationOverrideRadians),
      ("moonOmegaSmall0", drift.argumentOfPeriapsisOverrideRadians),
    ]
    for (key, value) in overrides {
      if let value, value.isFinite { shape[key] = .number(value) }
    }
    return .object(["exomoonTimingShape": .object(shape)])
  }

  /// Converts native orbital elements while retaining V4's serialized field names.
  static func orbit(_ value: KeplerOrbit) -> BrowserV4ScenarioDTO.OrbitDTO {
    .init(
      a: value.semiMajorAxisMetres, e: value.eccentricity, inc: value.inclinationRadians,
      longitudeOfAscendingNode: value.longitudeOfAscendingNodeRadians,
      omega: value.argumentOfPeriapsisRadians,
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
        limbDarkeningModel: limbDarkeningModel(binary.primary.star), phaseCurve: nil,
        moonPhaseCurve: nil),
      didactics: .init(activeLessonId: lessonID),
      binaryLab: .init(
        enabled: scenario.binaryLab?.enabled ?? true,
        hideSkyUntilReveal: scenario.binaryLab?.hideSkyUntilReveal ?? true,
        requireHypothesis: scenario.binaryLab?.requireHypothesis ?? true,
        lockParamsUntilHypothesis: scenario.binaryLab?.lockParamsUntilHypothesis ?? true),
      dynamics: dynamics(scenario))
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
