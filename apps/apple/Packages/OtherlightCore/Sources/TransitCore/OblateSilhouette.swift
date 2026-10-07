// Resolves Browser V4 oblate planet and moon silhouettes and the opaque transit occulters.
import Foundation

/// Stores the authored Browser V4 `shape` of a planet or moon.
///
/// The body's `radiusMetres` stays the circular radius the engine uses everywhere except the
/// transit silhouette: the Browser `safeBodyRadius`, i.e. the authored equatorial radius scaled by
/// `radiusScale(oblateness:)`. The authored equatorial radius is stored exactly, so the silhouette
/// and the exported `r` never pass through that scale.
public struct BodyShape: Codable, Sendable, Hashable {
  /// The authored flattening `f` (< 1; a non-positive value has no effect), the sky-plane
  /// major-axis angle in radians measured from +x toward +y, and the authored equatorial radius.
  public var oblateness: Double
  public var angleRadians: Double
  public var equatorialRadiusMetres: Double
  /// Creates an authored shape from its flattening, sky-plane angle, and equatorial radius.
  public init(oblateness: Double, angleRadians: Double = 0, equatorialRadiusMetres: Double) {
    self.oblateness = oblateness
    self.angleRadians = angleRadians
    self.equatorialRadiusMetres = equatorialRadiusMetres
  }

  /// Returns the Browser `safeBodyRadius` factor `max(0.1, 1 - 0.5 min(0.9, f))`, or 1 for f ≤ 0.
  public static func radiusScale(oblateness: Double) -> Double {
    let f = oblateness.isFinite ? oblateness : 0
    guard f > 0 else { return 1 }
    return max(0.1, 1 - 0.5 * min(0.9, f))
  }

  /// Returns the circular radius, the Browser `safeBodyRadius` of the equatorial radius.
  public var circularRadiusMetres: Double {
    equatorialRadiusMetres * Self.radiusScale(oblateness: oblateness)
  }

  /// Sets the equatorial radius whose `safeBodyRadius` is an edited circular radius.
  mutating func rescale(toCircularRadius radius: Double) {
    equatorialRadiusMetres = radius / Self.radiusScale(oblateness: oblateness)
  }
}

/// Describes a projected oblate silhouette: semi-axes in metres and the major-axis angle.
public struct OblateSilhouette: Sendable, Hashable {
  /// The equatorial and polar semi-axes and the rotation of the equatorial axis from +x.
  public var rxMetres: Double
  public var ryMetres: Double
  public var angleRadians: Double
  /// Creates a silhouette from its semi-axes and rotation.
  public init(rxMetres: Double, ryMetres: Double, angleRadians: Double) {
    self.rxMetres = rxMetres
    self.ryMetres = ryMetres
    self.angleRadians = angleRadians
  }

  /// Mirrors the Browser `oblateSilhouetteForBody` for a planet or moon.
  ///
  /// Only with `nonSphericalFlux`, a finite flattening in (0, 1) and a finite positive authored
  /// equatorial radius does the body get the Seager & Hui (2002) ellipse `rx = Re`,
  /// `ry = Re (1 - f)`, rotated by the finite angle (else 0). Atmosphere targets stay circular in
  /// the Browser; the native app rejects atmospheres on import, so they need no check here.
  public static func resolve(shape: BodyShape?, nonSphericalFlux: Bool) -> Self? {
    guard nonSphericalFlux, let shape else { return nil }
    let f = shape.oblateness
    guard f.isFinite, f > 0, f < 1 else { return nil }
    let equatorial = shape.equatorialRadiusMetres
    guard equatorial.isFinite, equatorial > 0 else { return nil }
    let angle = shape.angleRadians.isFinite ? shape.angleRadians : 0
    return .init(rxMetres: equatorial, ryMetres: equatorial * (1 - f), angleRadians: angle)
  }
}

/// Names one opaque sky-plane occulter of the stellar disk, positioned relative to the star.
enum Occulter: Sendable, Hashable {
  case circle(center: Vector3, radius: Double)
  case ellipse(center: Vector3, rx: Double, ry: Double, angle: Double)

  /// Builds a body's occulter: its oblate silhouette when one resolves, else its circle.
  static func body(
    at center: Vector3, radius: Double, shape: BodyShape?, nonSphericalFlux: Bool
  ) -> Self {
    guard
      let silhouette = OblateSilhouette.resolve(shape: shape, nonSphericalFlux: nonSphericalFlux)
    else { return .circle(center: center, radius: radius) }
    return .ellipse(
      center: center, rx: silhouette.rxMetres, ry: silhouette.ryMetres,
      angle: silhouette.angleRadians)
  }

  /// The occulter centre relative to the star.
  var center: Vector3 {
    switch self {
    case .circle(let center, _), .ellipse(let center, _, _, _): center
    }
  }

  /// The largest sky-plane extent from the centre, used to skip occulters that cannot overlap.
  var reach: Double {
    switch self {
    case .circle(_, let radius): radius
    case .ellipse(_, let rx, let ry, _): max(rx, ry)
    }
  }
}

/// Holds an occulter's per-cell test coefficients, precomputed once per disk integration.
enum PreparedOcculter {
  case circle(x: Double, y: Double, radius: Double)
  case ellipse(x: Double, y: Double, cosA: Double, sinA: Double, invRx2: Double, invRy2: Double)

  /// Precomputes the rotation and inverse squared semi-axes as the Browser `occulterEllipse.ts`.
  init(_ occulter: Occulter) {
    switch occulter {
    case .circle(let center, let radius):
      self = .circle(x: center.x, y: center.y, radius: radius)
    case .ellipse(let center, let rx, let ry, let angle):
      self = .ellipse(
        x: center.x, y: center.y, cosA: cos(angle), sinA: sin(angle), invRx2: 1 / (rx * rx),
        invRy2: 1 / (ry * ry))
    }
  }

  /// Reports whether a sky-plane point is strictly inside the occulter; tangency is not blocked.
  func blocks(x: Double, y: Double) -> Bool {
    switch self {
    case .circle(let cx, let cy, let radius):
      let dx = x - cx
      let dy = y - cy
      return dx * dx + dy * dy < radius * radius
    case .ellipse(let cx, let cy, let cosA, let sinA, let invRx2, let invRy2):
      let xp = x - cx
      let yp = y - cy
      let xr = xp * cosA + yp * sinA
      let yr = -xp * sinA + yp * cosA
      return xr * xr * invRx2 + yr * yr * invRy2 < 1
    }
  }
}
