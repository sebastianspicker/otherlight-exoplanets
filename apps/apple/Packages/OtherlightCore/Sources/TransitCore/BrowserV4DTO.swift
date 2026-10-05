// Defines the bounded Browser V4 serialized envelope without interpreting it.
import Foundation

/// The bounded browser V4 input shape used by the active education fixtures.
/// Fields that change Browser V4 output but have no native representation are decoded only so
/// `BrowserV4Import` can reject them; other unknown fields are ignored and incompatible versions
/// fail closed.
public struct BrowserV4ScenarioDTO: Codable, Sendable, Hashable {
  /// Mirrors the browser V4 orbit field names without changing their serialized contract.
  public struct OrbitDTO: Codable, Sendable, Hashable {
    public let a: Double
    public let e: Double
    public let inc: Double
    public let longitudeOfAscendingNode: Double
    public let omega: Double
    public let period: Double
    public let t0: Double
    /// Maps Swift property names to the browser V4 wire-field names.
    enum CodingKeys: String, CodingKey {
      case a, e, inc, omega, period, t0
      case longitudeOfAscendingNode = "Omega"
    }
  }
  /// Mirrors a browser V4 star record.
  public struct StarDTO: Codable, Sendable, Hashable {
    public let id: String
    public let r: Double
    public let m: Double?
    public let luminosityScale: Double?
    public var teffK: Double? = nil
    public var loggCgs: Double? = nil
    public var metallicityDex: Double? = nil
    public var passband: String? = nil
    public var shape: BrowserV4JSONValue? = nil
    public var rings: BrowserV4JSONValue? = nil
    public var spin: BrowserV4JSONValue? = nil
    public var gravityHarmonics: BrowserV4JSONValue? = nil
    public var tides: BrowserV4JSONValue? = nil
  }
  /// Mirrors a browser V4 planet record and its parent references.
  public struct PlanetDTO: Codable, Sendable, Hashable {
    public let id: String
    public let r: Double
    public let m: Double?
    public let orbit: OrbitDTO
    public let parentStarId: String?
    public let parentSystem: String?
    public var shape: BrowserV4JSONValue? = nil
    public var rings: BrowserV4JSONValue? = nil
    public var spin: BrowserV4JSONValue? = nil
    public var gravityHarmonics: BrowserV4JSONValue? = nil
    public var tides: BrowserV4JSONValue? = nil
  }
  /// Mirrors a browser V4 moon record and its planet reference.
  public struct MoonDTO: Codable, Sendable, Hashable {
    public let id: String
    public let r: Double
    public let m: Double?
    public let orbit: OrbitDTO
    public let parentPlanetId: String?
    public var shape: BrowserV4JSONValue? = nil
    public var rings: BrowserV4JSONValue? = nil
    public var spin: BrowserV4JSONValue? = nil
    public var gravityHarmonics: BrowserV4JSONValue? = nil
    public var tides: BrowserV4JSONValue? = nil
  }
  /// Groups browser V4 body arrays by physical kind.
  public struct BodiesDTO: Codable, Sendable, Hashable {
    public let stars: [StarDTO]
    public let planets: [PlanetDTO]
    public let moons: [MoonDTO]
  }
  /// Carries the two browser V4 quadratic limb-darkening coefficients.
  public struct LimbDarkeningDTO: Codable, Sendable, Hashable {
    public var kind: String? = nil
    public let u1: Double?
    public let u2: Double?
  }
  /// Retains the browser V4 default limb-darkening envelope.
  public struct LimbDarkeningModelDTO: Codable, Sendable, Hashable {
    public let `default`: LimbDarkeningDTO?
    public var bandpass: String? = nil
    public var bands: BrowserV4JSONValue? = nil
    public var stellar: BrowserV4JSONValue? = nil
    public var constraints: BrowserV4JSONValue? = nil
  }
  /// Mirrors browser V4 phase-curve names for compatibility.
  public struct PhaseCurveDTO: Codable, Sendable, Hashable {
    public let enabled: Bool?
    public let reflAmp: Double?
    public let thermAmp: Double?
    public let reflOffset: Double?
    public let thermOffset: Double?
    public let constant: Double?
    public let reflModel: String?
    public let thermalModel: String?
    public let lambertian: Bool?
    public let clamp: Bool?
    public let physicalScaling: Bool?
    public var thermalInertia: BrowserV4JSONValue? = nil
  }
  /// Mirrors the browser V4 day-night visibility override of both phase models.
  public struct DayNightVisibilityDTO: Codable, Sendable, Hashable {
    public let enabled: Bool?
    public let reflectedModel: String?
    public let thermalModel: String?
    public let clamp: Bool?
  }
  /// Collects optional browser V4 photometry settings.
  public struct PhotometryDTO: Codable, Sendable, Hashable {
    public let gridRes: Int?
    public let limbDarkeningModel: LimbDarkeningModelDTO?
    public let phaseCurve: PhaseCurveDTO?
    public let moonPhaseCurve: PhaseCurveDTO?
    public var dayNightVisibility: DayNightVisibilityDTO? = nil
    public var brightnessPatches: BrowserV4JSONValue? = nil
    public var stellarVariability: BrowserV4JSONValue? = nil
    public var forwardScattering: BrowserV4JSONValue? = nil
    public var atmosphereTransmission: BrowserV4JSONValue? = nil
    public var spotEvolution: BrowserV4JSONValue? = nil
    public var stellarSurface: BrowserV4JSONValue? = nil
    public var atmosphereRT: BrowserV4JSONValue? = nil
    public var spectralBandpass: BrowserV4JSONValue? = nil
    public var thermalModelAdvanced: BrowserV4JSONValue? = nil
    public var ringScattering: BrowserV4JSONValue? = nil
    public var instrument: BrowserV4JSONValue? = nil
    public var instrumentNoise: BrowserV4JSONValue? = nil
  }
  /// Carries the browser V4 active-lesson selection.
  public struct DidacticsDTO: Codable, Sendable, Hashable { public let activeLessonId: String? }
  /// Mirrors the V4 detached-binary learner gates without adding native-only fields.
  public struct BinaryLabDTO: Codable, Sendable, Hashable {
    public let enabled: Bool
    public let hideSkyUntilReveal: Bool
    public let requireHypothesis: Bool
    public let lockParamsUntilHypothesis: Bool
    /// Creates a V4 binary-lab envelope from its learner-gate settings.
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
  /// Mirrors browser V4 runtime metadata without interpreting it as native behavior.
  public struct RuntimeDTO: Codable, Sendable, Hashable {
    public let mode: String
    public let executionMode: String
    public let referenceSubsteps: Int?
  }
  /// Carries the browser V4 observer direction.
  public struct ObserverDTO: Codable, Sendable, Hashable { public let dir: Vector3 }
  /// Represents one browser V4 parent-child body relationship.
  public struct HierarchyDTO: Codable, Sendable, Hashable {
    public let childId: String
    public let parentId: String
    public let relation: String
  }
  /// Groups browser V4 binary and hierarchy orbit metadata.
  public struct OrbitsDTO: Codable, Sendable, Hashable {
    public let binary: OrbitDTO
    public let hierarchy: [HierarchyDTO]
  }
  public let version: String
  public let mode: String
  public let runtime: RuntimeDTO?
  public let observer: ObserverDTO?
  public let bodies: BodiesDTO
  public let orbits: OrbitsDTO?
  public let photometry: PhotometryDTO?
  public let didactics: DidacticsDTO?
  public let binaryLab: BinaryLabDTO?
  public var dynamics: BrowserV4JSONValue? = nil
}

/// Holds an arbitrary JSON value so unsupported Browser V4 features can be detected on import.
public enum BrowserV4JSONValue: Codable, Sendable, Hashable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([BrowserV4JSONValue])
  case object([String: BrowserV4JSONValue])

  /// Decodes any JSON value without interpreting it.
  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([BrowserV4JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: BrowserV4JSONValue].self))
    }
  }

  /// Encodes the value back to its original JSON shape.
  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value): try container.encode(value)
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }

  /// Returns the member value of an object, or nil for other values.
  public subscript(key: String) -> BrowserV4JSONValue? {
    if case .object(let members) = self { return members[key] }
    return nil
  }

  /// Reports whether this is an object whose `enabled` flag is `true`.
  public var isEnabled: Bool { self["enabled"] == .bool(true) }

  /// Reports whether the value carries content: anything except null, an empty array or object.
  public var hasContent: Bool {
    switch self {
    case .null: false
    case .array(let values): !values.isEmpty
    case .object(let members): !members.isEmpty
    default: true
    }
  }
}
