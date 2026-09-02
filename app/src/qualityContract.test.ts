import { describe, expect, it } from "vitest";
import { MAX_BOOK_PUBLISHABLE_ASSETS } from "./types";
import type { DocumentState } from "./types";
import {
  MINIMUM_CAPABLE_BOOK_ASSETS,
  QUALITY_CONTRACT_VERSION,
  QUALITY_REVIEW_MAX_ROUNDS,
  QUALITY_RUBRIC,
  QUALITY_VISUAL_CRITERION_IDS,
  buildQualityReport,
  groupQualityBlockers,
  buildQualityRenderManifest,
  creationArtifactIssues,
  creationAssetPolicyIssues,
  evaluateDeterministicQuality,
  validateVisualReview,
  type QualityRenderEvidence,
  type QualityVisualReviewSubmission,
} from "./qualityContract";

const documentState = (): DocumentState => ({
  id: "creator-book",
  revision: 4,
  title: "The Blue Path",
  coverAssetId: "asset:12345678-1234-4234-8234-123456789abc",
  spreads: [{
    id: "opening",
    order: 0,
    title: "Opening",
    body: "A path turns toward home.",
    artwork: {
      cleanPlateAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
      sourceAssetId: "/assets/generated/wonders-colosseum.png",
      separation: "inpainted-clean-plate",
    },
    elements: [
      {
        id: "guide",
        label: "Guide",
        kind: "lifted",
        assetId: "/assets/generated/story-city-boy-cutout-v3.png",
        page: "right",
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        depth: 0.2,
        locked: false,
        provenance: "agent",
      },
      {
        id: "cloud",
        label: "Cloud",
        kind: "decoration",
        assetId: "/assets/generated/story-city-clouds-cutout-v3.png",
        page: "left",
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        depth: 0.1,
        locked: false,
        provenance: "agent",
      },
      {
        id: "story-hotspot",
        label: "Story hotspot",
        kind: "decoration",
        assetId: "procedural:hotspot:amber",
        page: "right",
        transform: { x: 0.72, y: 0.35, scaleX: 1, scaleY: 1, rotationDeg: 0 },
        depth: 0.12,
        locked: false,
        provenance: "agent",
        interaction: {
          hover: "lift-glow",
          focus: "spotlight",
          reveal: { kind: "caption", title: "Follow", summary: "The guide points home.", facts: [] },
        },
      },
    ],
  }],
});

const multiSpreadDocumentState = (): DocumentState => {
  const document = documentState();
  document.spreads.push({
    ...structuredClone(document.spreads[0]),
    id: "closing",
    order: 1,
    title: "Closing",
    body: "The path reaches home.",
    artwork: {
      cleanPlateAssetId: "/assets/generated/wonders-chichen-itza-clean-v2.png",
      sourceAssetId: "/assets/generated/wonders-chichen-itza.png",
      separation: "inpainted-clean-plate",
    },
    elements: document.spreads[0].elements.map((element) => ({
      ...structuredClone(element),
      id: `closing-${element.id}`,
    })),
  });
  return document;
};

const renderEvidence = (): QualityRenderEvidence[] => [
  {
    documentId: "creator-book",
    revision: 4,
    scope: "cover",
    theme: "paper-atelier",
    surface: "shelf",
    locator: "[data-book-id] img",
    renderedAt: "2026-08-29T00:00:00.000Z",
  },
  {
    documentId: "creator-book",
    revision: 4,
    scope: "spread",
    spreadId: "opening",
    theme: "paper-atelier",
    surface: "webgl",
    locator: ".book-scene canvas",
    renderedAt: "2026-08-29T00:00:01.000Z",
  },
];

const readyBrief = {
  contractVersion: 2 as const,
  bookType: "illustrated-storybook" as const,
  premise: "A path turns toward home.",
  audience: "Families",
  spreadCount: 1,
  visualDirection: "Cut paper",
  sourceAssets: [],
};

const visualReview = (outcome: "pass" | "warn" | "blocker" = "pass"): QualityVisualReviewSubmission => ({
  contractVersion: 2,
  reviewedRevision: 4,
  expectedRound: 1,
  sampleReady: outcome !== "blocker",
  summary: "The rendered book was compared with the premium samples.",
  checks: QUALITY_VISUAL_CRITERION_IDS.map((criterionId) => ({
    criterionId,
    outcome,
    message: `${criterionId} was inspected in the rendered frame.`,
    evidence: [{ scope: criterionId === "cover-appeal" ? "cover" : "spread", spreadId: criterionId === "cover-appeal" ? undefined : "opening", locator: ".book-scene canvas", description: "Rendered evidence" }],
    ...(outcome === "pass" ? {} : { suggestedPatch: "Adjust this item and render again." }),
  })),
});

describe("quality contract", () => {
  it("keeps one versioned rubric for deterministic and visual judgments", () => {
    expect(QUALITY_RUBRIC).toMatchObject({ version: 2, maxReviewRounds: QUALITY_REVIEW_MAX_ROUNDS });
    expect(QUALITY_RUBRIC.criteria.map((item) => item.id)).toEqual(expect.arrayContaining([
      "cover-appeal",
      "spread-composition",
      "photo-fidelity-integration",
      "alpha-edge-matte",
      "premium-sample-value",
    ]));
    expect(JSON.stringify(QUALITY_RUBRIC)).toMatch(/approximately 1\.62:1 stage/i);
    expect(JSON.stringify(QUALITY_RUBRIC)).not.toMatch(/2:1 spread composition|intentional 2:1 composition/i);
  });

  it("blocks missing structure and render evidence deterministically", () => {
    const broken = documentState();
    delete broken.coverAssetId;
    delete broken.spreads[0].artwork;
    broken.spreads[0].elements = [];
    const checks = evaluateDeterministicQuality(broken, [], readyBrief);
    expect(checks.filter((check) => check.outcome === "blocker").map((check) => check.criterionId)).toEqual(expect.arrayContaining([
      "missing-or-fallback-assets",
      "layered-spread-contract",
      "meaningful-interaction",
      "render-evidence-completeness",
    ]));
    const createIssues = creationArtifactIssues(broken, readyBrief);
    expect(createIssues).toEqual(expect.arrayContaining([
      expect.stringMatching(/cover/i),
      expect.stringMatching(/spread 1/i),
    ]));
    expect(createIssues.join(" ")).not.toMatch(/render evidence/i);
  });

  it("does not count idle motion as an authored reader interaction", () => {
    const document = documentState();
    document.spreads[0].elements.forEach((element) => {
      delete element.interaction;
    });
    document.spreads[0].elements[0].motion = { preset: "gentle-float", durationMs: 4200, loop: true };

    expect(creationArtifactIssues(document, readyBrief)).toEqual(expect.arrayContaining([
      expect.stringMatching(/no authored interaction/i),
    ]));
    expect(evaluateDeterministicQuality(document, renderEvidence(), readyBrief)).toEqual(expect.arrayContaining([
      expect.objectContaining({ criterionId: "meaningful-interaction", outcome: "blocker" }),
    ]));
  });

  it("blocks legacy cross-role asset conflicts before the Worker publish boundary", () => {
    const document = documentState();
    document.spreads[0].elements[0].assetId = document.spreads[0].artwork!.cleanPlateAssetId;

    expect(creationArtifactIssues(document, readyBrief)).toEqual(expect.arrayContaining([
      expect.stringMatching(/reuse background asset/i),
    ]));
  });

  it("treats a legacy coverTextureUrl as the effective cover for source-photo policy", () => {
    const sourceId = "asset:32345678-1234-4234-8234-123456789abc";
    const document = documentState();
    delete document.coverAssetId;
    document.coverTextureUrl = sourceId;
    const brief = {
      ...readyBrief,
      sourceAssets: [{ id: sourceId, name: "Portrait.png" }],
      photoPolicy: { sourceUse: "reference-and-compose" as const, preserveIdentity: true, allowFaceChanges: false },
    };

    expect(creationAssetPolicyIssues(document, brief)).toContain(
      "A personal source photo cannot replace the dedicated cover.",
    );
  });

  it("requires every visual criterion and produces an advisory warning record", () => {
    const document = documentState();
    const deterministic = evaluateDeterministicQuality(document, renderEvidence(), readyBrief);
    expect(deterministic.every((check) => check.outcome === "pass")).toBe(true);
    const submission = visualReview("warn");
    expect(validateVisualReview(document, submission, 1)).toBeNull();
    const report = buildQualityReport(document, 1, deterministic, submission, readyBrief);
    expect(report).toMatchObject({ status: "ready", blockerCount: 0, warningCount: QUALITY_VISUAL_CRITERION_IDS.length, warningsRecorded: true, sampleReady: true });
  });

  it("rejects visual evidence for a spread outside the current document", () => {
    const forged = visualReview();
    forged.checks.find((check) => check.criterionId === "spread-composition")!.evidence[0].spreadId = "does-not-exist";
    expect(validateVisualReview(documentState(), forged, 1)).toMatch(/spread-composition/i);
  });

  it("accepts one book-level photo-fidelity note only when the book has no personal photos", () => {
    const document = multiSpreadDocumentState();
    const brief = { ...readyBrief, spreadCount: document.spreads.length };
    const evidence = [
      ...renderEvidence(),
      { ...renderEvidence()[1], spreadId: "closing", renderedAt: "2026-08-29T00:00:02.000Z" },
    ];
    const submission = visualReview();
    submission.checks.forEach((check) => {
      if (check.criterionId !== "cover-appeal") {
        check.evidence.push({ ...check.evidence[0], spreadId: "closing" });
      }
    });
    const photoFidelity = submission.checks.find((check) => check.criterionId === "photo-fidelity-integration")!;
    photoFidelity.outcome = "note";
    photoFidelity.message = "No personal source photos are present, so photo fidelity is not applicable.";
    photoFidelity.evidence = [{
      scope: "book",
      locator: "creationBrief.sourceAssets",
      description: "The ready brief contains no personal source assets.",
    }];

    expect(validateVisualReview(document, submission, 1)).toBeNull();
    const report = buildQualityReport(
      document,
      1,
      evaluateDeterministicQuality(document, evidence, brief),
      submission,
      brief,
    );
    expect(report.status).toBe("ready");

    const legacy = structuredClone(submission);
    const legacyPhotoFidelity = legacy.checks.find((check) => check.criterionId === "photo-fidelity-integration")!;
    legacyPhotoFidelity.outcome = "pass";
    legacyPhotoFidelity.evidence = document.spreads.map((spread) => ({
      scope: "spread" as const,
      spreadId: spread.id,
      locator: ".book-scene canvas",
      description: "Rendered spread evidence",
    }));
    expect(validateVisualReview(document, legacy, 1)).toBeNull();
  });

  it("requires per-spread photo-fidelity evidence when any spread has a personal photo", () => {
    const sourceId = "asset:22345678-1234-4234-8234-123456789abc";
    const document = multiSpreadDocumentState();
    document.spreads.forEach((spread) => { spread.artwork!.personalSourceAssetId = sourceId; });
    const submission = visualReview();
    submission.checks.forEach((check) => {
      if (check.criterionId !== "cover-appeal") check.evidence.push({ ...check.evidence[0], spreadId: "closing" });
    });
    const photoFidelity = submission.checks.find((check) => check.criterionId === "photo-fidelity-integration")!;
    photoFidelity.outcome = "note";
    photoFidelity.evidence = [{ scope: "book", locator: "creationBrief.sourceAssets", description: "Personal source assets" }];

    expect(validateVisualReview(document, submission, 1)).toBe(
      "Visual criteria are incomplete: photo-fidelity-integration.",
    );
    photoFidelity.outcome = "pass";
    photoFidelity.evidence = document.spreads.map((spread) => ({
      scope: "spread" as const,
      spreadId: spread.id,
      locator: ".book-scene canvas",
      description: "Rendered personal-photo evidence",
    }));
    expect(validateVisualReview(document, submission, 1)).toBeNull();
  });

  it("reports every incomplete visual criterion in rubric order", () => {
    const forged = visualReview();
    forged.checks.find((check) => check.criterionId === "spread-composition")!.evidence = [];
    forged.checks.find((check) => check.criterionId === "photo-fidelity-integration")!.message = "";
    expect(validateVisualReview(documentState(), forged, 1)).toBe(
      "Visual criteria are incomplete: spread-composition, photo-fidelity-integration.",
    );
  });

  it("derives generated and preserved spread policy from the ready brief", () => {
    const sourceId = "asset:22345678-1234-4234-8234-123456789abc";
    const album = documentState();
    album.spreads[0].artwork = {
      cleanPlateAssetId: sourceId,
      sourceAssetId: sourceId,
      personalSourceAssetId: sourceId,
      separation: "preserved-photo-layout",
    };
    const albumBrief = {
      contractVersion: 2 as const,
      bookType: "preserved-photo-album" as const,
      premise: "Keep the original photograph.",
      audience: "The family",
      spreadCount: 1,
      visualDirection: "Archival album",
      sourceAssets: [{ id: sourceId, name: "Original.png" }],
      photoPolicy: {
        sourceUse: "preserve-original-layout" as const,
        preserveIdentity: true,
        allowFaceChanges: false,
        allowCrop: false,
        allowColorCorrection: true,
      },
    };
    expect(creationAssetPolicyIssues(album, albumBrief)).toEqual([]);
    expect(creationAssetPolicyIssues(album, readyBrief)).toEqual(expect.arrayContaining([
      expect.stringMatching(/inpainted-clean-plate/i),
      expect.stringMatching(/personal-photo/i),
    ]));
  });

  it("keeps generated composites separate from personal-photo provenance", () => {
    const sourceId = "asset:22345678-1234-4234-8234-123456789abc";
    const document = documentState();
    const personalBrief = {
      ...readyBrief,
      sourceAssets: [{ id: sourceId, name: "Portrait.png" }],
      photoPolicy: { sourceUse: "reference-and-compose" as const, preserveIdentity: true, allowFaceChanges: false },
    };
    document.spreads[0].artwork!.personalSourceAssetId = sourceId;
    expect(creationAssetPolicyIssues(document, personalBrief)).toEqual([]);

    document.spreads[0].artwork!.personalSourceAssetId = "asset:32345678-1234-4234-8234-123456789abc";
    expect(creationAssetPolicyIssues(document, personalBrief)).toEqual(expect.arrayContaining([
      expect.stringMatching(/declared personal-photo source/i),
    ]));
  });

  it("reuses the readiness oracle when validating the publish brief", () => {
    expect(creationAssetPolicyIssues(documentState(), { ...readyBrief, premise: "" })).toEqual(expect.arrayContaining([
      expect.stringMatching(/clear story/i),
    ]));
  });

  it("keeps aesthetic judgment outside the render manifest schema", () => {
    const manifest = buildQualityRenderManifest(documentState(), "https://apertale.test/");
    expect(manifest.screenshotBoundary).toMatch(/browser\/screenshot capability/i);
    expect(manifest).not.toHaveProperty("sampleReady");
    expect(manifest.spreads[0]).toMatchObject({
      finalBaseAssetId: "/assets/generated/wonders-colosseum-clean-v2.png",
      sourceAssetId: "/assets/generated/wonders-colosseum.png",
      personalSourceAssetId: null,
      separation: "inpainted-clean-plate",
      foregroundLayers: [
        expect.objectContaining({ id: "guide", interaction: false }),
        expect.objectContaining({ id: "cloud", interaction: false }),
      ],
    });
  });
});

describe("quality blocker grouping", () => {
  const check = (message: string, suggestedPatch?: string) => ({
    criterionId: "cover-appeal",
    outcome: "blocker" as const,
    message,
    evidence: [],
    ...(suggestedPatch ? { suggestedPatch } : {}),
  });

  it("shows one line per distinct fault and carries the repeat count", () => {
    const grouped = groupQualityBlockers([
      check("The cover title is illegible at shelf size."),
      check("The cover title is illegible at shelf size."),
      check("The cover title is illegible at shelf size.", "Increase the title weight."),
      check("Two spreads reuse the same illustration.", "Generate a second plate."),
      { ...check("A warning, not a blocker."), outcome: "warn" as const },
    ]);
    expect(grouped).toEqual([
      { message: "The cover title is illegible at shelf size.", suggestedPatch: "Increase the title weight.", count: 3 },
      { message: "Two spreads reuse the same illustration.", suggestedPatch: "Generate a second plate.", count: 1 },
    ]);
  });

  it("survives a report that never arrived", () => {
    expect(groupQualityBlockers(undefined)).toEqual([]);
  });
});

describe("quality rubric", () => {
  it("stays aligned with the shipped contract constants", () => {
    expect(QUALITY_RUBRIC.version).toBe(QUALITY_CONTRACT_VERSION);
    expect(QUALITY_RUBRIC.maxReviewRounds).toBe(QUALITY_REVIEW_MAX_ROUNDS);
    expect(QUALITY_RUBRIC.maxBookUploadedAssets).toBe(MAX_BOOK_PUBLISHABLE_ASSETS);
    expect(Number.isInteger(MAX_BOOK_PUBLISHABLE_ASSETS)).toBe(true);
    expect(MAX_BOOK_PUBLISHABLE_ASSETS).toBeGreaterThanOrEqual(MINIMUM_CAPABLE_BOOK_ASSETS);
  });
});
