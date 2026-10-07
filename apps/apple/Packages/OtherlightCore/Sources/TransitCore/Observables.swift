// Defines the scenario star, its spin, and the radial-velocity and astrometric step observables.
import Foundation

/// Defines the stellar physical and limb-darkening inputs for a scenario.
public struct Star: Codable, Sendable, Hashable {
  /// The radius, the mass, and the quadratic limb-darkening coefficients; changing a coefficient
  /// marks the law as present, since an edited coefficient is an authored quadratic law.
  public var radiusMetres: Double
  public var massKilograms: Double
  public var limbDarkeningU1: Double {
    didSet { if limbDarkeningU1 != oldValue { limbDarkeningLawPresent = true } }
  }
  public var limbDarkeningU2: Double {
    didSet { if limbDarkeningU2 != oldValue { limbDarkeningLawPresent = true } }
  }
  /// Whether the Browser resolves a limb-darkening law for this star; false means a uniform disk
  /// (with both coefficients 0), which the Browser integrates on its Cartesian transmission grid.
  public var limbDarkeningLawPresent: Bool
  /// The optional authored rotation of the primary star.
  public var spin: StellarSpin?
  /// Creates a star from its physical properties, limb-darkening law, and optional spin.
  public init(
    radiusMetres: Double, massKilograms: Double, limbDarkeningU1: Double = 0.3,
    limbDarkeningU2: Double = 0.2, limbDarkeningLawPresent: Bool = true, spin: StellarSpin? = nil
  ) {
    self.radiusMetres = radiusMetres
    self.massKilograms = massKilograms
    self.limbDarkeningU1 = limbDarkeningU1
    self.limbDarkeningU2 = limbDarkeningU2
    self.limbDarkeningLawPresent = limbDarkeningLawPresent
    self.spin = spin
  }
  /// Names the serialized star fields.
  private enum CodingKeys: String, CodingKey {
    case radiusMetres, massKilograms, limbDarkeningU1, limbDarkeningU2, limbDarkeningLawPresent
    case spin
  }
  /// Decodes a star, reading an absent `limbDarkeningLawPresent` from older documents as true.
  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      radiusMetres: try container.decode(Double.self, forKey: .radiusMetres),
      massKilograms: try container.decode(Double.self, forKey: .massKilograms),
      limbDarkeningU1: try container.decode(Double.self, forKey: .limbDarkeningU1),
      limbDarkeningU2: try container.decode(Double.self, forKey: .limbDarkeningU2),
      limbDarkeningLawPresent: try container.decodeIfPresent(
        Bool.self, forKey: .limbDarkeningLawPresent) ?? true,
      spin: try container.decodeIfPresent(StellarSpin.self, forKey: .spin))
  }
}

/// The primary star's authored rotation, as the Browser V4 `star.spin`.
public struct StellarSpin: Codable, Sendable, Hashable {
  /// The rotation period (nil: none), the sky position angle of the projected spin axis measured
  /// from +y toward +x (nil: the projected orbit normal of the planet), and the preserved Browser
  /// `obliquity`, which the engine does not use.
  public var rotationPeriodSeconds: Double?
  public var axisPositionAngleRadians: Double?
  public var obliquityRadians: Double?
  /// Creates a stellar spin; absent fields keep their Browser meanings.
  public init(
    rotationPeriodSeconds: Double? = nil, axisPositionAngleRadians: Double? = nil,
    obliquityRadians: Double? = nil
  ) {
    self.rotationPeriodSeconds = rotationPeriodSeconds
    self.axisPositionAngleRadians = axisPositionAngleRadians
    self.obliquityRadians = obliquityRadians
  }
}

/// A sky-plane offset in metres with +y "up", for the observer along +z.
public struct SkyOffset: Codable, Sendable, Hashable {
  /// The sky-plane components in metres.
  public var x: Double
  public var y: Double
  /// Creates a sky-plane offset from its components.
  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

/// Radial-velocity and astrometric observables of one step, as the Browser V4 `StepObservables`.
///
/// Radial velocities are `rv = −(v · ô)` of barycentric velocities with `ô = (0, 0, 1)`, so they
/// are positive when receding. The Rossiter–McLaughlin anomaly is nil without a stellar rotation
/// period.
public struct StepObservables: Codable, Sendable, Hashable {
  /// The star, planet, and optional moon radial velocities in m/s.
  public var rvStar: Double
  public var rvPlanet: Double
  public var rvMoon: Double?
  /// The star's barycentric sky-plane offset in metres.
  public var astrometricOffsetStar: SkyOffset
  /// The Rossiter–McLaughlin radial-velocity anomaly of the primary star in m/s.
  public var rvStarRossiterMcLaughlin: Double?
  /// Creates step observables from their radial velocities, offset, and optional anomaly.
  public init(
    rvStar: Double, rvPlanet: Double, rvMoon: Double? = nil, astrometricOffsetStar: SkyOffset,
    rvStarRossiterMcLaughlin: Double? = nil
  ) {
    self.rvStar = rvStar
    self.rvPlanet = rvPlanet
    self.rvMoon = rvMoon
    self.astrometricOffsetStar = astrometricOffsetStar
    self.rvStarRossiterMcLaughlin = rvStarRossiterMcLaughlin
  }
}
