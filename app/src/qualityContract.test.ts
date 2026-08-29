import { describe, expect, it } from "vitest";
import type { DocumentState } from "./types";
import {
  QUALITY_REVIEW_MAX_ROUNDS,
  QUALITY_RUBRIC,
  QUALITY_VISUAL_CRITERION_IDS,
  assertPublishableQuality,
  buildQualityReport,
  buildQualityRenderManifest,
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
  contractVersion: 1,
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
    expect(QUALITY_RUBRIC).toMatchObject({ version: 1, maxReviewRounds: QUALITY_REVIEW_MAX_ROUNDS });
    expect(QUALITY_RUBRIC.criteria.map((item) => item.id)).toEqual(expect.arrayContaining([
      "cover-appeal",
      "spread-composition",
      "photo-fidelity-integration",
      "alpha-edge-matte",
      "premium-sample-value",
    ]));
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
  });

  it("requires every visual criterion and produces a publishable warning record", () => {
    const document = documentState();
    const deterministic = evaluateDeterministicQuality(document, renderEvidence(), readyBrief);
    expect(deterministic.every((check) => check.outcome === "pass")).toBe(true);
    const submission = visualReview("warn");
    expect(validateVisualReview(document, submission, 1)).toBeNull();
    const report = buildQualityReport(document, 1, deterministic, submission, readyBrief);
    expect(report).toMatchObject({ blockerCount: 0, warningCount: QUALITY_VISUAL_CRITERION_IDS.length, warningsRecorded: true, sampleReady: true, publishAllowed: true });
    expect(() => assertPublishableQuality(document, report)).not.toThrow();

    const forged = structuredClone(report);
    forged.checks.find((check) => check.criterionId === "spread-composition")!.evidence[0].spreadId = "does-not-exist";
    expect(() => assertPublishableQuality(document, forged)).toThrow(/quality gate/i);
  });

  it("rejects visual evidence for a spread outside the current document", () => {
    const forged = visualReview();
    forged.checks.find((check) => check.criterionId === "spread-composition")!.evidence[0].spreadId = "does-not-exist";
    expect(validateVisualReview(documentState(), forged, 1)).toMatch(/spread-composition/i);
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
