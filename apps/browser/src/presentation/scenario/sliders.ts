/** Synchronizes range controls, numeric displays, and value-change callbacks. */
//
// Optional: slider mirroring for number inputs.

import { clamp, toFiniteNumber } from "../../domain/model/units";
import type { UiRefs } from "../shell/refs";
import { getParamUiMeta, renderParamFieldValidation } from "./paramValidation";
import {
  applyScenarioNormalRanges,
  scenarioNormalRange,
  widenRangeForLoadedValue,
} from "./scenarioControlRanges";

type WireParamSlidersOptions = {
  signal?: AbortSignal;
};

type NumericInputRange = {
  input: HTMLInputElement;
  min: number;
  max: number;
  step: number;
};

type NumericBounds = {
  min: number;
  max: number;
};

function numericBounds(input: HTMLInputElement): NumericBounds | undefined {
  const min = finiteNumberAttribute(input, "min");
  const max = finiteNumberAttribute(input, "max");
  if (min === undefined) return undefined;
  if (max === undefined) return undefined;
  if (max <= min) return undefined;

  return { min, max };
}

function numericStep(input: HTMLInputElement, bounds: NumericBounds): number {
  const fallbackStep = (bounds.max - bounds.min) / 500;
  const step = finiteNumberAttribute(input, "step");
  if (step === undefined) return fallbackStep;
  if (step <= 0) return fallbackStep;
  return step;
}

function numericInputRange(input: HTMLInputElement): NumericInputRange | undefined {
  if (!input.id) return undefined;

  const normalRange = scenarioNormalRange(input.id);
  const bounds = normalRange ?? numericBounds(input);
  if (!bounds) return undefined;

  return {
    input,
    min: bounds.min,
    max: bounds.max,
    step: normalRange?.step ?? numericStep(input, bounds),
  };
}

function dispatchNumberInputEvents(input: HTMLInputElement): void {
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function effectiveRange(range: NumericInputRange): NumericInputRange {
  return widenRangeForLoadedValue(range, range.input);
}

function sliderValueForInput(range: NumericInputRange): string {
  const bounds = effectiveRange(range);
  return String(clamp(toFiniteNumber(range.input.value, bounds.min), bounds.min, bounds.max));
}

function createSliderRow(range: NumericInputRange): { row: HTMLDivElement; slider: HTMLInputElement } {
  const row = document.createElement("div");
  row.className = "row";

  const name = document.createElement("div");
  name.className = "name";
  const meta = getParamUiMeta(range.input);
  name.textContent = meta.unit ? `${meta.label} (${meta.unit})` : meta.label;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.id = `slider-${range.input.id}`;
  slider.setAttribute("aria-label", `Adjust ${meta.label}`);
  if (meta.help) slider.title = meta.help;
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = String(range.step);
  slider.value = sliderValueForInput(range);

  row.appendChild(name);
  row.appendChild(slider);

  return { row, slider };
}

function syncNumberFromSlider(input: HTMLInputElement, slider: HTMLInputElement): void {
  input.value = slider.value;
  dispatchNumberInputEvents(input);
}

// Only the slider thumb follows the number field. The number field keeps the
// exact typed or loaded value; validation reports out-of-range input on change
// and on apply instead of rewriting it mid-keystroke.
function syncSliderFromNumber(range: NumericInputRange, slider: HTMLInputElement): void {
  const value = toFiniteNumber(range.input.value, NaN);
  if (!Number.isFinite(value)) return;

  const bounds = effectiveRange(range);
  slider.min = String(bounds.min);
  slider.max = String(bounds.max);
  slider.value = String(clamp(value, bounds.min, bounds.max));
}

function wireSliderRow(
  range: NumericInputRange,
  root: HTMLElement,
  options: AddEventListenerOptions | undefined,
): void {
  const { row, slider } = createSliderRow(range);

  slider.addEventListener("input", () => syncNumberFromSlider(range.input, slider), options);
  range.input.addEventListener("input", () => syncSliderFromNumber(range, slider), options);

  root.appendChild(row);
}

function clampRangeInput(range: NumericInputRange): void {
  const value = toFiniteNumber(range.input.value, NaN);
  if (!Number.isFinite(value)) return;

  const bounds = effectiveRange(range);
  range.input.value = String(clamp(value, bounds.min, bounds.max));
  range.input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clampInputsToRanges(ranges: NumericInputRange[]): void {
  for (const range of ranges) {
    clampRangeInput(range);
  }
}

export function wireParamSliders(r: UiRefs, options: WireParamSlidersOptions = {}): void {
  if (!r.sliderRootEl) return;

  applyScenarioNormalRanges();
  const eventOptions = options.signal ? { signal: options.signal } : undefined;
  const isOverrideOn = () => Boolean(r.overrideModeEl?.checked);
  const ranges = numberInputsInParamForm().flatMap((input) => {
    const range = numericInputRange(input);
    return range ? [range] : [];
  });

  r.sliderRootEl.replaceChildren();

  for (const range of ranges) {
    wireSliderRow(range, r.sliderRootEl, eventOptions);
  }
  for (const input of numberInputsInParamForm()) {
    input.addEventListener("change", () => renderParamFieldValidation(input), eventOptions);
  }

  r.overrideModeEl?.addEventListener(
    "change",
    () => {
      if (!isOverrideOn()) {
        clampInputsToRanges(ranges);
      }
    },
    eventOptions,
  );
}

function numberInputsInParamForm(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll("#paramForm input[type='number']")) as HTMLInputElement[];
}

function finiteNumberAttribute(
  input: HTMLInputElement,
  attribute: "min" | "max" | "step",
): number | undefined {
  const rawValue = input.getAttribute(attribute);
  if (rawValue === null) return undefined;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : undefined;
}
