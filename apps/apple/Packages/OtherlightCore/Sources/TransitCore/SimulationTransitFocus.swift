// Estimates the primary transit centre from the engine's own star-relative kinematics.
import Foundation

/// Transit-centre estimation shared by playback focus and light-curve windows.
extension SimulationEngine {
  /// Returns the epoch-nearest instant at which the transiting body is closest to the stellar
  /// centre while in front of it, or the quarter-period focus when no such crossing exists.
  ///
  /// The planet track (or the secondary star of a detached binary) is scanned over one period
  /// around the epoch for its minimum front-of-star sky separation and refined by a golden-section
  /// search, mirroring the Browser's crossing scan. Eccentric orbits and non-zero mean anomalies at
  /// epoch therefore keep the transit inside the playback window instead of clipping or missing it.
  public static func estimatedTransitCentreSeconds(for scenario: EducationScenarioV4) -> Double {
    let period =
      scenario.detachedBinary?.relativeOrbit.periodSeconds ?? scenario.planet.orbit.periodSeconds
    let fallback = scenario.epochSeconds + period / 4
    guard period.isFinite, period > 0 else { return fallback }
    let separation = frontSeparation(of: scenario)
    let sampleCount = 96
    var bestElapsed = 0.0
    var bestSeparation = Double.infinity
    for index in 0...sampleCount {
      let elapsed = (Double(index) / Double(sampleCount) - 0.5) * period
      let value = separation(elapsed)
      if value < bestSeparation {
        bestSeparation = value
        bestElapsed = elapsed
      }
    }
    guard bestSeparation.isFinite else { return fallback }
    let halfBracket = period / Double(sampleCount)
    let refined = goldenSectionMinimum(
      separation, lower: bestElapsed - halfBracket, upper: bestElapsed + halfBracket)
    guard separation(refined) < contactDistance(of: scenario) else { return fallback }
    return scenario.epochSeconds + refined
  }

  /// Sky-plane separation of the transiting body from the occulted star; infinite while behind it.
  private static func frontSeparation(of scenario: EducationScenarioV4) -> (Double) -> Double {
    if let binary = scenario.detachedBinary {
      return { elapsed in
        let relative = binary.relativeOrbit.position(at: elapsed)
        return relative.z > 0 ? hypot(relative.x, relative.y) : .infinity
      }
    }
    return { elapsed in
      let state = kinematics(of: scenario, elapsed: elapsed)
      let relative = state.planet - state.star
      return relative.z > 0 ? hypot(relative.x, relative.y) : .infinity
    }
  }

  /// Sum of the occulted and occulting radii: separations below it overlap on the sky.
  private static func contactDistance(of scenario: EducationScenarioV4) -> Double {
    if let binary = scenario.detachedBinary {
      return binary.primary.star.radiusMetres + binary.secondary.star.radiusMetres
    }
    return scenario.star.radiusMetres + scenario.planet.radiusMetres
  }

  /// Golden-section search for the minimum of a unimodal function on a bracket.
  private static func goldenSectionMinimum(
    _ function: (Double) -> Double, lower: Double, upper: Double
  ) -> Double {
    let ratio = (sqrt(5.0) - 1) / 2
    var a = lower
    var b = upper
    var c = b - ratio * (b - a)
    var d = a + ratio * (b - a)
    var fc = function(c)
    var fd = function(d)
    for _ in 0..<60 {
      if fc < fd {
        b = d
        d = c
        fd = fc
        c = b - ratio * (b - a)
        fc = function(c)
      } else {
        a = c
        c = d
        fc = fd
        d = a + ratio * (b - a)
        fd = function(d)
      }
    }
    return (a + b) / 2
  }
}
