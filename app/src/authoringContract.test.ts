import { describe, expect, it } from "vitest";
import { FOCUS_RESPONSES, HOVER_RESPONSES, REVEAL_KINDS } from "./interaction";
import { MAX_BOOK_PUBLISHABLE_ASSETS, MOTION_PRESETS } from "./types";
import {
  AUTHORING_GUIDE_DETAIL,
  CREATION_READINESS_VERSION,
  GENERATED_COVER_COUNT,
  PROJECT_CONTEXT_DETAILS,
  REQUIRED_GATE_IDS,
  SITE_TOOL_NAMES,
  assessCreationReadiness,
  buildAuthoringGuide,
  creationCompletionGates,
} from "./authoringContract";
import { buildCreationBrief } from "./creationBrief";

describe("site-native authoring guide contract", () => {
  it("returns a machine-readable quality contract that mirrors the two-phase skill and creation brief", () => {
    const guide = buildAuthoringGuide();
    expect(guide.id).toBe("apertale-authoring-guide");
    expect(guide.version).toBe(6);
    expect(guide.skillMirror).toBe("apertale-authoring");
    expect(guide.contract).toBe("two-phase");
    expect(guide.tools).toEqual([...SITE_TOOL_NAMES]);
    expect(PROJECT_CONTEXT_DETAILS).toEqual([
      "compact",
      "selected-reveal",
      "assets",
      AUTHORING_GUIDE_DETAIL,
      "creation-readiness",
      "quality-review",
      "storyboard",
    ]);

    expect(guide.phases).toEqual([
      { id: "plan-and-prepare", mutationAllowed: false, steps: ["inspect", "story", "plan", "prepare-assets"] },
      {
        id: "layout",
        mutationAllowed: true,
        requiresCompleteAssetSet: true,
        sequence: ["handoff", "create", "verify"],
      },
    ]);
    expect(guide.requiredCounts).toEqual({
      generatedCoverCount: GENERATED_COVER_COUNT,
      generatedFullSpreadCount: "one per spread for illustrated storybook or photo-led keepsake; 0 for preserved-photo-album",
      preservedPhotoSpreadCount: "exactly the agreed spread count for preserved-photo-album",
      provenanceEntryCount: "1 cover + one per spread",
    });
    expect(guide.gates.map((gate) => gate.id)).toEqual([...REQUIRED_GATE_IDS]);
    expect(guide.gates.map((gate) => gate.token)).toEqual(REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`));
    const artGate = guide.gates.find((gate) => gate.id === "art")?.requirement ?? "";
    expect(artGate).toContain("For illustrated-storybook and photo-led-keepsake");
    expect(artGate).toContain("For preserved-photo-album");
    expect(artGate).toContain("without reillustrating people");
    expect(guide.report.join(" ")).toContain("preserved original-photo layout count");
    expect(guide.report.join(" ")).toContain("reference or preserved layout");
    expect(guide.report.join(" ")).toContain("undo token");
    expect(guide.report.join(" ")).not.toContain("publishAllowed");
    expect(guide.verify.join(" ")).toMatch(/set_presentation\(surface: "shelf"\)/);
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
      "1 complete generated clean plate composed for the approximately 1.62:1 stage per spread",
      expect.stringMatching(/at most 50 distinct browser-local/i),
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
    expect(album.recommended.assetNeeds).toContain("1 source-true layout composed for the approximately 1.62:1 stage per spread; 0 generated interiors");
    expect(album.recommended.assetNeeds.join(" ")).not.toMatch(/generated clean plate.*per spread/i);

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

  it("does not charge private source provenance against the shared reader asset capacity", () => {
    const sourceAssets = Array.from({ length: 24 }, (_, index) => ({
      id: `asset:30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Source ${index + 1}.png`,
    }));
    const brief = {
      contractVersion: CREATION_READINESS_VERSION,
      bookType: "photo-led-keepsake" as const,
      premise: "A long family journey.",
      audience: "The family",
      spreadCount: 12,
      visualDirection: "Warm editorial collage",
      sourceAssets,
      photoPolicy: { sourceUse: "reference-and-compose" as const, preserveIdentity: true, allowFaceChanges: false },
    };

    expect(MAX_BOOK_PUBLISHABLE_ASSETS).toBe(50);
    expect(assessCreationReadiness(brief, {
      validatedSourceAssetIds: sourceAssets.map((asset) => asset.id),
    })).toMatchObject({
      ready: true,
      recommended: {
        assetNeeds: expect.arrayContaining([
          expect.stringMatching(/source provenance is private and excluded unless it is also rendered/i),
        ]),
      },
    });
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
    expect(guide.hardGates.map((gate) => gate.id)).toEqual(["story", "storyboard", "art", "photo-truth", "handoff-create", "interaction", "present"]);

    expect(byId.story).toMatch(/observed sources and the prompt.*beginning, development, turn, ending.*character bible/i);
    expect(byId.storyboard).toMatch(/one dedicated portrait cover/i);
    expect(byId.storyboard).toMatch(/approximately 1\.62:1 stage per spread/i);
    expect(byId.storyboard).toMatch(/1\.45–2\.10 is only the compatible input range/i);
    expect(byId.storyboard).toMatch(/14–24 marks.*back to front.*at most 6 of them labelled/);
    expect(byId.storyboard).toMatch(/at least 0\.3 of the spread height/);
    expect(byId.storyboard).toMatch(/end the turn and ask the reader/);
    expect(byId.storyboard).toMatch(/that spread alone/);
    expect(byId.storyboard).toMatch(/preserve source-photo geometry/i);
    expect(byId.art).toMatch(/After sketch approval.*without another confirmation/i);
    expect(byId.art).toMatch(/before any page call.*concurrently.*as each interior sheet finishes/i);
    expect(byId.art).toMatch(/flat magenta/);
    expect(byId.art).toMatch(/required reference-image reads once/);
    expect(byId.art).toMatch(/instead of reopening every output.*local pixel audits/);
    expect(byId.art).toMatch(/preserved-photo-album.*only the cover.*source-true layouts/i);
    expect(byId["photo-truth"]).toMatch(/raw uploaded photo.*finished interior.*literal photo album/i);
    expect(byId["handoff-create"]).toMatch(/at most 50 resulting assets per request_image_handoff.*split sheet as 4/i);
    expect(byId["handoff-create"]).toMatch(/one batch when it fits.*several with distinct requestIds/);
    expect(byId["handoff-create"]).toMatch(/assetUse book-art/);
    expect(byId["handoff-create"]).toMatch(/source-photo for reader references/);
    expect(byId["handoff-create"]).toMatch(/split: true.*key: true/);
    expect(byId["handoff-create"]).toMatch(/partial imports.*only missing or invalid assets/i);
    expect(byId["handoff-create"]).toMatch(/once every required asset is verified.*without another get_project_context/);
    expect(byId["handoff-create"]).toMatch(/heightAtScale1/);
    expect(byId["handoff-create"]).toMatch(/document id and revision.*undo tokens/);
    expect(byId.interaction).toMatch(/spread-specific/i);
    expect(byId.present).toContain('set_presentation(surface: "shelf")');
    expect(byId.present).toContain('set_presentation(surface: "reader", spreadId)');
    expect(byId.present).toMatch(/once in the current theme/);
    expect(byId.present).toMatch(/only when the reader explicitly requests it/);
    expect(byId.present).toMatch(/keep accepted assets and the created book.*only affected spreads/i);
    expect(byId.present).toMatch(/recheck only those surfaces.*two repair rounds/);
    expect(byId.present).toMatch(/ok:false correction use a fresh requestId/);
    expect(byId.present).toMatch(/pending presentation once with the same requestId/);

    expect(guide.interaction.required).toMatch(/spread-specific/i);
    expect(guide.interaction.hover).toEqual(HOVER_RESPONSES);
    expect(guide.interaction.focus).toEqual(FOCUS_RESPONSES);
    expect(guide.interaction.reveal).toEqual(REVEAL_KINDS);
    expect(guide.interaction.motion).toEqual([...MOTION_PRESETS]);
    expect(guide.cutouts.nativeAlpha).toBe(true);
    expect(guide.cutouts.oneSubjectPerAsset).toBe(true);
    expect(guide.cutouts.sheet).toMatch(/2x2/);
    expect(guide.verify).toEqual(expect.arrayContaining([
      expect.stringMatching(/content/i),
      expect.stringMatching(/asset counts/i),
      expect.stringMatching(/set_presentation\(surface: "shelf"\)/i),
    ]));
    // The whole guide has to stay small enough that the Agent acts instead of narrating it.
    expect(JSON.stringify(guide).length).toBeLessThan(10000);
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
    for (const token of REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`)) {
      expect(brief.prompt).toContain(token);
    }
  });
});
