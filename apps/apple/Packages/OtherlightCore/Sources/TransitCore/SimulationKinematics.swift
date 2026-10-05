// Places bodies about their barycentres and measures mutual and stellar occultation of disks.
import Foundation

/// Barycentric body placement and disk-occultation kinematics of the Education engine.
extension SimulationEngine {
  /// Holds absolute star, planet, and optional moon states in the system barycentric frame.
  struct SystemKinematics {
    var star: Vector3
    var starVelocity: Vector3
    var planet: Vector3
    var planetVelocity: Vector3
    var moon: Vector3?
    var moonVelocity: Vector3?
  }

  /// Places star, planet, and moon about their barycentres exactly as the Browser V4 snapshot does.
  ///
  /// The planet's authored orbit describes the planet-moon barycentre relative to the star. With
  /// finite positive planet and moon masses the planet is displaced by `-(m_moon / M) * rel_moon`;
  /// with a finite positive star mass the star and its planet system are displaced by
  /// `-(M / (m_star + M)) * rel_planet`. Missing masses disable the respective split.
  static func kinematics(of scenario: EducationScenarioV4, elapsed: Double) -> SystemKinematics {
    let relativePlanet = scenario.planet.orbit.position(at: elapsed)
    let relativePlanetVelocity = scenario.planet.orbit.velocity(at: elapsed)
    var state = SystemKinematics(
      star: .zero, starVelocity: .zero, planet: Vector3.zero + relativePlanet,
      planetVelocity: Vector3.zero + relativePlanetVelocity)
    var relativeMoon: (position: Vector3, velocity: Vector3)?
    if let moon = scenario.moon {
      let rel = (moon.orbit.position(at: elapsed), moon.orbit.velocity(at: elapsed))
      relativeMoon = rel
      state.moon = state.planet + rel.0
      state.moonVelocity = state.planetVelocity + rel.1
    }
    let planetMass = scenario.planet.massKilograms
    guard isFinitePositive(planetMass) else { return state }
    var systemMass = planetMass
    if let relativeMoon, let moonMass = scenario.moon?.massKilograms, isFinitePositive(moonMass) {
      systemMass = planetMass + moonMass
      let fraction = -moonMass / systemMass
      translatePlanetSystem(
        &state, by: Vector3.zero + relativeMoon.position * fraction,
        velocity: Vector3.zero + relativeMoon.velocity * fraction)
    }
    let starMass = scenario.star.massKilograms
    guard isFinitePositive(starMass) else { return state }
    let fraction = -systemMass / (starMass + systemMass)
    let shift = Vector3.zero + relativePlanet * fraction
    let velocityShift = Vector3.zero + relativePlanetVelocity * fraction
    state.star = state.star + shift
    state.starVelocity = state.starVelocity + velocityShift
    translatePlanetSystem(&state, by: shift, velocity: velocityShift)
    return state
  }

  /// Rigidly moves the planet and its moon by the same position and velocity shift.
  static func translatePlanetSystem(
    _ state: inout SystemKinematics, by shift: Vector3, velocity: Vector3
  ) {
    state.planet = state.planet + shift
    state.planetVelocity = state.planetVelocity + velocity
    state.moon = state.moon.map { $0 + shift }
    state.moonVelocity = state.moonVelocity.map { $0 + velocity }
  }

  /// Reports whether a mass can participate in a barycentric split.
  static func isFinitePositive(_ value: Double) -> Bool { value.isFinite && value > 0 }

  /// Holds visible disk fractions and the mutual and secondary-eclipse event measures.
  struct VisibilityFractions {
    var planet: Double
    var moon: Double
    var mutualFraction: Double
    var secondaryEclipseFraction: Double
  }

  /// Multiplies, per body, the unocculted fraction left by each foreground disk, star included.
  ///
  /// `mutualFraction` is the planet-moon overlap relative to the smaller disk regardless of depth;
  /// `secondaryEclipseFraction` is the largest disk fraction hidden by the star alone.
  func visibilityFractions(_ state: SystemKinematics) -> VisibilityFractions {
    let star = (position: state.star, radius: scenario.star.radiusMetres)
    let planet = (position: state.planet, radius: scenario.planet.radiusMetres)
    let moon = state.moon.flatMap { position in
      scenario.moon.map { (position: position, radius: $0.radiusMetres) }
    }
    let planetStar = Self.visibleFraction(of: planet, behind: star)
    var planetVisible = planetStar ?? 1
    var moonStar: Double?
    var moonVisible = 1.0
    var mutual = 0.0
    if let moon {
      moonStar = Self.visibleFraction(of: moon, behind: star)
      moonVisible = (moonStar ?? 1) * (Self.visibleFraction(of: moon, behind: planet) ?? 1)
      planetVisible *= Self.visibleFraction(of: planet, behind: moon) ?? 1
      let smaller = min(planet.radius, moon.radius)
      let overlap = CircularOccultation.overlapArea(
        radius: planet.radius, moon.radius,
        separation: hypot(planet.position.x - moon.position.x, planet.position.y - moon.position.y))
      mutual = smaller > 0 ? overlap / (.pi * smaller * smaller) : 0
    }
    return VisibilityFractions(
      planet: planetVisible, moon: moonVisible, mutualFraction: mutual,
      secondaryEclipseFraction: max(1 - (planetStar ?? 1), 1 - (moonStar ?? 1)))
  }

  /// Returns the visible disk fraction behind one foreground occulter, or nil when it is not in front.
  static func visibleFraction(
    of body: (position: Vector3, radius: Double), behind occulter: (position: Vector3, radius: Double)
  ) -> Double? {
    let area = .pi * body.radius * body.radius
    guard occulter.radius > 0, occulter.position.z > body.position.z, area > 0 else { return nil }
    let overlap = CircularOccultation.overlapArea(
      radius: body.radius, occulter.radius,
      separation: hypot(
        body.position.x - occulter.position.x, body.position.y - occulter.position.y))
    return min(1, max(0, 1 - overlap / area))
  }
}
