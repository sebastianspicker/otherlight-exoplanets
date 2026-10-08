/**
 * Field guide: the physics a learner needs to read the Education figures,
 * one concept per card with its relation and a pointer back into the experiment.
 * Static teaching copy; the relations state their simplifying assumptions.
 */

type Concept = {
  title: string;
  /** Displayed relation (trusted markup) and its spoken equivalent. */
  relation: string;
  relationLabel: string;
  body: string;
  tryIt: string;
};

const CONCEPTS: readonly Concept[] = [
  {
    title: "Transit depth",
    relation: "<i>δ</i> ≈ (<i>R</i><sub>p</sub> / <i>R</i><sub>★</sub>)<sup>2</sup>",
    relationLabel: "Depth is approximately the planet-to-star radius ratio, squared",
    body: "For an opaque planet fully inside a uniformly bright stellar disk, the depth equals the covered area fraction. A Jupiter-size planet in front of a Sun-like star removes about 1 % of the light; an Earth removes about 84 parts per million.",
    tryIt:
      "In the Experiment phase, set B to twice A and compare: the geometric depth estimate grows four-fold; the computed signal also depends on limb darkening and overlap.",
  },
  {
    title: "Limb darkening",
    relation:
      "<i>I</i>(<i>μ</i>) / <i>I</i>(1) = 1 − <i>u</i><sub>1</sub>(1 − <i>μ</i>) − <i>u</i><sub>2</sub>(1 − <i>μ</i>)<sup>2</sup>",
    relationLabel:
      "Quadratic limb-darkening law: relative intensity equals one minus u1 times one minus mu, minus u2 times one minus mu squared",
    body: "Toward the limb we see higher, cooler layers of the photosphere, so the disk fades at its edge. Here <i>μ</i> = cos <i>θ</i>, where <i>θ</i> is the angle between the local surface normal and the line of sight, and <i>u</i><sub>1</sub>, <i>u</i><sub>2</sub> are coefficients fitted for the star and the passband. For a small planet crossing near disk centre, the transit is deeper than the uniform-disk estimate. A chord near the dim limb can instead be shallower.",
    tryIt: "Look at the plate: the stellar disk dims toward its rim.",
  },
  {
    title: "Impact parameter",
    relation: "<i>b</i> = <i>a</i> |cos <i>i</i>| / <i>R</i><sub>★</sub>",
    relationLabel:
      "Impact parameter equals semi-major axis times the absolute value of cosine of inclination, over stellar radius",
    body: "The sky-projected distance of the planet’s path from the stellar centre, in stellar radii, for a circular orbit of radius <i>a</i> seen at inclination <i>i</i> (90° is edge-on). A larger <i>b</i> means a shorter chord; for 1 − <i>R</i><sub>p</sub>/<i>R</i><sub>★</sub> &lt; <i>b</i> &lt; 1 + <i>R</i><sub>p</sub>/<i>R</i><sub>★</sub> the planet grazes the limb; beyond that there is no transit.",
    tryIt: "Lower the orbital inclination under System parameters and watch the transit shorten.",
  },
  {
    title: "Transit duration",
    relation:
      "<i>T</i><sub>14</sub> ≈ (<i>P</i>/π) arcsin[(<i>R</i><sub>★</sub>/<i>a</i>) √((1 + <i>k</i>)<sup>2</sup> − <i>b</i><sup>2</sup>) / sin <i>i</i>]",
    relationLabel:
      "Total duration is approximately P over pi times arcsine of R star over a, times the square root of the difference between the square of one plus k and b squared, over sine i",
    body: "First to fourth contact for a circular orbit with period <i>P</i>, where <i>k</i> = <i>R</i><sub>p</sub>/<i>R</i><sub>★</sub>. Around the same star and at fixed <i>b</i> and <i>k</i>, wider Keplerian orbits are slower, so transits last longer (<i>T</i> ∝ <i>P</i><sup>1/3</sup> when <i>a</i> ≫ <i>R</i><sub>★</sub>).",
    tryIt: "Jump to transit and read the ingress and egress off the time axis.",
  },
  {
    title: "Transit timing",
    relation: "O − C = <i>T</i><sub>obs</sub> − (<i>T</i><sub>0</sub> + <i>nP</i>)",
    relationLabel:
      "Observed minus computed equals observed mid-transit time minus the quantity T zero plus n times P",
    body: "A lone planet on a Keplerian orbit transits on a strict schedule: epoch <i>n</i> falls at <i>T</i><sub>0</sub> + <i>nP</i>. A moon pulls the planet around their common barycentre, so transits arrive slightly early or late; the O − C diagram records that rhythm.",
    tryIt: "Pick an exomoon teaching scenario, set parameter depth to Advanced and open the O-C history.",
  },
  {
    title: "Eclipsing binaries",
    relation: "<i>δ</i><sub>sec</sub> / <i>δ</i><sub>pri</sub> ≈ <i>S</i><sub>2</sub> / <i>S</i><sub>1</sub>",
    relationLabel:
      "Secondary over primary eclipse depth is approximately the ratio of the stars’ surface brightnesses",
    body: "Two stars cover each other twice per orbit. For circular orbits and uniformly bright stellar disks, the same area is hidden at both eclipses, so their depth ratio equals the surface-brightness ratio. Limb darkening can change this relation. <i>S</i><sub>1</sub> belongs to the star hidden at the deeper, primary eclipse (the hotter one), <i>S</i><sub>2</sub> to its companion; in bolometric light <i>S</i> ∝ <i>T</i><sup>4</sup>.",
    tryIt: "Open Guided Labs and pick a binary-star system.",
  },
];

function renderConcept(concept: Concept, index: number): string {
  const number = String(index + 1).padStart(2, "0");
  return `
        <li class="concept">
          <p class="concept__index" aria-hidden="true">${number}</p>
          <h3>${concept.title}</h3>
          <p class="concept__relation" role="math" aria-label="${concept.relationLabel}">${concept.relation}</p>
          <p class="concept__body">${concept.body}</p>
          <p class="concept__try"><span class="concept__try-label">Try it</span> ${concept.tryIt}</p>
        </li>`;
}

export function renderFieldGuide(): string {
  return `
    <section class="field-guide" aria-labelledby="fieldGuideTitle">
      <header class="field-guide__header">
        <p class="kicker">Field guide</p>
        <h2 id="fieldGuideTitle">Reading a light curve</h2>
        <p class="field-guide__lead">
          Six relations behind every figure on this page. Each is the idealised textbook form; the
          Education model adds the effects the notes name.
        </p>
      </header>
      <ol class="field-guide__list" role="list">${CONCEPTS.map(renderConcept).join("")}
      </ol>
    </section>`;
}
