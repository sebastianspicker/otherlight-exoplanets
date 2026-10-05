// Evaluates the V4 reflected and thermal phase-curve terms of planets and moons.
import Foundation

/// Reflected and thermal phase-curve evaluation of the Education engine.
extension SimulationEngine {
  /// Calculates the configured reflected and thermal phase contribution of a body.
  ///
  /// `position` and `velocity` are the body relative to its parent star. The model selection,
  /// `dayNightVisibility` override, weight clamping, signed offsets, and physical scaling mirror
  /// the Browser `bodyPhaseFlux`.
  func phaseFlux(
    _ curve: PhaseCurve?, at position: Vector3, velocity: Vector3?, bodyRadius: Double
  ) -> Double {
    guard let curve, curve.enabled else { return 0 }
    let distance = position.length
    guard distance.isFinite, distance >= 1e-15 else { return 0 }
    let alpha = acos(max(-1, min(1, -position.z / distance)))
    let dayNight = scenario.dayNightVisibility.flatMap { $0.enabled ? $0 : nil }
    let clamps = dayNight.map { $0.clamp != false } ?? curve.clampsWeights
    let reflectedModel = dayNight.map { $0.reflectedModel ?? .lambert } ?? curve.reflectedModel
    let thermalModel = dayNight.map { $0.thermalModel ?? .constant } ?? curve.thermalModel
    var reflectedScale = 1.0
    var thermalScale = 1.0
    if curve.usesPhysicalScaling, bodyRadius.isFinite, bodyRadius > 0 {
      reflectedScale = (bodyRadius * bodyRadius) / (distance * distance)
      let starRadius = scenario.star.radiusMetres
      if starRadius.isFinite, starRadius > 0 {
        thermalScale = (bodyRadius * bodyRadius) / (starRadius * starRadius)
      }
    }
    let reflectedAmplitude = max(0, curve.reflectedAmplitude) * reflectedScale
    let thermalAmplitude = max(0, curve.thermalAmplitude) * thermalScale
    var reflected = 0.0
    if reflectedAmplitude > 0 {
      let weight = phaseWeight(
        at: Self.shiftedAlpha(
          alpha, position: position, velocity: velocity, shift: curve.reflectedOffsetRadians),
        model: reflectedModel)
      reflected = reflectedAmplitude * (clamps ? min(1, max(0, weight)) : weight)
    }
    var thermal = 0.0
    if thermalAmplitude > 0 {
      let weight = phaseWeight(
        at: Self.shiftedAlpha(
          alpha, position: position, velocity: velocity, shift: curve.thermalOffsetRadians),
        model: thermalModel)
      thermal = thermalAmplitude * (clamps ? min(1, max(0, weight)) : weight)
    }
    let constant = max(0, curve.constantFlux) * (curve.usesPhysicalScaling ? thermalScale : 1)
    let total = reflected + thermal + constant
    return total.isFinite ? max(0, total) : 0
  }

  /// Returns the phase angle of a body whose bright region is shifted by a signed orbital angle.
  ///
  /// With a usable velocity the body is rotated by `-shift` along its orbit, so
  /// `cos α = -(r̂·ô) cos δ + (t̂·ô) sin δ` with `ô = (0, 0, 1)`; otherwise the legacy
  /// `clamp(α - δ, 0, π)` applies. A zero shift returns the unshifted phase angle.
  static func shiftedAlpha(
    _ alpha: Double, position: Vector3, velocity: Vector3?, shift: Double
  ) -> Double {
    let clamped = min(max(alpha, 0), .pi)
    guard shift.isFinite, shift != 0 else { return clamped }
    let legacy = min(max(clamped - shift, 0), .pi)
    let length = position.length
    guard let velocity, length > 0 else { return legacy }
    let unit = position * (1 / length)
    let radial = velocity.x * unit.x + velocity.y * unit.y + velocity.z * unit.z
    let perpendicular = velocity - unit * radial
    guard perpendicular.length > 1e-9 * velocity.length else { return legacy }
    let tangent = perpendicular * (1 / perpendicular.length)
    return acos(max(-1, min(1, -unit.z * cos(shift) + tangent.z * sin(shift))))
  }

  /// Evaluates the portable V4 phase weights after an optional phenomenological offset.
  func phaseWeight(at alpha: Double, model: PhaseCurve.ReflectedModel) -> Double {
    let a = min(max(alpha, 0), .pi)
    return switch model {
    case .lambert: min(1, max(0, (sin(a) + (.pi - a) * cos(a)) / .pi))
    case .cosine: min(1, max(0, (1 + cos(a)) / 2))
    }
  }

  /// Evaluates the portable thermal phase weights, including isotropic emission.
  func phaseWeight(at alpha: Double, model: PhaseCurve.ThermalModel) -> Double {
    switch model {
    case .constant: 1
    case .lambert: phaseWeight(at: alpha, model: PhaseCurve.ReflectedModel.lambert)
    case .cosine: phaseWeight(at: alpha, model: PhaseCurve.ReflectedModel.cosine)
    }
  }
}
