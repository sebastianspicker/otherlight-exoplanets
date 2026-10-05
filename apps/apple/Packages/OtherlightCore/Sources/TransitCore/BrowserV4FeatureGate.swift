// Detects Browser V4 content that the native Education model cannot represent faithfully.
import Foundation

/// Names every Browser V4 feature in a document that the native Education model cannot represent.
public struct BrowserV4UnsupportedFeatureError: LocalizedError, Sendable, Hashable {
  public let features: [String]
  /// Creates an error naming the unsupported features in document order.
  public init(features: [String]) { self.features = features }
  /// Lists the unsupported features so the learner knows why the document was not opened.
  public var errorDescription: String? {
    "The scenario uses Browser features the native app does not support: "
      + features.joined(separator: ", ") + "."
  }
}

/// Resolves a star's limb-darkening law with the Browser's band, default, and stellar order.
enum BrowserV4LimbDarkeningLaw: Equatable {
  case uniform
  case quadratic(u1: Double, u2: Double)
  case unsupported

  /// Selects `bands[star passband ?? model bandpass]`, then `default`. With neither, the Browser
  /// derives a toy law from stellar parameters when the model carries a `stellar` object or the
  /// star has Teff, log g, or [Fe/H] (unsupported here); otherwise it renders a uniform disk, as
  /// does an absent model. Non-quadratic laws are unsupported.
  static func resolve(
    _ model: BrowserV4ScenarioDTO.LimbDarkeningModelDTO?, star: BrowserV4ScenarioDTO.StarDTO
  ) -> Self {
    guard let model else { return .uniform }
    if let law = bandLaw(model.bands, bandpass: star.passband ?? model.bandpass) { return law }
    // The Browser treats a default without a string `kind` as no law at all.
    if let law = model.default, let kind = law.kind {
      return quadratic(
        kind: .string(kind), u1: law.u1.map(BrowserV4JSONValue.number),
        u2: law.u2.map(BrowserV4JSONValue.number))
    }
    return derivesFromStellarParameters(model, star: star) ? .unsupported : .uniform
  }

  /// Looks a band up as the Browser's `findBandLaw` does: the raw key, its trimmed lower-cased
  /// form, then a case-insensitive key scan; entries without a string `kind` are skipped.
  private static func bandLaw(_ bands: BrowserV4JSONValue?, bandpass: String?) -> Self? {
    guard case .object(let entries)? = bands, let bandpass else { return nil }
    let normalized = bandpass.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    var keys = [bandpass]
    if !normalized.isEmpty {
      if normalized != bandpass { keys.append(normalized) }
      keys += entries.keys.sorted().filter {
        $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == normalized
      }
    }
    for key in keys {
      guard case .object(let law)? = entries[key], case .string? = law["kind"] else { continue }
      return quadratic(kind: law["kind"], u1: law["u1"], u2: law["u2"])
    }
    return nil
  }

  /// Mirrors the Browser's fallback: any `stellar` object or star-level stellar parameter derives.
  private static func derivesFromStellarParameters(
    _ model: BrowserV4ScenarioDTO.LimbDarkeningModelDTO, star: BrowserV4ScenarioDTO.StarDTO
  ) -> Bool {
    if case .object? = model.stellar { return true }
    return star.teffK != nil || star.loggCgs != nil || star.metallicityDex != nil
  }

  /// Accepts only a complete quadratic law whose kind is `quadratic`.
  private static func quadratic(
    kind: BrowserV4JSONValue?, u1: BrowserV4JSONValue?, u2: BrowserV4JSONValue?
  ) -> Self {
    guard kind == .string("quadratic"), case .number(let first)? = u1,
      case .number(let second)? = u2
    else { return .unsupported }
    return .quadratic(u1: first, u2: second)
  }
}

/// Detects Browser V4 content that would change Browser output but has no native representation.
enum BrowserV4FeatureGate {
  /// Returns the unsupported features of a document; an empty result means a lossless import.
  static func unsupportedFeatures(in dto: BrowserV4ScenarioDTO, mode: EducationScenarioMode)
    -> [String]
  {
    var features = contextFeatures(dto)
    features += bodyExtensionFeatures(dto.bodies)
    features +=
      mode == .detachedBinaryLab
      ? binaryFeatures(dto.bodies) : generalLabFeatures(dto.bodies)
    features += limbDarkeningFeatures(dto, mode: mode)
    features += photometryFeatures(dto.photometry)
    features += phaseFeatures(dto.photometry)
    return features
  }

  /// Rejects scientific execution, a tilted observer, node rotations, and N-body or GR dynamics.
  private static func contextFeatures(_ dto: BrowserV4ScenarioDTO) -> [String] {
    var features: [String] = []
    if dto.runtime?.executionMode == "scientific-browser" {
      features.append("runtime.executionMode scientific-browser")
    }
    if let dir = dto.observer?.dir, dir != Vector3(x: 0, y: 0, z: 1) {
      features.append("observer.dir other than (0, 0, 1)")
    }
    let orbits =
      dto.bodies.planets.map(\.orbit) + dto.bodies.moons.map(\.orbit)
      + (dto.orbits.map { [$0.binary] } ?? [])
    if orbits.contains(where: { $0.longitudeOfAscendingNode != 0 }) {
      features.append("orbit Omega other than 0")
    }
    for key in ["nbodyPlanetMoon", "relativity"] where dto.dynamics?[key]?.isEnabled == true {
      features.append("dynamics.\(key)")
    }
    return features
  }

  /// Rejects body shapes, rings, spin, gravity harmonics, tides, and physical stellar photometry.
  private static func bodyExtensionFeatures(_ bodies: BrowserV4ScenarioDTO.BodiesDTO) -> [String] {
    var features: [String] = []
    if bodies.stars.count > 2 { features.append("more than two stars") }
    let extras: [(String, [BrowserV4JSONValue?])] =
      bodies.stars.map { ($0.id, [$0.shape, $0.rings, $0.spin, $0.gravityHarmonics, $0.tides]) }
      + bodies.planets.map { ($0.id, [$0.shape, $0.rings, $0.spin, $0.gravityHarmonics, $0.tides]) }
      + bodies.moons.map { ($0.id, [$0.shape, $0.rings, $0.spin, $0.gravityHarmonics, $0.tides]) }
    for (id, values) in extras where values.contains(where: { $0?.hasContent == true }) {
      features.append("body \(id) shape, rings, spin, gravity harmonics, or tides")
    }
    if bodies.stars.contains(where: {
      $0.teffK != nil || $0.loggCgs != nil || $0.metallicityDex != nil
    }) {
      features.append("physical stellar photometry (teffK, loggCgs, metallicityDex)")
    }
    return features
  }

  /// Rejects planets and moons in the detached-binary lab.
  private static func binaryFeatures(_ bodies: BrowserV4ScenarioDTO.BodiesDTO) -> [String] {
    bodies.planets.isEmpty && bodies.moons.isEmpty
      ? [] : ["planets or moons in the detached-binary lab"]
  }

  /// Rejects general-lab structures beyond one star-hosted planet with at most one moon.
  private static func generalLabFeatures(_ bodies: BrowserV4ScenarioDTO.BodiesDTO) -> [String] {
    var features: [String] = []
    if bodies.planets.count > 1 { features.append("more than one planet") }
    if bodies.moons.count > 1 { features.append("more than one moon") }
    if (bodies.stars.first?.luminosityScale ?? 1) != 1 {
      features.append("primary star luminosityScale other than 1")
    }
    if let companion = bodies.stars.dropFirst().first,
      (companion.luminosityScale ?? 0) != 0 || (companion.m ?? 0) != 0
    {
      features.append("luminous or massive second star in the general lab")
    }
    guard let planet = bodies.planets.first else { return features }
    if planet.parentSystem == "circumbinary" { features.append("circumbinary planet") }
    if let parent = planet.parentStarId, parent != bodies.stars.first?.id {
      features.append("planet orbiting the second star")
    }
    if let moon = bodies.moons.first, moon.parentPlanetId != planet.id {
      features.append("moon without the planet as parent")
    }
    return features
  }

  /// Requires one resolvable quadratic law per luminous star and no coefficient constraints.
  private static func limbDarkeningFeatures(
    _ dto: BrowserV4ScenarioDTO, mode: EducationScenarioMode
  ) -> [String] {
    let model = dto.photometry?.limbDarkeningModel
    let stars = Array(dto.bodies.stars.prefix(mode == .detachedBinaryLab ? 2 : 1))
    let laws = stars.map { BrowserV4LimbDarkeningLaw.resolve(model, star: $0) }
    var features: [String] = []
    if laws.contains(.unsupported) {
      features.append(
        "limb-darkening law other than a complete quadratic default or band, or stellar-derived")
    }
    if Set(laws.map { "\($0)" }).count > 1 { features.append("per-star limb-darkening laws") }
    if model?.constraints?.hasContent == true { features.append("limb-darkening constraints") }
    return features
  }

  /// Rejects enabled photometry surfaces that the native kernel does not evaluate.
  private static func photometryFeatures(_ photometry: BrowserV4ScenarioDTO.PhotometryDTO?)
    -> [String]
  {
    guard let photometry else { return [] }
    let switches: [(String, BrowserV4JSONValue?)] = [
      ("photometry.stellarVariability", photometry.stellarVariability),
      ("photometry.forwardScattering", photometry.forwardScattering),
      ("photometry.atmosphereTransmission", photometry.atmosphereTransmission),
      ("photometry.spotEvolution", photometry.spotEvolution),
      ("photometry.stellarSurface", photometry.stellarSurface),
      ("photometry.atmosphereRT", photometry.atmosphereRT),
      ("photometry.spectralBandpass", photometry.spectralBandpass),
      ("photometry.thermalModelAdvanced", photometry.thermalModelAdvanced),
      ("photometry.ringScattering", photometry.ringScattering),
      ("photometry.instrument", photometry.instrument),
      ("photometry.instrumentNoise", photometry.instrumentNoise),
    ]
    let patches =
      photometry.brightnessPatches?.hasContent == true ? ["photometry.brightnessPatches"] : []
    return patches + switches.filter { $0.1?.isEnabled == true }.map(\.0)
  }

  /// Rejects thermal inertia and unknown phase or day-night model names.
  private static func phaseFeatures(_ photometry: BrowserV4ScenarioDTO.PhotometryDTO?) -> [String]
  {
    var features: [String] = []
    let curves = [
      ("photometry.phaseCurve", photometry?.phaseCurve),
      ("photometry.moonPhaseCurve", photometry?.moonPhaseCurve),
    ]
    for (name, curve) in curves {
      guard let curve else { continue }
      if curve.thermalInertia?.isEnabled == true { features.append("\(name).thermalInertia") }
      features += unknownModels(name, reflected: curve.reflModel, thermal: curve.thermalModel)
    }
    if let dayNight = photometry?.dayNightVisibility {
      features += unknownModels(
        "photometry.dayNightVisibility", reflected: dayNight.reflectedModel,
        thermal: dayNight.thermalModel)
    }
    return features
  }

  /// Names reflected or thermal model strings that have no native phase law.
  private static func unknownModels(_ name: String, reflected: String?, thermal: String?)
    -> [String]
  {
    var features: [String] = []
    if let reflected, PhaseCurve.ReflectedModel(rawValue: reflected) == nil {
      features.append("\(name) reflected model \(reflected)")
    }
    if let thermal, PhaseCurve.ThermalModel(rawValue: thermal) == nil {
      features.append("\(name) thermal model \(thermal)")
    }
    return features
  }
}
