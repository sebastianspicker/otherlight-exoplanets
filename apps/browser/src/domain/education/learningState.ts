/**
 * Resolves the active lesson phase from learning state and signals.
 */
import type { LearningState, BrowserScenarioDraft } from "../model/types";
import { clampIndex, currentStepPhases } from "./engineSupport";
import { DEFAULT_LESSON_ID, getLessonById } from "./lessons";

type ActiveLesson = NonNullable<ReturnType<typeof getLessonById>>;

function defaultLearningState(lessonId: string, tSec: number): LearningState {
  return {
    lessonId,
    stepIndex: 0,
    phaseIndex: 0,
    passedStepIds: [],
    updatedAtSec: tSec,
  };
}

function fallbackLearningState(prev: LearningState | undefined, tSec: number): LearningState {
  return prev ? { ...prev } : defaultLearningState(DEFAULT_LESSON_ID, tSec);
}

function learningStateAlreadyNormalized(
  prev: LearningState,
  safeStepIndex: number,
  safePhaseIndex: number,
): boolean {
  const prevPhaseIndex = prev.phaseIndex ?? 0;
  return (
    prev.stepIndex === safeStepIndex && prevPhaseIndex === safePhaseIndex && Array.isArray(prev.passedStepIds)
  );
}

function sanitizedLearningState(
  prev: LearningState,
  safeStepIndex: number,
  safePhaseIndex: number,
  passedStepIds: string[],
): LearningState {
  return {
    lessonId: prev.lessonId,
    stepIndex: safeStepIndex,
    phaseIndex: safePhaseIndex,
    passedStepIds,
    lastScore: prev.lastScore,
    updatedAtSec: prev.updatedAtSec,
  };
}

// A phase index that belonged to a clamped (missing) step, or lies beyond the step's own
// phases, restarts that step instead of jumping to its last phase.
function safePhaseIndexFor(prev: LearningState, lesson: ActiveLesson, safeStepIndex: number): number {
  if (!Number.isFinite(prev.stepIndex) || safeStepIndex !== Math.trunc(prev.stepIndex)) return 0;
  const maxPhaseIndex = Math.max(currentStepPhases(lesson, safeStepIndex).length - 1, 0);
  const phaseIndex = prev.phaseIndex ?? 0;
  return Number.isFinite(phaseIndex) && phaseIndex >= 0 && phaseIndex <= maxPhaseIndex
    ? Math.trunc(phaseIndex)
    : 0;
}

function normalizedLearningState(prev: LearningState, lesson: ActiveLesson): LearningState {
  const maxStepIndex = Math.max(lesson.steps.length - 1, 0);
  const safeStepIndex = clampIndex(prev.stepIndex, maxStepIndex);
  const safePhaseIndex = safePhaseIndexFor(prev, lesson, safeStepIndex);
  const passedStepIds = Array.isArray(prev.passedStepIds) ? prev.passedStepIds : [];

  if (learningStateAlreadyNormalized(prev, safeStepIndex, safePhaseIndex)) {
    return prev;
  }

  return sanitizedLearningState(prev, safeStepIndex, safePhaseIndex, passedStepIds);
}

/**
 * Clamps a restored or stored learning state to its own lesson's step and phase ranges.
 * Unknown lessons are returned unchanged.
 */
export function normalizeLearningState(state: LearningState): LearningState {
  const lesson = getLessonById(state.lessonId);
  return lesson ? normalizedLearningState(state, lesson) : state;
}

export function resolveLearningState(system: BrowserScenarioDraft, tSec: number): LearningState {
  const did = system.didactics;
  const lesson = getLessonById(did?.activeLessonId ?? DEFAULT_LESSON_ID);
  const prev = did?.learningState;
  if (!lesson) {
    // Unknown lesson ID: preserve previous state unchanged to avoid silent reset every frame.
    return fallbackLearningState(prev, tSec);
  }
  if (!prev || prev.lessonId !== lesson.id) {
    return defaultLearningState(lesson.id, tSec);
  }
  return normalizedLearningState(prev, lesson);
}
