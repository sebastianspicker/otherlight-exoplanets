// Shares the Browser V4 stellar-disk grids: the resolution clamp, the midpoint chord grid, and the
// Cartesian grid of the uniform-disk hard-occulter integrator.
import Foundation

/// Stellar-disk sampling helpers mirroring the Browser `occulterCircle.ts` `clampGridRes`,
/// `diskMidpoint.ts` `integrateDiskMidpoint`, and `transitTransmission.ts`.
enum DiskIntegration {
  /// Mirrors the Browser `clampGridRes`: a finite authored value is floored, an absent or
  /// non-finite one takes the path-specific fallback, and the result is clamped to
  /// `[minimum, 1024]`. Non-positive values are not rejected; they clamp up to the minimum.
  static func resolution(_ raw: Double?, fallback: Int, minimum: Int = 60) -> Int {
    let value = raw.flatMap { $0.isFinite ? $0 : nil } ?? Double(fallback)
    return Int(max(Double(minimum), min(1024, value.rounded(.down))))
  }

  /// Visits every cell of the Browser `integrateDiskMidpoint` chord grid of a star.
  ///
  /// Rows are outer and chords inner: row `iy` sits at `y = −R + (iy + 0.5) dy` with
  /// `dy = 2R / N`, rows without a positive half-chord are skipped, and each row is split into N
  /// cells of width `dx = 2 x_max / N`. The visitor receives the cell centre, its `mu`, and its
  /// area `dx · dy`, so callers keep the Browser's `weighted = intensity · area` order.
  static func forEachChordCell(
    starRadius: Double, resolution: Int,
    _ visit: (_ x: Double, _ y: Double, _ mu: Double, _ area: Double) -> Void
  ) {
    let dy = 2 * starRadius / Double(resolution)
    let r2 = starRadius * starRadius
    for iy in 0..<resolution {
      let y = -starRadius + (Double(iy) + 0.5) * dy
      let y2 = y * y
      let xMax = sqrt(max(0, r2 - y2))
      guard xMax > 0 else { continue }
      let dx = 2 * xMax / Double(resolution)
      let area = dx * dy
      for ix in 0..<resolution {
        let x = -xMax + (Double(ix) + 0.5) * dx
        visit(x, y, sqrt(max(0, 1 - (x * x + y2) / r2)), area)
      }
    }
  }

  /// Returns the visible fraction of a uniform stellar disk behind opaque circles, as the Browser
  /// `fluxStarWithTransmissiveOcculters` evaluates it without a limb-darkening law.
  ///
  /// One unpatched circular occulter uses analytic overlap, resolving arbitrarily small disks.
  /// Otherwise the N×N Cartesian grid spans `[−R, R]²` with `step = 2R / N`, N the clamped `gridRes` with
  /// fallback 256 and minimum 32; cells outside the disk are skipped. The intensity is the
  /// "multiply" patch factor (cells with a non-positive one are skipped), a cell is blocked when
  /// `hypot(x − dx, y − dy) <= r` for any occulter, and the result is `clamp01(ΣI·T / ΣI)`, or 1
  /// for a degenerate star or a non-positive or non-finite sum.
  static func uniformDiskHardOcculterFlux(
    starRadius: Double, occulters: [(x: Double, y: Double, radius: Double)],
    patches: [StellarSurface.PreparedPatch], gridResolution: Double?
  ) -> Double {
    guard starRadius.isFinite, starRadius > 0 else { return 1 }
    let circles = reachingCircles(occulters, starRadius: starRadius)
    guard !circles.isEmpty else { return 1 }
    if circles.count == 1, patches.isEmpty {
      let circle = circles[0]
      let area = CircularOccultation.overlapArea(
        radius: 1, circle.radius / starRadius,
        separation: hypot(circle.x, circle.y) / starRadius)
      return min(1, max(0, 1 - area / .pi))
    }
    let count = resolution(gridResolution, fallback: 256, minimum: 32)
    let step = 2 * starRadius / Double(count)
    let half = 0.5 * step
    let r2 = starRadius * starRadius
    var sumI = 0.0
    var sumIT = 0.0
    for iy in 0..<count {
      let y = -starRadius + half + Double(iy) * step
      let y2 = y * y
      for ix in 0..<count {
        let x = -starRadius + half + Double(ix) * step
        guard x * x + y2 <= r2 else { continue }
        let intensity =
          patches.isEmpty ? 1 : StellarSurface.patchFactor(x: x, y: y, prepared: patches)
        guard intensity.isFinite, intensity > 0 else { continue }
        sumI += intensity
        if !circles.contains(where: { hypot(x - $0.x, y - $0.y) <= $0.radius }) {
          sumIT += intensity
        }
      }
    }
    guard sumI > 0, sumI.isFinite, sumIT.isFinite else { return 1 }
    return min(1, max(0, sumIT / sumI))
  }

  /// Keeps the valid hard disks that can block a cell of the star.
  ///
  /// A circle farther than `R + r` (with a rounding margin) blocks no cell, and without any
  /// blocked cell `ΣI·T` equals `ΣI` exactly, so dropping it cannot change the result.
  private static func reachingCircles(
    _ occulters: [(x: Double, y: Double, radius: Double)], starRadius: Double
  ) -> [(x: Double, y: Double, radius: Double)] {
    occulters.filter {
      $0.x.isFinite && $0.y.isFinite && $0.radius.isFinite && $0.radius > 0
        && hypot($0.x, $0.y) <= (starRadius + $0.radius) * (1 + 1e-12)
    }
  }
}
