// Converts Browser V4 stellar variability, stellar-surface, and stellar spin blocks to and from
// native models.
import Foundation

/// Reads the Browser V4 `photometry.stellarVariability`, `photometry.stellarSurface`, and primary
/// star `spin` blocks.
extension BrowserV4Import {
  /// Reads an enabled `photometry.stellarVariability` block with the Browser defaults.
  ///
  /// A disabled or absent block yields nil. Absent or non-numeric amplitudes, offsets, and the
  /// constant are 0; a flare or pulsation block is kept only when enabled, the flare rise and decay
  /// default to 300 s and 1200 s with the Browser floor of 1e-6 s, and pulsation modes without a
  /// finite non-zero amplitude and a positive period are dropped as the Browser skips them.
  /// `phaseModel` is accepted and ignored, as in the Browser.
  static func stellarVariability(_ value: BrowserV4JSONValue?) -> StellarVariability? {
    guard let value, value.isEnabled else { return nil }
    return StellarVariability(
      beamingAmplitude: value["beamingAmp"]?.finiteNumber ?? 0,
      ellipsoidalAmplitude: value["ellipsoidalAmp"]?.finiteNumber ?? 0,
      beamingOffsetRadians: value["beamingOffset"]?.finiteNumber ?? 0,
      ellipsoidalOffsetRadians: value["ellipsoidalOffset"]?.finiteNumber ?? 0,
      constant: value["constant"]?.finiteNumber ?? 0, flare: flare(value["flare"]),
      pulsations: pulsations(value["pulsations"]),
      clampMin: value["clampMin"]?.finiteNumber, clampMax: value["clampMax"]?.finiteNumber,
      physicalAmplitudes: value["physicalAmplitudes"] == .bool(true),
      beamingAlpha: value["beamingAlpha"]?.finiteNumber,
      ellipsoidalAlpha: value["ellipsoidalAlpha"]?.finiteNumber)
  }

  /// Reads an enabled flare block; rise and decay default to 300 s and 1200 s, floored at 1e-6 s.
  static func flare(_ value: BrowserV4JSONValue?) -> StellarVariability.Flare? {
    guard let value, value.isEnabled else { return nil }
    return StellarVariability.Flare(
      peakSeconds: value["tPeakSec"]?.finiteNumber ?? 0,
      amplitude: value["amp"]?.finiteNumber ?? 0,
      riseSeconds: max(1e-6, value["riseSec"]?.finiteNumber ?? 300),
      decaySeconds: max(1e-6, value["decaySec"]?.finiteNumber ?? 1200))
  }

  /// Reads the modes of an enabled pulsation block, dropping those the Browser skips.
  static func pulsations(_ value: BrowserV4JSONValue?) -> [StellarVariability.PulsationMode]? {
    guard let value, value.isEnabled else { return nil }
    guard case .array(let modes)? = value["modes"] else { return [] }
    return modes.compactMap(pulsationMode)
  }

  /// Reads one pulsation mode, or nil without a finite non-zero amplitude and a positive period.
  static func pulsationMode(_ mode: BrowserV4JSONValue) -> StellarVariability.PulsationMode? {
    let amplitude = mode["amp"]?.finiteNumber ?? 0
    guard amplitude != 0, let period = mode["periodSec"]?.finiteNumber, period > 0 else {
      return nil
    }
    return StellarVariability.PulsationMode(
      amplitude: amplitude, periodSeconds: period,
      phaseRadians: mode["phaseRad"]?.finiteNumber ?? 0)
  }

  /// Reads an enabled `photometry.stellarSurface` block.
  ///
  /// A disabled or absent block yields nil. The granulation timescale and activity-cycle period
  /// take the Browser floor of 1 s, a non-positive rotation period is dropped as the Browser
  /// ignores it, and `useSurfacePatches` and `differentialRotationK` are preserved.
  static func stellarSurface(_ value: BrowserV4JSONValue?) -> StellarSurfaceActivity? {
    guard let value, value.isEnabled else { return nil }
    var usesSurfacePatches: Bool?
    if case .bool(let flag)? = value["useSurfacePatches"] { usesSurfacePatches = flag }
    return StellarSurfaceActivity(
      granulationSigma: value["granulationSigma"]?.finiteNumber,
      granulationTimescaleSeconds: value["granulationTimescaleSec"]?.finiteNumber.map {
        max(1, $0)
      },
      activityCyclePeriodSeconds: value["activityCyclePeriodSec"]?.finiteNumber.map { max(1, $0) },
      activityCycleAmplitude: value["activityCycleAmp"]?.finiteNumber,
      rotationPeriodSeconds: value["rotationPeriodSec"]?.finiteNumber.flatMap { $0 > 0 ? $0 : nil },
      usesSurfacePatches: usesSurfacePatches,
      differentialRotationK: value["differentialRotationK"]?.finiteNumber)
  }

  /// Reads the primary star's `spin` block.
  ///
  /// As the Browser ignores them, a non-positive or non-finite `rotationPeriodSec` and a
  /// non-finite `axisPositionAngle` are dropped; a finite `obliquity` is preserved for export.
  /// A block without any of the three yields nil.
  static func stellarSpin(_ value: BrowserV4JSONValue?) -> StellarSpin? {
    let spin = StellarSpin(
      rotationPeriodSeconds: value?["rotationPeriodSec"]?.finiteNumber.flatMap {
        $0 > 0 ? $0 : nil
      },
      axisPositionAngleRadians: value?["axisPositionAngle"]?.finiteNumber,
      obliquityRadians: value?["obliquity"]?.finiteNumber)
    return spin == StellarSpin() ? nil : spin
  }
}

/// Writes the Browser V4 `photometry.stellarVariability`, `photometry.stellarSurface`, and primary
/// star `spin` blocks.
extension BrowserV4Export {
  /// Encodes a stellar variability model as a `photometry.stellarVariability` block.
  ///
  /// Non-finite values are written as 0 (or omitted when optional) to keep the JSON valid.
  static func stellarVariability(_ model: StellarVariability) -> BrowserV4JSONValue {
    var members: [String: BrowserV4JSONValue] = [
      "enabled": .bool(model.enabled), "beamingAmp": finite(model.beamingAmplitude),
      "ellipsoidalAmp": finite(model.ellipsoidalAmplitude),
      "beamingOffset": finite(model.beamingOffsetRadians),
      "ellipsoidalOffset": finite(model.ellipsoidalOffsetRadians),
      "constant": finite(model.constant),
      "physicalAmplitudes": .bool(model.physicalAmplitudes),
    ]
    if let flare = model.flare {
      members["flare"] = .object([
        "enabled": .bool(true), "tPeakSec": finite(flare.peakSeconds),
        "amp": finite(flare.amplitude), "riseSec": finite(flare.riseSeconds),
        "decaySec": finite(flare.decaySeconds),
      ])
    }
    if let modes = model.pulsations {
      members["pulsations"] = .object([
        "enabled": .bool(true),
        "modes": .array(
          modes.map {
            .object([
              "amp": finite($0.amplitude), "periodSec": finite($0.periodSeconds),
              "phaseRad": finite($0.phaseRadians),
            ])
          }),
      ])
    }
    let optionals = [
      ("clampMin", model.clampMin), ("clampMax", model.clampMax),
      ("beamingAlpha", model.beamingAlpha), ("ellipsoidalAlpha", model.ellipsoidalAlpha),
    ]
    for (key, value) in optionals {
      if let value, value.isFinite { members[key] = .number(value) }
    }
    return .object(members)
  }

  /// Encodes stellar-surface activity as an enabled `photometry.stellarSurface` block.
  static func stellarSurface(_ surface: StellarSurfaceActivity) -> BrowserV4JSONValue {
    var members: [String: BrowserV4JSONValue] = ["enabled": .bool(true)]
    let optionals = [
      ("granulationSigma", surface.granulationSigma),
      ("granulationTimescaleSec", surface.granulationTimescaleSeconds),
      ("activityCyclePeriodSec", surface.activityCyclePeriodSeconds),
      ("activityCycleAmp", surface.activityCycleAmplitude),
      ("rotationPeriodSec", surface.rotationPeriodSeconds),
      ("differentialRotationK", surface.differentialRotationK),
    ]
    for (key, value) in optionals {
      if let value, value.isFinite { members[key] = .number(value) }
    }
    if let flag = surface.usesSurfacePatches { members["useSurfacePatches"] = .bool(flag) }
    return .object(members)
  }

  /// Encodes a stellar spin as the primary star's `spin` block, or nil when it has no finite field.
  static func stellarSpin(_ spin: StellarSpin) -> BrowserV4JSONValue? {
    var members: [String: BrowserV4JSONValue] = [:]
    let optionals = [
      ("rotationPeriodSec", spin.rotationPeriodSeconds),
      ("axisPositionAngle", spin.axisPositionAngleRadians), ("obliquity", spin.obliquityRadians),
    ]
    for (key, value) in optionals {
      if let value, value.isFinite { members[key] = .number(value) }
    }
    return members.isEmpty ? nil : .object(members)
  }

  /// Returns a finite value as a JSON number and replaces a non-finite one with 0.
  private static func finite(_ value: Double) -> BrowserV4JSONValue {
    .number(value.isFinite ? value : 0)
  }
}
