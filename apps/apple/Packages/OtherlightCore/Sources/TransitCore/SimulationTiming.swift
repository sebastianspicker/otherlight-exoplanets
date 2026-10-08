// Solves transit centers and contacts on the authored Kepler trajectory.
import Foundation

/// Defines the reference epoch, period and duration for the unperturbed transit sequence.
struct TransitReferenceEphemeris: Sendable {
  var epochSeconds: Double
  var periodSeconds: Double
  var durationSeconds: Double
}

/// Stores one connected transit interval and its minimum-separation center.
struct SolvedTransitEvent: Sendable {
  var centerSeconds: Double
  var ingressSeconds: Double
  var egressSeconds: Double
  var impactParameterMetres: Double
  var durationSeconds: Double { egressSeconds - ingressSeconds }
}

/// Couples the chart residual with the event diagnostics that produced it.
struct SimulationTimingSample: Sendable {
  var signal: TransitTimingSignal
  var diagnostics: TransitTimingDiagnostics
}

/// Selects the relative trajectory evaluated by the shared event solver.
private enum TransitBody: Equatable {
  case planet
  case moon
}

/// Bounded event solving and immutable-scenario caches for Education timing.
extension SimulationEngine {
  /// Solves the moonless reference transit and stores its center and contact duration.
  static func referenceEphemeris(for scenario: EducationScenarioV4) -> TransitReferenceEphemeris? {
    guard scenario.mode != .detachedBinaryLab else { return nil }
    let period = scenario.planet.orbit.periodSeconds
    guard period.isFinite, period > 0 else { return nil }
    var referenceScenario = scenario
    referenceScenario.moon = nil
    guard
      let event = solveTransitEvent(
        scenario: referenceScenario, body: .planet, centerNearSeconds: scenario.epochSeconds,
        // Pad the reference search so conjunctions near either half-period edge
        // have an interior minimum bracket. The ephemeris retains the authored period.
        samplingPeriodSeconds: 1.2 * period)
    else { return nil }
    return TransitReferenceEphemeris(
      epochSeconds: event.centerSeconds, periodSeconds: period,
      durationSeconds: event.durationSeconds)
  }

  /// Returns the cached or solved planet timing and the moon event containing this query, if any.
  mutating func timingSample(at absoluteSeconds: Double) -> SimulationTimingSample {
    var diagnostics = moonTimingDiagnostics(at: absoluteSeconds)
    guard let reference = transitReferenceCache,
      absoluteSeconds.isFinite,
      reference.periodSeconds.isFinite, reference.periodSeconds > 0
    else { return .init(signal: .unavailable, diagnostics: diagnostics) }

    let cycleValue = ((absoluteSeconds - reference.epochSeconds) / reference.periodSeconds)
      .rounded()
    guard cycleValue.isFinite, cycleValue > Double(Int.min), cycleValue < Double(Int.max) else {
      return .init(
        signal: .unavailable(
          referenceEpochSeconds: reference.epochSeconds,
          referencePeriodSeconds: reference.periodSeconds), diagnostics: diagnostics)
    }
    let transitNumber = Int(cycleValue)
    let predictedCenter = reference.epochSeconds + Double(transitNumber) * reference.periodSeconds
    guard predictedCenter.isFinite else {
      return .init(
        signal: .unavailable(
          referenceEpochSeconds: reference.epochSeconds,
          referencePeriodSeconds: reference.periodSeconds), diagnostics: diagnostics)
    }

    let event: SolvedTransitEvent
    if let cache = solvedTransitCache, cache.number == transitNumber {
      event = cache.event
    } else {
      guard
        let solved = Self.solveTransitEvent(
          scenario: scenario, body: .planet, centerNearSeconds: predictedCenter,
          samplingPeriodSeconds: reference.periodSeconds)
      else {
        return .init(
          signal: .unavailable(
            referenceEpochSeconds: reference.epochSeconds,
            referencePeriodSeconds: reference.periodSeconds), diagnostics: diagnostics)
      }
      event = solved
      solvedTransitCache = (transitNumber, solved)
    }

    diagnostics.planetTransitCenterSec = event.centerSeconds
    diagnostics.planetTransitDurationSec = event.durationSeconds
    diagnostics.planetIngressSec = event.ingressSeconds
    diagnostics.planetEgressSec = event.egressSeconds
    diagnostics.planetDurationVariationSec = event.durationSeconds - reference.durationSeconds

    let durationVariation = event.durationSeconds - reference.durationSeconds
    let signal = TransitTimingSignal.solved(
      transitNumber: transitNumber, ephemerisEpochSeconds: reference.epochSeconds,
      ephemerisPeriodSeconds: reference.periodSeconds, calculatedSeconds: predictedCenter,
      observedSeconds: event.centerSeconds, durationVariationSeconds: durationVariation)
    return SimulationTimingSample(signal: signal, diagnostics: diagnostics)
  }

  /// Computes moon contacts independently of whether the planet has a reference transit.
  private mutating func moonTimingDiagnostics(at absoluteSeconds: Double)
    -> TransitTimingDiagnostics
  {
    var diagnostics = TransitTimingDiagnostics()
    if scenario.moon != nil {
      let moonEvent: SolvedTransitEvent?
      if let cached = solvedMoonTransitCache,
        absoluteSeconds >= cached.ingressSeconds, absoluteSeconds <= cached.egressSeconds
      {
        moonEvent = cached
      } else {
        moonEvent = Self.solveTransitEvent(
          scenario: scenario, body: .moon, containingSeconds: absoluteSeconds,
          samplingPeriodSeconds: scenario.planet.orbit.periodSeconds)
        solvedMoonTransitCache = moonEvent
      }
      if let moonEvent {
        diagnostics.moonTransitCenterSec = moonEvent.centerSeconds
        diagnostics.moonTransitDurationSec = moonEvent.durationSeconds
        diagnostics.moonIngressSec = moonEvent.ingressSeconds
        diagnostics.moonEgressSec = moonEvent.egressSeconds
      }
    }
    return diagnostics
  }

  /// Finds the lowest front-side separation in the predicted cycle using eccentric-anomaly knots.
  private static func solveTransitEvent(
    scenario: EducationScenarioV4, body: TransitBody, centerNearSeconds: Double,
    samplingPeriodSeconds: Double
  ) -> SolvedTransitEvent? {
    let bodyRadius = body == .planet ? scenario.planet.radiusMetres : scenario.moon?.radiusMetres
    guard let bodyRadius else { return nil }
    let contactRadius = scenario.star.radiusMetres + bodyRadius
    let period = samplingPeriodSeconds
    guard centerNearSeconds.isFinite, contactRadius.isFinite, contactRadius > 0,
      period.isFinite, period > 0
    else { return nil }

    let times = centerSearchKnots(
      scenario: scenario, body: body, center: centerNearSeconds, period: period)
    guard times.count >= 3 else { return nil }
    let values = times.map {
      contactValue(scenario: scenario, body: body, at: $0, contactRadius: contactRadius)
    }
    var bestCenter: Double?
    var bestValue = Double.infinity
    for index in 1..<(times.count - 1) {
      let value = values[index]
      guard value.isFinite, value <= values[index - 1], value <= values[index + 1] else { continue }
      let candidate = boundedMinimum(
        { separationSquared(scenario: scenario, body: body, at: $0) },
        lower: times[index - 1], upper: times[index + 1])
      let candidateValue = separationSquared(scenario: scenario, body: body, at: candidate)
      if candidateValue < bestValue {
        bestCenter = candidate
        bestValue = candidateValue
      }
    }
    guard let center = bestCenter, bestValue < contactRadius * contactRadius else { return nil }
    return solveEventAroundCenter(
      scenario: scenario, body: body, center: center, contactRadius: contactRadius,
      samplingPeriodSeconds: period)
  }

  /// Solves the connected transit interval containing an already in-transit query.
  private static func solveTransitEvent(
    scenario: EducationScenarioV4, body: TransitBody, containingSeconds querySeconds: Double,
    samplingPeriodSeconds: Double
  ) -> SolvedTransitEvent? {
    guard querySeconds.isFinite, samplingPeriodSeconds.isFinite, samplingPeriodSeconds > 0,
      let bodyRadius = body == .planet ? scenario.planet.radiusMetres : scenario.moon?.radiusMetres
    else { return nil }
    let contactRadius = scenario.star.radiusMetres + bodyRadius
    guard contactRadius.isFinite, contactRadius > 0,
      contactValue(scenario: scenario, body: body, at: querySeconds, contactRadius: contactRadius)
        < 0
    else { return nil }
    guard
      let ingress = isolateContact(
        scenario: scenario, body: body, seedSeconds: querySeconds, direction: -1,
        contactRadius: contactRadius, searchDistance: samplingPeriodSeconds / 2),
      let egress = isolateContact(
        scenario: scenario, body: body, seedSeconds: querySeconds, direction: 1,
        contactRadius: contactRadius, searchDistance: samplingPeriodSeconds / 2),
      egress > ingress,
      let center = minimumSeparation(
        scenario: scenario, body: body, lower: ingress, upper: egress)
    else { return nil }
    let state = relativeState(scenario: scenario, body: body, at: center)
    return SolvedTransitEvent(
      centerSeconds: center, ingressSeconds: ingress, egressSeconds: egress,
      impactParameterMetres: hypot(state.position.x, state.position.y))
  }

  /// Solves ingress and egress around a selected center and returns its projected separation.
  private static func solveEventAroundCenter(
    scenario: EducationScenarioV4, body: TransitBody, center: Double, contactRadius: Double,
    samplingPeriodSeconds: Double
  ) -> SolvedTransitEvent? {
    let value = contactValue(
      scenario: scenario, body: body, at: center, contactRadius: contactRadius)
    guard value < 0,
      let ingress = isolateContact(
        scenario: scenario, body: body, seedSeconds: center, direction: -1,
        contactRadius: contactRadius, searchDistance: samplingPeriodSeconds / 2),
      let egress = isolateContact(
        scenario: scenario, body: body, seedSeconds: center, direction: 1,
        contactRadius: contactRadius, searchDistance: samplingPeriodSeconds / 2),
      egress > ingress
    else { return nil }
    let state = relativeState(scenario: scenario, body: body, at: center)
    return SolvedTransitEvent(
      centerSeconds: center, ingressSeconds: ingress, egressSeconds: egress,
      impactParameterMetres: hypot(state.position.x, state.position.y))
  }

  /// Creates sorted orbital-time knots with denser sampling near high-eccentricity periapsis.
  private static func centerSearchKnots(
    scenario: EducationScenarioV4, body: TransitBody, center: Double, period: Double
  ) -> [Double] {
    guard let orbit = body == .planet ? scenario.planet.orbit : scenario.moon?.orbit else {
      return []
    }
    let rate = 2 * Double.pi / orbit.periodSeconds
    let elapsedAtCenter = center - scenario.epochSeconds
    let meanAtCenter = orbit.meanAnomalyAtEpochRadians + rate * elapsedAtCenter
    let wrappedMean = KeplerOrbit.wrapToPi(meanAtCenter)
    let eccentricCenter = KeplerOrbit.eccentricAnomaly(
      mean: wrappedMean, eccentricity: orbit.eccentricity)
    let centerMean = eccentricCenter - orbit.eccentricity * sin(eccentricCenter)
    guard rate.isFinite, rate > 0, eccentricCenter.isFinite, centerMean.isFinite else { return [] }
    let lower = center - period / 2
    let upper = center + period / 2
    let count = 256
    var knots = [lower, upper, center]
    for index in 0...count {
      let eccentric =
        eccentricCenter - 2 * Double.pi + 4 * Double.pi * Double(index) / Double(count)
      let mean = eccentric - orbit.eccentricity * sin(eccentric)
      let time = center + (mean - centerMean) / rate
      if time > lower, time < upper, time.isFinite { knots.append(time) }
    }
    return knots.sorted()
  }

  /// Returns squared projected separation, or infinity for a body behind the star.
  private static func separationSquared(
    scenario: EducationScenarioV4, body: TransitBody, at time: Double
  ) -> Double {
    let state = relativeState(scenario: scenario, body: body, at: time)
    guard state.position.z > 0 else { return .infinity }
    return state.position.x * state.position.x + state.position.y * state.position.y
  }

  /// Returns a signed value negative only while the body is in front and inside contact radius.
  private static func contactValue(
    scenario: EducationScenarioV4, body: TransitBody, at time: Double, contactRadius: Double
  ) -> Double {
    let position = relativeState(scenario: scenario, body: body, at: time).position
    return max(hypot(position.x, position.y) - contactRadius, -position.z)
  }

  /// Selects the body's position and velocity relative to the star at an absolute time.
  private static func relativeState(
    scenario: EducationScenarioV4, body: TransitBody, at time: Double
  ) -> (position: Vector3, velocity: Vector3) {
    let state = SimulationEngine.kinematics(of: scenario, elapsed: time - scenario.epochSeconds)
    switch body {
    case .planet: return (state.planet - state.star, state.planetVelocity - state.starVelocity)
    case .moon:
      guard let moon = state.moon, let moonVelocity = state.moonVelocity else {
        return (.zero, .zero)
      }
      return (moon - state.star, moonVelocity - state.starVelocity)
    }
  }

  /// Isolates the nearest outward contact with a Lipschitz bound and finite work budget.
  private static func isolateContact(
    scenario: EducationScenarioV4, body: TransitBody, seedSeconds: Double, direction: Double,
    contactRadius: Double, searchDistance: Double
  ) -> Double? {
    let speed = relativeSpeedBound(scenario: scenario, body: body)
    guard speed.isFinite, speed > 0, searchDistance.isFinite, searchDistance > 0 else { return nil }
    let tolerance = max(1e-3, 8 * Double.ulpOfOne * max(abs(seedSeconds), searchDistance))
    var evaluations = 0
    var exhausted = false
    /// Evaluates one contact sample against the bounded work allowance.
    func value(_ offset: Double) -> Double {
      evaluations += 1
      guard evaluations <= 20_000 else {
        exhausted = true
        return .nan
      }
      let time = seedSeconds + direction * offset
      let result = contactValue(
        scenario: scenario, body: body, at: time, contactRadius: contactRadius)
      if !result.isFinite { exhausted = true }
      return result
    }
    /// Visits intervals outward in order, skipping only intervals certified fully in transit.
    func search(
      _ a: Double, _ fa: Double, _ b: Double, _ fb: Double, _ depth: Int
    ) -> (Double, Double)? {
      guard !exhausted, fa.isFinite, fb.isFinite, depth < 64 else {
        if depth >= 64 { exhausted = true }
        return nil
      }
      let width = b - a
      if max(fa, fb) + speed * width / 2 < 0 { return nil }
      if width <= tolerance {
        return fa < 0 && fb >= 0 ? (a, b) : nil
      }
      let midpoint = a + width / 2
      guard midpoint > a, midpoint < b else {
        exhausted = true
        return nil
      }
      let fm = value(midpoint)
      return search(a, fa, midpoint, fm, depth + 1)
        ?? search(midpoint, fm, b, fb, depth + 1)
    }
    let initial = value(0)
    guard initial < 0 else { return nil }
    let endpoint = value(searchDistance)
    guard let bracket = search(0, initial, searchDistance, endpoint, 0), !exhausted else {
      return nil
    }
    return seedSeconds + direction * (bracket.0 + (bracket.1 - bracket.0) / 2)
  }

  /// Bounds projected relative speed using orbital maxima and any moon orientation drift.
  private static func relativeSpeedBound(
    scenario: EducationScenarioV4, body: TransitBody
  ) -> Double {
    let planetOrbit = scenario.planet.orbit
    let outer = orbitalSpeedBound(planetOrbit)
    guard let moon = scenario.moon else { return outer }
    let planetMass = scenario.planet.massKilograms
    let moonMass = moon.massKilograms
    let bothMassive =
      SimulationEngine.isFinitePositive(planetMass)
      && SimulationEngine.isFinitePositive(moonMass)
    let totalMass = bothMassive ? planetMass + moonMass : 0
    let moonFraction = bothMassive ? moonMass / totalMass : 0
    let internalFraction: Double
    switch body {
    case .planet: internalFraction = moonFraction
    case .moon: internalFraction = bothMassive ? planetMass / totalMass : 1
    }
    let drift = moon.orientationDrift
    let driftRate =
      drift.map {
        [
          $0.omegaDotRadiansPerSecond, $0.inclinationDotRadiansPerSecond,
          $0.argumentOfPeriapsisDotRadiansPerSecond,
        ].reduce(0) { $0 + ($1.isFinite ? abs($1) : 0) }
      } ?? 0
    let internalSpeed =
      orbitalSpeedBound(moon.orbit)
      + driftRate * moon.orbit.semiMajorAxisMetres * (1 + moon.orbit.eccentricity)
    return (outer + internalFraction * internalSpeed) * (1 + 32 * Double.ulpOfOne)
  }

  /// Computes the maximum Kepler speed at periapsis for a validated elliptic orbit.
  private static func orbitalSpeedBound(_ orbit: KeplerOrbit) -> Double {
    let eccentricity = orbit.eccentricity
    guard orbit.semiMajorAxisMetres.isFinite, orbit.semiMajorAxisMetres >= 0,
      orbit.periodSeconds.isFinite, orbit.periodSeconds > 0,
      eccentricity.isFinite, eccentricity >= 0, eccentricity < 1
    else { return .infinity }
    return orbit.semiMajorAxisMetres * (2 * Double.pi / orbit.periodSeconds)
      * sqrt((1 + eccentricity) / (1 - eccentricity))
  }

  /// Finds the least projected separation inside one connected contact interval.
  private static func minimumSeparation(
    scenario: EducationScenarioV4, body: TransitBody, lower: Double, upper: Double
  ) -> Double? {
    guard upper > lower else { return nil }
    let count = 128
    let times = (0...count).map { lower + (upper - lower) * Double($0) / Double(count) }
    let values = times.map { separationSquared(scenario: scenario, body: body, at: $0) }
    var bestTime: Double?
    var bestValue = Double.infinity
    for index in 1..<count where values[index].isFinite {
      guard values[index] <= values[index - 1], values[index] <= values[index + 1] else { continue }
      let candidate = boundedMinimum(
        { separationSquared(scenario: scenario, body: body, at: $0) },
        lower: times[index - 1], upper: times[index + 1])
      let value = separationSquared(scenario: scenario, body: body, at: candidate)
      if value < bestValue {
        bestTime = candidate
        bestValue = value
      }
    }
    if let first = values.first, first < bestValue {
      bestTime = lower
      bestValue = first
    }
    if let last = values.last, last < bestValue {
      bestTime = upper
      bestValue = last
    }
    return bestValue.isFinite ? bestTime : nil
  }

  /// Minimizes a bounded scalar function to millisecond time width.
  private static func boundedMinimum(
    _ function: (Double) -> Double, lower: Double, upper: Double
  ) -> Double {
    let ratio = (sqrt(5.0) - 1) / 2
    var a = lower
    var b = upper
    var c = b - ratio * (b - a)
    var d = a + ratio * (b - a)
    var fc = function(c)
    var fd = function(d)
    for _ in 0..<96 {
      if b - a <= 1e-3 { break }
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
