import { describe, expect, it } from "vitest";
import {
  AUTHORING_MODES,
  buildCreationBrief,
  type CreationBriefInput,
} from "./creationBrief";
import { REQUIRED_GATE_IDS, creationCompletionGates } from "./authoringContract";

const REQUIRED_GATE_TOKENS = REQUIRED_GATE_IDS.map((id) => `[GATE:${id}]`);

const photoBriefInput = (): CreationBriefInput => ({
  mode: "photos",
  spreadCount: 6,
  visualDirection: "Watercolor storybook",
  sourceAssets: [
    { id: "asset:harbor-dawn", name: "Harbor at dawn.jpg" },
    { id: "asset:red-tram", name: "Red tram.png" },
    { id: "asset:kitchen-window", name: "Kitchen window.webp" },
  ],
});

describe("host-side creation brief contract", () => {
  it("keeps the semantic completion gates in a fixed, testable order", () => {
    const gates = creationCompletionGates({
      generatedCoverCount: 1,
      generatedFullSpreadCount: 6,
      provenanceEntryCount: 7,
    });
    expect(gates.map((gate) => gate.id)).toEqual([...REQUIRED_GATE_IDS]);
    expect(gates.map((gate) => gate.token)).toEqual(REQUIRED_GATE_TOKENS);
  });

  it("fails if the prompt omits a semantic gate, generated-art count, or ordered asset id", () => {
    const input = photoBriefInput();
    const brief = buildCreationBrief(input);
    const gates = creationCompletionGates({
      generatedCoverCount: 1,
      generatedFullSpreadCount: 6,
      provenanceEntryCount: 7,
    });

    for (const token of REQUIRED_GATE_TOKENS) {
      expect(brief.prompt, `prompt must include ${token}`).toContain(token);
    }
    for (const gate of gates) {
      expect(brief.prompt).toContain(gate.requirement);
    }

    expect(brief.prompt).toContain("two-phase");
    expect(brief.prompt).toContain("Authoring mode: photos.");
    expect(brief.prompt).toContain("Use exactly 6 spreads");
    expect(brief.prompt).toContain("Watercolor storybook");
    expect(brief.prompt).toContain("generated cover count 1");
    expect(brief.prompt).toContain("generated full-spread count 6");
    expect(brief.prompt).toContain("provenance entries 7");
    expect(brief.prompt).toContain("Site Tools");
    expect(brief.prompt).toContain("dedicated portrait cover");
    expect(brief.prompt).toContain("purpose-built full-spread artwork");
    expect(brief.prompt).toContain("approximately 1.62:1 stage");
    expect(brief.prompt).toMatch(/already-read authoring-guide art and handoff-create hard gates/);
    expect(brief.prompt).toMatch(/Continue without another confirmation.*only newly reported red marks/);
    expect(brief.prompt).toMatch(/full critique for explicitly requested polish/);
    expect(brief.prompt).toMatch(/at most 50/i);
    expect(brief.prompt).toMatch(/presentation pending.*fresh requestId/i);
    expect(brief.prompt).toContain('set_presentation(surface: "shelf")');
    expect(brief.prompt).toContain('set_presentation(surface: "reader", spreadId)');
    expect(brief.prompt).toContain("Claim generation and import only from returned asset ids and tool results");
    // The paste has to stay short enough that the Agent acts instead of narrating it.
    expect(brief.prompt.length).toBeLessThan(7000);
    expect(brief.prompt.indexOf('detail: "authoring-guide"')).toBeLessThan(brief.prompt.indexOf('detail: "creation-readiness"'));
    expect(brief.prompt).toContain("bounded import batches, and reuse of verified results");
    expect(brief.prompt).toContain("single manage_book create call");
    expect(brief.prompt).toContain("coverAssetId");
    expect(brief.prompt).toContain("2–3 native-alpha interactive layers");
    expect(brief.prompt).toContain("a text-only shell is not a book");

    const assetSectionIndex = brief.prompt.indexOf("Selected source assets in order:");
    expect(assetSectionIndex).toBeGreaterThan(-1);
    const harborIndex = brief.prompt.indexOf("asset:harbor-dawn", assetSectionIndex);
    const tramIndex = brief.prompt.indexOf("asset:red-tram", assetSectionIndex);
    const windowIndex = brief.prompt.indexOf("asset:kitchen-window", assetSectionIndex);
    expect(harborIndex).toBeGreaterThan(assetSectionIndex);
    expect(tramIndex).toBeGreaterThan(harborIndex);
    expect(windowIndex).toBeGreaterThan(tramIndex);
    expect(brief.prompt).toContain("Harbor at dawn.jpg");
    expect(brief.prompt).toContain("Red tram.png");
    expect(brief.prompt).toContain("Kitchen window.webp");
    expect(brief.sourceAssets.map((asset) => asset.id)).toEqual([
      "asset:harbor-dawn",
      "asset:red-tram",
      "asset:kitchen-window",
    ]);
  });

  it("cannot represent photo-led creation as placing uploaded source photos on the right page", () => {
    const prompt = buildCreationBrief(photoBriefInput()).prompt;
    expect(prompt).toContain("cannot be represented as simply placing uploaded source photos on the right page");
    expect(prompt).toContain("Do not use a raw uploaded photo as finished interior or right-page artwork");
    expect(prompt).toContain("unless the user explicitly requested a literal photo album");
  });

  it("still requires generated cover and full-spread art for idea-led books with no selected assets", () => {
    const brief = buildCreationBrief({
      mode: "idea",
      spreadCount: 8,
      visualDirection: "Paper collage",
      sourceAssets: [],
    });
    expect(brief.prompt).toContain("Authoring mode: idea.");
    expect(brief.prompt).toContain("Use exactly 8 spreads");
    expect(brief.prompt).toContain("generated full-spread count 8");
    expect(brief.prompt).toContain("Selected source assets in order: none yet.");
    expect(brief.prompt).toContain("[GATE:art]");
    expect(brief.prompt).toContain("[GATE:layout]");
    expect(brief.prompt).toContain("Phase 1");
    expect(brief.prompt).toContain("Phase 2");
    expect(brief.prompt).toContain("cover asset id");
    expect(brief.prompt).toContain("one original artwork asset id per spread");
  });

  it("never invents a book type the caller did not decide", () => {
    const undecided = buildCreationBrief({ ...photoBriefInput(), bookType: undefined });
    expect(undecided.prompt).toContain("Book type: not chosen yet.");
    expect(undecided.readiness.bookType).toBeNull();
    expect(undecided.readiness.questions.join(" ")).toMatch(/illustrated storybook, a photo-led keepsake, or an album/);
  });

  it("marks trusted source ids as verified while unknown sources still ask for handoff", () => {
    const uuid = (index: number) => `asset:12345678-1234-4234-8234-${index.toString(16).padStart(12, "0")}`;
    const input: CreationBriefInput = {
      mode: "photos",
      spreadCount: 6,
      visualDirection: "Watercolor storybook",
      premise: "A harbour year.",
      audience: "The family",
      bookType: "photo-led-keepsake",
      photoPolicy: { sourceUse: "reference-and-compose", preserveIdentity: true, allowFaceChanges: false },
      sourceAssets: [
        { id: uuid(1), name: "Harbor at dawn.jpg" },
        { id: uuid(2), name: "Red tram.png" },
      ],
    };

    const unverified = buildCreationBrief(input).readiness;
    expect(unverified.blockingMissingFields.some((blocker) => blocker.reason.includes("has not verified"))).toBe(true);
    expect(unverified.questions).toContain(
      "Call request_image_handoff for the missing photos, then check readiness again.",
    );

    const verified = buildCreationBrief({ ...input, validatedSourceAssetIds: [uuid(1), uuid(2)] }).readiness;
    expect(verified.ready).toBe(true);
    expect(verified.blockingMissingFields.some((blocker) => blocker.reason.includes("has not verified"))).toBe(false);
    expect(verified.questions).not.toContain(
      "Call request_image_handoff for the missing photos, then check readiness again.",
    );
  });

  it("honors both-mode by keeping the idea promise and photo-truth rejection together", () => {
    const brief = buildCreationBrief({
      mode: "both",
      spreadCount: 4,
      visualDirection: "Cinematic editorial",
      sourceAssets: [{ id: "asset:ticket-stub", name: "Ticket stub.jpg" }],
    });
    expect(AUTHORING_MODES).toEqual(["idea", "photos", "both"]);
    expect(brief.prompt).toContain("Authoring mode: both.");
    expect(brief.prompt).toContain("the idea sets the promise");
    expect(brief.prompt).toContain("cannot be represented as simply placing uploaded source photos on the right page");
    expect(brief.prompt).toContain("asset:ticket-stub — Ticket stub.jpg");
    expect(brief.prompt).toContain("generated full-spread count 4");
    expect(brief.prompt).toMatch(/already-read authoring-guide.*concurrent generation, bounded import batches/);
  });

  it("preserves caller-selected source-asset order and rejects incomplete or remote ids", () => {
    const reversed = buildCreationBrief({
      ...photoBriefInput(),
      sourceAssets: [
        { id: "asset:kitchen-window", name: "Kitchen window.webp" },
        { id: "asset:harbor-dawn", name: "Harbor at dawn.jpg" },
      ],
    });
    expect(reversed.prompt.indexOf("asset:kitchen-window")).toBeLessThan(reversed.prompt.indexOf("asset:harbor-dawn"));

    expect(() => buildCreationBrief({ ...photoBriefInput(), mode: "album" as CreationBriefInput["mode"] })).toThrow(/mode must be idea, photos, or both/);
    expect(() => buildCreationBrief({
      ...photoBriefInput(),
      bookType: "scrapbook" as CreationBriefInput["bookType"],
    })).toThrow(/bookType must be one of/);
    expect(() => buildCreationBrief({ ...photoBriefInput(), spreadCount: 3.5 })).toThrow(/spreadCount/);
    expect(() => buildCreationBrief({ ...photoBriefInput(), spreadCount: 13 })).toThrow(/spreadCount/);
    expect(() => buildCreationBrief({ ...photoBriefInput(), visualDirection: "   " })).toThrow(/visualDirection/);
    expect(() => buildCreationBrief({ ...photoBriefInput(), sourceAssets: [{ id: "", name: "Harbor" }] })).toThrow(/stable asset id/);
    expect(() => buildCreationBrief({ ...photoBriefInput(), sourceAssets: [{ id: "asset:harbor-dawn", name: "" }] })).toThrow(/user-visible name/);
    expect(() => buildCreationBrief({
      ...photoBriefInput(),
      sourceAssets: [
        { id: "asset:harbor-dawn", name: "Harbor at dawn.jpg" },
        { id: "asset:harbor-dawn", name: "Copy.jpg" },
      ],
    })).toThrow(/unique/);
    expect(() => buildCreationBrief({
      ...photoBriefInput(),
      sourceAssets: [{ id: "https://example.com/photo.jpg", name: "Harbor" }],
    })).toThrow(/remote URL/);
  });
});
