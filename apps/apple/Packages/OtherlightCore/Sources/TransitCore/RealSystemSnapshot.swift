// Converts the bundled Browser-owned real-system snapshot into native SI scenarios.
import Foundation

/// Mirrors a compact real-system catalogue snapshot before its values are converted to SI units.
public struct RealSystemSnapshotDTO: Codable, Sendable, Hashable {
  /// Mirrors one real-system catalogue entry and its source units.
  public struct SystemDTO: Codable, Sendable, Hashable {
    public let id: String
    public let label: String
    public let starRadiusSolar: Double
    public let semiMajorAxisAu: Double
    public let periodDays: Double
    public let planetRadiusJupiter: Double?
    public let planetRadiusEarth: Double?
    public let starMassSolar: Double?
    public let eccentricity: Double?
    public let inclinationDeg: Double?
  }
  public let systems: [SystemDTO]
}

/// Reports a catalogue row that cannot be converted to a scenario.
public enum RealSystemSnapshotError: Error, Sendable, Equatable {
  /// The row has neither a Jupiter nor an Earth planet radius.
  case missingPlanetRadius(String)
}

/// Converts real-system catalogue units into a native education scenario.
public enum RealSystemSnapshotImport {
  /// Converts catalog-scale solar, AU, day, and Jupiter-radius values to the engine's SI scenario.
  public static func scenario(from system: RealSystemSnapshotDTO.SystemDTO) throws
    -> EducationScenarioV4
  {
    let solarRadius = 6.957e8
    let solarMass = 1.98847e30
    let au = 1.495978707e11
    // NASA archive pl_radj / pl_rade use IAU nominal equatorial radii; keep equal to the Browser units.
    let jupiterRadius = 7.1492e7
    let earthRadius = 6.3781e6
    let planetRadius: Double
    if let jupiter = system.planetRadiusJupiter {
      planetRadius = jupiter * jupiterRadius
    } else if let earth = system.planetRadiusEarth {
      planetRadius = earth * earthRadius
    } else {
      throw RealSystemSnapshotError.missingPlanetRadius(system.id)
    }
    // Mirrors normalizedEccentricity / normalizedInclinationRad in the Browser catalog.
    let eccentricity =
      system.eccentricity.flatMap { $0.isFinite ? min(max($0, 0), 0.999) : nil } ?? 0
    let inclinationDeg =
      system.inclinationDeg.flatMap { $0.isFinite ? min(max($0, 0), 180) : nil } ?? 90
    return EducationScenarioV4(
      identifier: system.id,
      star: .init(
        radiusMetres: system.starRadiusSolar * solarRadius,
        massKilograms: (system.starMassSolar ?? 1) * solarMass),
      planet: .init(
        radiusMetres: planetRadius,
        orbit: .init(
          semiMajorAxisMetres: system.semiMajorAxisAu * au,
          periodSeconds: system.periodDays * 86_400, eccentricity: eccentricity,
          inclinationRadians: inclinationDeg * .pi / 180)))
  }
}
