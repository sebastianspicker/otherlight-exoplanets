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
    features += bodyExtensionFeatures(dto.bodies, mode: mode)
    features +=
      mode == .detachedBinaryLab
      ? binaryFeatures(dto.bodies) : generalLabFeatures(dto.bodies, orbits: dto.orbits)
    features += limbDarkeningFeatures(dto, mode: mode)
    features += photometryFeatures(dto.photometry)
    features += stellarSurfaceFeatures(dto.photometry, mode: mode)
    features += phaseFeatures(dto.photometry)
    return features
  }

  /// Rejects scientific execution, a tilted observer, and N-body or GR dynamics.
  ///
  /// Node longitudes and the exomoon orientation drift of `dynamics.exomoonTimingShape` have
  /// native representations and are imported by `BrowserV4Import`.
  private static func contextFeatures(_ dto: BrowserV4ScenarioDTO) -> [String] {
    var features: [String] = []
    if dto.runtime?.executionMode == "scientific-browser" {
      features.append("runtime.executionMode scientific-browser")
    }
    if let dir = dto.observer?.dir, dir != Vector3(x: 0, y: 0, z: 1) {
      features.append("observer.dir other than (0, 0, 1)")
    }
    for key in ["nbodyPlanetMoon", "relativity"] where dto.dynamics?[key]?.isEnabled == true {
      features.append("dynamics.\(key)")
    }
    return features
  }

  /// Rejects star shapes, unsupported planet and moon shapes, rings, spin, gravity harmonics,
  /// tides, and physical stellar photometry.
  ///
  /// The general-lab primary star's `spin` is imported for the Rossiter–McLaughlin anomaly, and
  /// the second star's `spin` is ignored in both modes as the Browser ignores it; the
  /// detached-binary kernel does not evaluate spin, so the primary's stays rejected there.
  private static func bodyExtensionFeatures(
    _ bodies: BrowserV4ScenarioDTO.BodiesDTO, mode: EducationScenarioMode
  ) -> [String] {
    var features: [String] = []
    if bodies.stars.count > 2 { features.append("more than two stars") }
    let extras: [(String, [BrowserV4JSONValue?])] =
      bodies.stars.enumerated().map { index, star in
        // The Browser ignores the second star's spin; only the binary primary's is unsupported.
        let spin = mode == .detachedBinaryLab && index == 0 ? star.spin : nil
        return (star.id, [star.shape, star.rings, spin, star.gravityHarmonics, star.tides])
      }
      + bodies.planets.map { ($0.id, [$0.rings, $0.spin, $0.gravityHarmonics, $0.tides]) }
      + bodies.moons.map { ($0.id, [$0.rings, $0.spin, $0.gravityHarmonics, $0.tides]) }
    for (id, values) in extras where values.contains(where: { $0?.hasContent == true }) {
      features.append("body \(id) shape, rings, spin, gravity harmonics, or tides")
    }
    let shapes = bodies.planets.map { ($0.id, $0.shape) } + bodies.moons.map { ($0.id, $0.shape) }
    for (id, shape) in shapes where !isSupportedShape(shape) {
      features.append(
        "body \(id) shape other than a finite oblateness below 1 with an optional finite angle")
    }
    if bodies.stars.contains(where: {
      $0.teffK != nil || $0.loggCgs != nil || $0.metallicityDex != nil
    }) {
      features.append("physical stellar photometry (teffK, loggCgs, metallicityDex)")
    }
    return features
  }

  /// Accepts an absent or empty shape, or exactly a finite `oblateness` below 1 plus an optional
  /// finite `angle`, which the native oblate silhouette represents; as in the Browser, a
  /// non-positive oblateness neither shrinks the radius nor makes a silhouette.
  private static func isSupportedShape(_ shape: BrowserV4JSONValue?) -> Bool {
    guard let shape, shape.hasContent else { return true }
    guard case .object(let members) = shape, case .number(let f)? = members["oblateness"],
      f.isFinite, f < 1
    else { return false }
    if let angle = members["angle"] {
      guard case .number(let value) = angle, value.isFinite else { return false }
    }
    return Set(members.keys).isSubset(of: ["oblateness", "angle"])
  }

  /// Rejects planets and moons in the detached-binary lab.
  private static func binaryFeatures(_ bodies: BrowserV4ScenarioDTO.BodiesDTO) -> [String] {
    bodies.planets.isEmpty && bodies.moons.isEmpty
      ? [] : ["planets or moons in the detached-binary lab"]
  }

  /// Rejects general-lab structures beyond one star-hosted planet with at most one moon.
  ///
  /// A moon without `parentPlanetId` takes its parent from `orbits.hierarchy` (the last link
  /// naming it, as the Browser `hierarchyParentMap`).
  private static func generalLabFeatures(
    _ bodies: BrowserV4ScenarioDTO.BodiesDTO, orbits: BrowserV4ScenarioDTO.OrbitsDTO?
  ) -> [String] {
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
    if let moon = bodies.moons.first, moonParent(moon, orbits: orbits) != planet.id {
      features.append("moon without the planet as parent")
    }
    return features
  }

  /// Returns a moon's parent planet identifier: `parentPlanetId`, else the hierarchy's.
  private static func moonParent(
    _ moon: BrowserV4ScenarioDTO.MoonDTO, orbits: BrowserV4ScenarioDTO.OrbitsDTO?
  ) -> String? {
    if let parent = moon.parentPlanetId { return parent }
    return orbits?.hierarchy.last {
      $0.childId == moon.id && !$0.childId.isEmpty && !$0.parentId.isEmpty
    }?.parentId
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
  ///
  /// Stellar variability and the stellar surface are evaluated in the general lab and checked by
  /// `stellarSurfaceFeatures`.
  private static func photometryFeatures(_ photometry: BrowserV4ScenarioDTO.PhotometryDTO?)
    -> [String]
  {
    guard let photometry else { return [] }
    let switches: [(String, BrowserV4JSONValue?)] = [
      ("photometry.forwardScattering", photometry.forwardScattering),
      ("photometry.atmosphereTransmission", photometry.atmosphereTransmission),
      ("photometry.atmosphereRT", photometry.atmosphereRT),
      ("photometry.spectralBandpass", photometry.spectralBandpass),
      ("photometry.thermalModelAdvanced", photometry.thermalModelAdvanced),
      ("photometry.ringScattering", photometry.ringScattering),
      ("photometry.instrument", photometry.instrument),
      ("photometry.instrumentNoise", photometry.instrumentNoise),
    ]
    return switches.filter { $0.1?.isEnabled == true }.map(\.0)
  }

  /// Rejects brightness patches and spot evolution the native primary-star surface cannot mirror.
  ///
  /// General-lab patch arrays are imported; entries without a `circle` or `ellipse` shape or with
  /// invalid fields are dropped as the Browser drops them. With spot evolution enabled the Browser
  /// evolves the raw entries before sanitising them, so entries it would keep but the static
  /// sanitiser drops or clamps are rejected. The detached-binary kernel has no stellar surface and
  /// does not evaluate stellar variability, which the Browser phases from the binary companion.
  private static func stellarSurfaceFeatures(
    _ photometry: BrowserV4ScenarioDTO.PhotometryDTO?, mode: EducationScenarioMode
  ) -> [String] {
    guard let photometry else { return [] }
    let patches = photometry.brightnessPatches
    let evolving = photometry.spotEvolution?.isEnabled == true
    if mode == .detachedBinaryLab {
      return (patches?.hasContent == true ? ["photometry.brightnessPatches"] : [])
        + (evolving ? ["photometry.spotEvolution"] : [])
        + (photometry.stellarVariability?.isEnabled == true
          ? ["photometry.stellarVariability"] : [])
        + (photometry.stellarSurface?.isEnabled == true ? ["photometry.stellarSurface"] : [])
    }
    var features: [String] = []
    if let patches, patches.hasContent {
      guard case .array(let entries) = patches else {
        return ["photometry.brightnessPatches other than an array"]
      }
      if evolving, entries.contains(where: diverges) {
        features.append(
          "photometry.brightnessPatches entry that spot evolution keeps without a valid circle"
            + " or ellipse or with a negative factor")
      }
    }
    return features
  }

  /// Reports whether the Browser `evolvePatch` keeps an entry the static sanitiser drops or clamps.
  private static func diverges(_ entry: BrowserV4JSONValue) -> Bool {
    guard entry["x"]?.finiteNumber != nil, entry["y"]?.finiteNumber != nil,
      let factor = entry["factor"]?.finiteNumber, let radius = evolvedRadius(entry)
    else { return false }
    return !radius.sanitizable || factor < 0
  }

  /// Returns the radius `evolvePatch` uses (`sqrt(rx ry)` for an ellipse, else `r`) when it is
  /// finite and positive, and whether the static sanitiser accepts the outline.
  private static func evolvedRadius(_ entry: BrowserV4JSONValue) -> (
    value: Double, sanitizable: Bool
  )? {
    let rx = entry["rx"]?.finiteNumber ?? .nan
    let ry = entry["ry"]?.finiteNumber ?? .nan
    let isEllipse = entry["shape"] == .string("ellipse")
    let r = isEllipse ? sqrt(rx * ry) : entry["r"]?.finiteNumber ?? .nan
    guard r.isFinite, r > 0 else { return nil }
    return (r, isEllipse ? rx > 0 && ry > 0 : entry["shape"] == .string("circle"))
  }

  /// Rejects thermal inertia and unknown phase or day-night model names.
  private static func phaseFeatures(_ photometry: BrowserV4ScenarioDTO.PhotometryDTO?) -> [String] {
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
