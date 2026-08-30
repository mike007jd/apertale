import { describe, expect, it } from "vitest";
import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { MOTION_PRESETS } from "./types";
import {
  AUTHORING_GUIDE_DETAIL,
  AUTHORING_GUIDE_FULL_SPREAD_COUNT,
  AUTHORING_GUIDE_ID,
  AUTHORING_GUIDE_PROVENANCE_COUNT,
  AUTHORING_GUIDE_PRESERVED_SPREAD_COUNT,
  AUTHORING_GUIDE_SKILL_MIRROR,
  AUTHORING_GUIDE_VERSION,
  AUTHORING_HARD_GATE_IDS,
  AUTHORING_LAYOUT_SEQUENCE,
  CREATION_READINESS_VERSION,
  GENERATED_COVER_COUNT,
  PHOTO_TRUTH_REQUIREMENT,
  PROJECT_CONTEXT_DETAILS,
  REQUIRED_GATE_IDS,
  SITE_TOOL_NAMES,
  assessCreationReadiness,
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
    expect(guide.tools).toHaveLength(7);
    expect(PROJECT_CONTEXT_DETAILS).toEqual([
      "compact",
      "selected-reveal",
      "assets",
      AUTHORING_GUIDE_DETAIL,
      "creation-readiness",
      "quality-review",
    ]);

    expect(guide.phases).toEqual([
      { id: "plan-and-prepare", mutationAllowed: false, steps: ["inspect", "story", "plan", "prepare-assets"] },
      {
        id: "layout",
        mutationAllowed: true,
        requiresCompleteAssetSet: true,
        sequence: [...AUTHORING_LAYOUT_SEQUENCE],
      },
    ]);
    expect(guide.requiredCounts).toEqual({
      generatedCoverCount: GENERATED_COVER_COUNT,
      generatedFullSpreadCount: AUTHORING_GUIDE_FULL_SPREAD_COUNT,
      preservedPhotoSpreadCount: AUTHORING_GUIDE_PRESERVED_SPREAD_COUNT,
      provenanceEntryCount: AUTHORING_GUIDE_PROVENANCE_COUNT,
    });
    expect(guide.gates.map((gate) => gate.id)).toEqual([...REQUIRED_GATE_IDS]);
    expect(guide.gates.map((gate) => gate.token)).toEqual(REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`));
    const artGate = guide.gates.find((gate) => gate.id === "art")?.requirement ?? "";
    expect(artGate).toContain("For illustrated-storybook and photo-led-keepsake");
    expect(artGate).toContain("For preserved-photo-album");
    expect(artGate).toContain("without reillustrating people");
    expect(guide.report.join(" ")).toContain("preserved original-photo layout count");
    expect(guide.report.join(" ")).toContain("source-true layouts for preserved-photo-album");
    expect(guide.report.join(" ")).toContain("publishAllowed");
    expect(guide.verify.join(" ")).toMatch(/actual cover\/spread frames inspected/i);
  });

  it("assesses storybook, photo keepsake, and preserved-album readiness from one versioned contract", () => {
    const story = assessCreationReadiness({
      contractVersion: CREATION_READINESS_VERSION,
      bookType: "illustrated-storybook",
      premise: "A child follows a blue road home.",
      audience: "Family readers age six and up",
      spreadCount: 6,
      visualDirection: "Luminous cut-paper watercolor",
      sourceAssets: [],
    });
    expect(story).toMatchObject({ ready: true, bookType: "illustrated-storybook", effectiveSpreadCount: 6 });
    expect(story.recommended.assetNeeds).toEqual(expect.arrayContaining([
      "1 dedicated portrait cover",
      "1 complete generated 2:1 clean plate per spread",
    ]));

    const photoAsset = { id: "asset:12345678-1234-4234-8234-123456789abc", name: "Family picnic.png" };
    const keepsake = assessCreationReadiness({
      contractVersion: CREATION_READINESS_VERSION,
      bookType: "photo-led-keepsake",
      premise: "A warm record of a family reunion.",
      audience: "The family",
      spreadCount: 6,
      visualDirection: "Warm editorial collage",
      sourceAssets: [photoAsset],
      photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
    }, { validatedSourceAssetIds: [photoAsset.id] });
    expect(keepsake).toMatchObject({ ready: true, photoBoundaries: { sourceUse: "reference-and-compose", preserveIdentity: true } });
    expect(keepsake.photoBoundaries.prohibited).toContain("identity or face changes");

    const album = assessCreationReadiness({
      contractVersion: CREATION_READINESS_VERSION,
      bookType: "preserved-photo-album",
      premise: "Keep the original wedding photographs in order.",
      audience: "The couple and their family",
      spreadCount: 4,
      visualDirection: "Quiet archival album",
      sourceAssets: [photoAsset],
      photoPolicy: {
        sourceUse: "preserve-original-layout",
        preserveIdentity: true,
        allowFaceChanges: false,
        allowCrop: false,
        allowColorCorrection: true,
      },
    }, { validatedSourceAssetIds: [photoAsset.id] });
    expect(album).toMatchObject({ ready: true, bookType: "preserved-photo-album" });
    expect(album.recommendations.join(" ")).toMatch(/original photo geometry/i);
    expect(album.recommended.assetNeeds).toContain("1 source-true 2:1 preserved-photo layout per spread; 0 generated interiors");
    expect(album.recommended.assetNeeds.join(" ")).not.toMatch(/generated 2:1 clean plate per spread/i);

    const albumBrief = buildCreationBrief({
      mode: "photos",
      spreadCount: 4,
      visualDirection: "Quiet archival album",
      sourceAssets: [photoAsset],
      bookType: "preserved-photo-album",
      premise: "Keep the original wedding photographs in order.",
      audience: "The couple and their family",
      photoPolicy: {
        sourceUse: "preserve-original-layout",
        preserveIdentity: true,
        allowFaceChanges: false,
        allowCrop: false,
        allowColorCorrection: true,
      },
    });
    expect(albumBrief.readiness).toMatchObject({ ready: false });
    expect(albumBrief.readiness.blockingMissingFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "sourceAssets" }),
    ]));
    expect(albumBrief.prompt).toContain("preserved original-photo layout count 4");
    expect(albumBrief.prompt).toContain("without reillustrating people");
    expect(albumBrief.prompt).not.toContain("purpose-built full-spread artwork for every spread");
    expect(albumBrief.prompt).not.toContain("original artwork asset id per spread");
  });

  it("applies source-photo and identity gates from actual assets even when the brief claims storybook", () => {
    const sourceAsset = { id: "asset:12345678-1234-4234-8234-123456789abc", name: "Portrait.png" };
    const base = {
      contractVersion: CREATION_READINESS_VERSION,
      bookType: "illustrated-storybook" as const,
      premise: "A portrait inspires a story.",
      audience: "The family",
      spreadCount: 4,
      visualDirection: "Soft paper collage",
      sourceAssets: [sourceAsset],
    };

    expect(assessCreationReadiness(base, { validatedSourceAssetIds: [] })).toMatchObject({
      ready: false,
      blockingMissingFields: expect.arrayContaining([
        expect.objectContaining({ field: "sourceAssets" }),
        expect.objectContaining({ field: "photoPolicy.sourceUse" }),
        expect.objectContaining({ field: "photoPolicy.preserveIdentity" }),
        expect.objectContaining({ field: "photoPolicy.allowFaceChanges" }),
      ]),
    });
    expect(assessCreationReadiness({
      ...base,
      photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
    }, { validatedSourceAssetIds: [sourceAsset.id] })).toMatchObject({ ready: true });
  });

  it("returns blocking fields and short user-ready questions instead of guessing material photo choices", () => {
    const result = assessCreationReadiness({
      contractVersion: CREATION_READINESS_VERSION,
      premise: "A keepsake from a trip.",
      spreadCount: 6,
      visualDirection: "Cinematic",
      sourceAssets: [],
    });

    expect(result.ready).toBe(false);
    expect(result.blockingMissingFields.map((item) => item.field)).toEqual(expect.arrayContaining([
      "bookType",
      "audience",
    ]));
    expect(result.questions).toEqual(expect.arrayContaining([
      expect.stringMatching(/illustrated storybook.*photo-led keepsake.*original photos/i),
      "Who is this book for?",
    ]));
    expect(result.questions.every((question) => question.endsWith("?"))).toBe(true);
  });

  it("encodes the hard authoring gates any Site Tools conversation must obey", () => {
    const guide = buildAuthoringGuide();
    const byId = Object.fromEntries(guide.hardGates.map((gate) => [gate.id, gate.rule]));
    expect(guide.hardGates.map((gate) => gate.id)).toEqual([...AUTHORING_HARD_GATE_IDS]);
    expect(authoringHardGates().map((gate) => gate.id)).toEqual([...AUTHORING_HARD_GATE_IDS]);

    expect(byId.inspect).toMatch(/Inspect source assets and the user prompt/i);
    expect(byId.story).toMatch(/coherent complete story arc/i);
    expect(byId["plan-art"]).toMatch(/one dedicated portrait cover/i);
    expect(byId["plan-art"]).toMatch(/one distinct 2:1 spread composition per spread/i);
    expect(byId["plan-art"]).toMatch(/preserve source-photo geometry/i);
    expect(byId["imagegen-before-create"]).toMatch(/host ImageGen/i);
    expect(byId["imagegen-before-create"]).toMatch(/before manage_book create/i);
    expect(byId["imagegen-before-create"]).toMatch(/do not reillustrate preserved-photo-album/i);
    expect(byId["photo-truth"]).toBe(PHOTO_TRUTH_REQUIREMENT);
    expect(byId["photo-truth"]).toMatch(/raw uploaded photo/i);
    expect(byId["photo-truth"]).toMatch(/finished interior/i);
    expect(byId["photo-truth"]).toMatch(/literal photo album/i);
    expect(byId["handoff-before-refer"]).toMatch(/assetUse source-photo/i);
    expect(byId["handoff-before-refer"]).toMatch(/assetUse book-art/i);
    expect(byId["handoff-before-refer"]).toMatch(/before referring/i);
    expect(byId.layout).toMatch(/create, set-cover, and patch/i);
    expect(byId.interaction).toMatch(/spread-specific/i);
    expect(byId.cutouts).toMatch(/native transparent cutouts/i);
    expect(byId["provenance-revision"]).toMatch(/provenance/i);
    expect(byId["provenance-revision"]).toMatch(/expectedRevision/i);
    expect(byId.verify).toMatch(/Verify content, book-type-specific asset counts, spread-specific interaction/i);
    expect(byId.verify).toMatch(/patch and re-check at most twice/i);

    expect(guide.interaction.required).toMatch(/spread-specific/i);
    expect(guide.interaction.hover).toEqual(HOVER_RESPONSES);
    expect(guide.interaction.focus).toEqual(FOCUS_RESPONSES);
    expect(guide.interaction.reveal).toEqual(REVEAL_KINDS);
    expect(guide.interaction.motion).toEqual([...MOTION_PRESETS]);
    expect(guide.cutouts.nativeAlpha).toBe(true);
    expect(guide.cutouts.oneSubjectPerRequest).toBe(true);
    expect(guide.verify).toEqual(expect.arrayContaining([
      expect.stringMatching(/content/i),
      expect.stringMatching(/asset counts/i),
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

    expect(guide.gates.map((gate) => gate.id)).toEqual(sharedGates.map((gate) => gate.id));
    expect(guide.gates.map((gate) => gate.token)).toEqual(sharedGates.map((gate) => gate.token));
    expect(guide.gates.find((gate) => gate.id === "photo-truth")?.requirement).toBe(PHOTO_TRUTH_REQUIREMENT);
    for (const token of REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`)) {
      expect(brief.prompt).toContain(token);
    }
  });
});
