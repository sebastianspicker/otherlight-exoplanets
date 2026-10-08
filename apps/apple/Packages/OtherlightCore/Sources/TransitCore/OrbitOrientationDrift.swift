// Advances an orbit's orientation angles linearly from a reference epoch, as the Browser V4 does.
import Foundation

/// Linear drift of an orbit's node, inclination, and periapsis angles from a reference epoch.
///
/// Mirrors `apps/browser/src/domain/orbits/orbitOrientationDrift.ts`: non-finite rates count as
/// zero, non-finite overrides are ignored, the node and periapsis angles are not wrapped, and a
/// drifted inclination is kept inside [0, π] by flipping node and periapsis.
public struct OrbitOrientationDrift: Codable, Sendable, Hashable {
  public var omegaDotRadiansPerSecond: Double
  public var inclinationDotRadiansPerSecond: Double
  public var argumentOfPeriapsisDotRadiansPerSecond: Double
  public var longitudeOfAscendingNodeOverrideRadians: Double?
  public var inclinationOverrideRadians: Double?
  public var argumentOfPeriapsisOverrideRadians: Double?
  public var referenceEpochSeconds: Double
  /// Creates a drift from its angular rates, optional base-orientation overrides, and epoch.
  public init(
    omegaDotRadiansPerSecond: Double = 0, inclinationDotRadiansPerSecond: Double = 0,
    argumentOfPeriapsisDotRadiansPerSecond: Double = 0,
    longitudeOfAscendingNodeOverrideRadians: Double? = nil,
    inclinationOverrideRadians: Double? = nil, argumentOfPeriapsisOverrideRadians: Double? = nil,
    referenceEpochSeconds: Double = 0
  ) {
    self.omegaDotRadiansPerSecond = omegaDotRadiansPerSecond
    self.inclinationDotRadiansPerSecond = inclinationDotRadiansPerSecond
    self.argumentOfPeriapsisDotRadiansPerSecond = argumentOfPeriapsisDotRadiansPerSecond
    self.longitudeOfAscendingNodeOverrideRadians = longitudeOfAscendingNodeOverrideRadians
    self.inclinationOverrideRadians = inclinationOverrideRadians
    self.argumentOfPeriapsisOverrideRadians = argumentOfPeriapsisOverrideRadians
    self.referenceEpochSeconds = referenceEpochSeconds
  }

  /// Reports whether any rate is finite and non-zero or any orientation override is finite.
  public var hasDrift: Bool {
    let rates = [
      omegaDotRadiansPerSecond, inclinationDotRadiansPerSecond,
      argumentOfPeriapsisDotRadiansPerSecond,
    ]
    let overrides = [
      longitudeOfAscendingNodeOverrideRadians, inclinationOverrideRadians,
      argumentOfPeriapsisOverrideRadians,
    ]
    return rates.contains { $0.isFinite && $0 != 0 }
      || overrides.contains { $0?.isFinite == true }
  }

  /// Returns the orbit with its orientation advanced linearly to absolute scenario seconds.
  ///
  /// The orbit is returned unchanged when the drift is empty; other elements are never altered.
  public func driftedOrbit(_ orbit: KeplerOrbit, atAbsoluteSeconds seconds: Double) -> KeplerOrbit {
    guard hasDrift else { return orbit }
    let elapsed = seconds - Self.finite(referenceEpochSeconds, or: 0)
    var drifted = orbit
    drifted.longitudeOfAscendingNodeRadians =
      Self.finite(
        longitudeOfAscendingNodeOverrideRadians, or: orbit.longitudeOfAscendingNodeRadians)
      + Self.finite(omegaDotRadiansPerSecond, or: 0) * elapsed
    drifted.inclinationRadians =
      Self.finite(inclinationOverrideRadians, or: orbit.inclinationRadians)
      + Self.finite(inclinationDotRadiansPerSecond, or: 0) * elapsed
    drifted.argumentOfPeriapsisRadians =
      Self.finite(argumentOfPeriapsisOverrideRadians, or: orbit.argumentOfPeriapsisRadians)
      + Self.finite(argumentOfPeriapsisDotRadiansPerSecond, or: 0) * elapsed
    Self.normalizeInclination(&drifted)
    return drifted
  }

  /// Returns the orientation contribution Ω_frame × r in the observer frame (sky x = −inertial y).
  /// Raw angles keep the derivative continuous through inclination folding at zero and π.
  public func orientationVelocity(
    of orbit: KeplerOrbit, atAbsoluteSeconds seconds: Double, position: Vector3
  ) -> Vector3 {
    let elapsed = seconds - Self.finite(referenceEpochSeconds, or: 0)
    let node =
      Self.finite(
        longitudeOfAscendingNodeOverrideRadians, or: orbit.longitudeOfAscendingNodeRadians)
      + Self.finite(omegaDotRadiansPerSecond, or: 0) * elapsed
    let inclination =
      Self.finite(inclinationOverrideRadians, or: orbit.inclinationRadians)
      + Self.finite(inclinationDotRadiansPerSecond, or: 0) * elapsed
    let inclinationRate = Self.finite(inclinationDotRadiansPerSecond, or: 0)
    let periapsisRate = Self.finite(argumentOfPeriapsisDotRadiansPerSecond, or: 0)
    let angular = Vector3(
      x: -inclinationRate * sin(node) + periapsisRate * cos(node) * sin(inclination),
      y: inclinationRate * cos(node) + periapsisRate * sin(node) * sin(inclination),
      z: Self.finite(omegaDotRadiansPerSecond, or: 0) + periapsisRate * cos(inclination))
    return Vector3(
      x: angular.y * position.z - angular.z * position.y,
      y: angular.z * position.x - angular.x * position.z,
      z: angular.x * position.y - angular.y * position.x)
  }

  /// Keeps the inclination inside [0, π] without changing the orientation, as the Browser does:
  /// `Rx(−i) = Rz(π) Rx(i) Rz(π)`, so a negative inclination is the same orbit with the node and
  /// the periapsis advanced by π. The inclination is first reduced to (−π, π].
  private static func normalizeInclination(_ orbit: inout KeplerOrbit) {
    var reduced = orbit.inclinationRadians.truncatingRemainder(dividingBy: 2 * .pi)
    if reduced > .pi { reduced -= 2 * .pi }
    if reduced <= -.pi { reduced += 2 * .pi }
    guard reduced < 0 else {
      orbit.inclinationRadians = reduced
      return
    }
    orbit.inclinationRadians = -reduced
    orbit.longitudeOfAscendingNodeRadians += .pi
    orbit.argumentOfPeriapsisRadians += .pi
  }

  /// Returns the value when it is present and finite, otherwise the fallback.
  private static func finite(_ value: Double?, or fallback: Double) -> Double {
    guard let value, value.isFinite else { return fallback }
    return value
  }
}
