/**
 * The creation workshop's two self-contained control groups, lifted out of
 * App.tsx so they can be rendered and tested on their own. App still owns the
 * state, the brief, and every side effect; these components only draw the
 * choices and report the reader's taps.
 */
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, Eraser, PencilSimple } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { Switch } from "./design/primitives";
import {
  CREATION_INTERACTION_DENSITIES,
  CREATION_LENGTHS,
  CREATION_PHOTO_USES,
  CREATION_SOURCES,
  CREATION_STYLES,
  workshopUsesPhotos,
  type CreationPhotoUse,
  type CreationWorkshopAction,
  type CreationWorkshopState,
} from "./creationWorkshop";

/**
 * One captioned single-choice row. The visible caption is hidden from
 * assistive tech because the Switch already announces the same words as its
 * group name, and the Switch's own root carries the layout class so the row
 * has no extra wrapper between caption and buttons.
 */
function Picker<T extends string>({ label, className, ...rest }: { label: string; className: string } & Omit<ComponentProps<typeof Switch<T>>, "groupLabel" | "variant" | "className">) {
  return (
    <div className="workshop-field">
      <span className="workshop-field-label" aria-hidden="true">{label}</span>
      <Switch<T> variant="underline" groupLabel={label} className={`workshop-picker ${className}`} {...rest} />
    </div>
  );
}

export function WorkshopPickers({ workshop, dispatch }: { workshop: CreationWorkshopState; dispatch: (action: CreationWorkshopAction) => void }) {
  return (
    <>
      <Picker
        label="Start from"
        className="workshop-segment"
        value={workshop.mode}
        onChange={(mode) => dispatch({ type: "set-mode", mode })}
        options={CREATION_SOURCES.map((source) => ({ value: source.id, label: source.label }))}
      />
      <Picker
        label="Spreads"
        className="workshop-lengths"
        value={String(workshop.spreadCount)}
        onChange={(count) => dispatch({ type: "set-spread-count", spreadCount: Number(count) })}
        options={CREATION_LENGTHS.map((count) => ({ value: String(count), label: count, ariaLabel: `${count} spreads` }))}
      />
      <Picker
        label="Style"
        className="workshop-chips"
        value={workshop.visualDirection}
        onChange={(visualDirection) => dispatch({ type: "set-visual-direction", visualDirection })}
        options={CREATION_STYLES.map((style) => ({ value: style, label: style }))}
      />
      <Picker
        label="Interactive layers"
        className="workshop-segment"
        value={workshop.interactionDensity}
        onChange={(interactionDensity) => dispatch({ type: "set-interaction-density", interactionDensity })}
        options={CREATION_INTERACTION_DENSITIES.map((choice) => ({
          value: choice.id,
          label: `${choice.label}${choice.id === "low" || choice.id === "balanced" ? ` · ${choice.count}` : ""}`,
          ariaLabel: `${choice.label}: ${choice.count} per spread`,
        }))}
      />
      {/* Photo use sits at the END of the panel, beside the photos it
          describes, so choosing a photo mode never shoves the options the
          reader was already looking at further down the page. Deliberately
          not height-animated: hiding working controls is a worse failure than
          appearing without a flourish. */}
      {workshopUsesPhotos(workshop) && (
        <Picker<CreationPhotoUse | "">
          label="Photo use"
          className="workshop-segment workshop-photo-use"
          value={workshop.photoUse ?? ""}
          onChange={(photoUse) => { if (photoUse) dispatch({ type: "set-photo-use", photoUse }); }}
          options={CREATION_PHOTO_USES.map((choice) => ({ value: choice.id, label: choice.label }))}
        />
      )}
    </>
  );
}

export function StoryPencilControls({
  index,
  count,
  caption,
  active,
  annotationCount,
  annotationLimit,
  lastMark,
  onPrevious,
  onNext,
  onToggle,
  onUndo,
  onClear,
}: {
  index: number;
  count: number;
  caption: string | undefined;
  active: boolean;
  annotationCount: number;
  annotationLimit: number;
  /** How Codex will read the stroke just drawn, e.g. "Right page · loop · boat". */
  lastMark?: string;
  onPrevious: () => void;
  onNext: () => void;
  onToggle: () => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  // At the limit the pencil stops rather than forgetting the oldest mark.
  const full = annotationCount >= annotationLimit;
  return (
    <>
    {lastMark && <span key={lastMark} className="story-pencil-read" role="status">{lastMark}</span>}
    <div className="story-pencil-controls" aria-label="Storyboard pages and correction pencil">
      <button type="button" onClick={onPrevious} disabled={index === 0} aria-label="Previous storyboard spread">
        <ArrowLeft size={18} weight="bold" />
      </button>
      <span className="story-pencil-beat">
        <small>Storyboard {index + 1}/{count}</small>
        <strong>{caption ?? "Waiting for Codex sketch"}</strong>
      </span>
      <button type="button" onClick={onNext} disabled={index === count - 1} aria-label="Next storyboard spread">
        <ArrowRight size={18} weight="bold" />
      </button>
      <button
        type="button"
        className={`story-pencil-toggle ${active ? "is-active" : ""}`}
        onClick={onToggle}
        disabled={full && !active}
        aria-pressed={active}
        aria-label={full && !active ? `${annotationLimit} marks on this spread; waiting for Codex` : active ? "Stop marking changes" : "Mark changes on this spread"}
      >
        <PencilSimple size={19} weight={active ? "fill" : "regular"} />
        <span>{full && !active ? `${annotationLimit} marks, waiting for Codex` : active ? "Marking" : "Mark changes"}</span>
      </button>
      {annotationCount > 0 && (
        <button type="button" onClick={onUndo} aria-label="Undo last red mark">
          <ArrowCounterClockwise size={18} />
        </button>
      )}
      {annotationCount > 1 && (
        <button type="button" onClick={onClear} aria-label="Clear all red marks on this spread">
          <Eraser size={18} />
        </button>
      )}
    </div>
    </>
  );
}
