import { describe, expect, it } from "vitest";
import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { MOTION_PRESETS } from "./types";
import {
  AUTHORING_GUIDE_DETAIL,
  AUTHORING_GUIDE_FULL_SPREAD_COUNT,
  AUTHORING_GUIDE_ID,
  AUTHORING_GUIDE_PROVENANCE_COUNT,
  AUTHORING_GUIDE_SKILL_MIRROR,
  AUTHORING_GUIDE_VERSION,
  AUTHORING_HARD_GATE_IDS,
  AUTHORING_LAYOUT_SEQUENCE,
  GENERATED_COVER_COUNT,
  PHOTO_TRUTH_REQUIREMENT,
  PROJECT_CONTEXT_DETAILS,
  REQUIRED_GATE_IDS,
  SITE_TOOL_NAMES,
  authoringHardGates,
  buildAuthoringGuide,
  creationCompletionGates,
} from "./authoringContract";
import { buildCreationBrief } from "./creationBrief";

describe("site-native authoring guide contract", () => {
  it("returns a machine-readable quality contract that mirrors the two-phase skill and creation brief", () => {
    const guide = buildAuthoringGuide();
    expect(guide.id).toBe(AUTHORING_GUIDE_ID);
    expect(guide.version).toBe(AUTHORING_GUIDE_VERSION);
    expect(guide.skillMirror).toBe(AUTHORING_GUIDE_SKILL_MIRROR);
    expect(guide.contract).toBe("two-phase");
    expect(guide.tools).toEqual([...SITE_TOOL_NAMES]);
    expect(guide.tools).toHaveLength(6);
    expect(PROJECT_CONTEXT_DETAILS).toEqual(["compact", "selected-reveal", "assets", AUTHORING_GUIDE_DETAIL]);

    expect(guide.phases).toEqual([
      { id: "plan-and-generate", mutationAllowed: false, steps: ["inspect", "story", "plan", "imagegen"] },
      {
        id: "layout",
        mutationAllowed: true,
        requiresCompleteArtSet: true,
        sequence: [...AUTHORING_LAYOUT_SEQUENCE],
      },
    ]);
    expect(guide.requiredCounts).toEqual({
      generatedCoverCount: GENERATED_COVER_COUNT,
      generatedFullSpreadCount: AUTHORING_GUIDE_FULL_SPREAD_COUNT,
      provenanceEntryCount: AUTHORING_GUIDE_PROVENANCE_COUNT,
    });
    expect(guide.gates.map((gate) => gate.id)).toEqual([...REQUIRED_GATE_IDS]);
    expect(guide.gates.map((gate) => gate.token)).toEqual(REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`));
  });

  it("encodes the hard authoring gates any Site Tools conversation must obey", () => {
    const guide = buildAuthoringGuide();
    const byId = Object.fromEntries(guide.hardGates.map((gate) => [gate.id, gate.rule]));
    expect(guide.hardGates.map((gate) => gate.id)).toEqual([...AUTHORING_HARD_GATE_IDS]);
    expect(authoringHardGates().map((gate) => gate.id)).toEqual([...AUTHORING_HARD_GATE_IDS]);

    expect(byId.inspect).toMatch(/Inspect source assets and the user prompt/i);
    expect(byId.story).toMatch(/coherent complete story arc/i);
    expect(byId["plan-art"]).toMatch(/one dedicated portrait cover/i);
    expect(byId["plan-art"]).toMatch(/one distinct full-spread illustration per spread/i);
    expect(byId["imagegen-before-create"]).toMatch(/host ImageGen/i);
    expect(byId["imagegen-before-create"]).toMatch(/before manage_book create/i);
    expect(byId["photo-truth"]).toBe(PHOTO_TRUTH_REQUIREMENT);
    expect(byId["photo-truth"]).toMatch(/raw uploaded photo/i);
    expect(byId["photo-truth"]).toMatch(/finished interior/i);
    expect(byId["photo-truth"]).toMatch(/literal photo album/i);
    expect(byId["handoff-before-refer"]).toMatch(/Hand off each generated asset/i);
    expect(byId["handoff-before-refer"]).toMatch(/before referring/i);
    expect(byId.layout).toMatch(/create, set-cover, and patch/i);
    expect(byId.interaction).toMatch(/spread-specific/i);
    expect(byId.cutouts).toMatch(/native transparent cutouts/i);
    expect(byId["provenance-revision"]).toMatch(/provenance/i);
    expect(byId["provenance-revision"]).toMatch(/expectedRevision/i);
    expect(byId.verify).toMatch(/Verify content, generated-art counts, spread-specific interaction, and undo evidence/i);

    expect(guide.interaction.required).toMatch(/spread-specific/i);
    expect(guide.interaction.hover).toEqual(HOVER_RESPONSES);
    expect(guide.interaction.focus).toEqual(FOCUS_RESPONSES);
    expect(guide.interaction.reveal).toEqual(REVEAL_KINDS);
    expect(guide.interaction.motion).toEqual([...MOTION_PRESETS]);
    expect(guide.cutouts.nativeAlpha).toBe(true);
    expect(guide.cutouts.oneSubjectPerRequest).toBe(true);
    expect(guide.verify).toEqual(expect.arrayContaining([
      expect.stringMatching(/content/i),
      expect.stringMatching(/art counts/i),
      expect.stringMatching(/interaction/i),
      expect.stringMatching(/undo evidence/i),
    ]));
  });

  it("cannot silently drift from the creationBrief two-phase gates", () => {
    const brief = buildCreationBrief({
      mode: "photos",
      spreadCount: 6,
      visualDirection: "Watercolor storybook",
      sourceAssets: [{ id: "asset:harbor-dawn", name: "Harbor at dawn.jpg" }],
    });
    const guide = buildAuthoringGuide();
    const sharedGates = creationCompletionGates({
      generatedCoverCount: 1,
      generatedFullSpreadCount: 6,
      provenanceEntryCount: 7,
    });

    expect(brief.gates.map((gate) => gate.id)).toEqual(guide.gates.map((gate) => gate.id));
    expect(brief.gates.map((gate) => gate.token)).toEqual(guide.gates.map((gate) => gate.token));
    expect(brief.gates.map((gate) => gate.id)).toEqual(sharedGates.map((gate) => gate.id));
    expect(brief.gates.find((gate) => gate.id === "photo-truth")?.requirement).toBe(PHOTO_TRUTH_REQUIREMENT);
    expect(guide.gates.find((gate) => gate.id === "photo-truth")?.requirement).toBe(PHOTO_TRUTH_REQUIREMENT);
    for (const token of REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`)) {
      expect(brief.prompt).toContain(token);
    }
  });
});
