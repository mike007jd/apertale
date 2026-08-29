import { describe, expect, it, vi } from "vitest";
import {
  abortImageHandoff,
  completeImageHandoff,
  currentImageHandoff,
  dismissImageHandoff,
  requestImageHandoff,
  subscribeToImageHandoff,
} from "./imageHandoff";

const ask = (requestId: string, reason = "Spread five needs a photo of your grandmother.") =>
  requestImageHandoff({ requestId, reason });

describe("image handoff", () => {
  it("stays pending until the reader chooses, then returns the ids to the caller", async () => {
    const seen: Array<string | null> = [];
    const stop = subscribeToImageHandoff((request) => seen.push(request?.requestId ?? null));

    const pending = ask("req-1");
    expect(currentImageHandoff()?.reason).toContain("grandmother");

    // The promise must not settle on its own: the whole point is that the tool
    // call spans the reader's click, so the Agent never has to be told the
    // upload finished.
    const settledEarly = vi.fn();
    void pending.then(settledEarly);
    await Promise.resolve();
    expect(settledEarly).not.toHaveBeenCalled();

    expect(completeImageHandoff("req-1", ["asset:one", "asset:two"])).toBe(true);
    await expect(pending).resolves.toEqual({ status: "provided", assetIds: ["asset:one", "asset:two"] });
    expect(currentImageHandoff()).toBeNull();
    expect(seen).toEqual([null, "req-1", null]);
    stop();
  });

  it("resolves rather than rejects when the reader declines", async () => {
    const pending = ask("req-2");
    dismissImageHandoff("req-2");
    const outcome = await pending;
    // A person declining to hand over a photo is an answer the Agent can act
    // on, not a tool failure it has to interpret.
    expect(outcome.status).toBe("dismissed");
    expect(currentImageHandoff()).toBeNull();
  });

  it("resolves when the agent cancels, so the drawer never outlives its request", async () => {
    const pending = ask("req-3");
    abortImageHandoff("req-3");
    await expect(pending).resolves.toMatchObject({ status: "dismissed" });
    expect(currentImageHandoff()).toBeNull();
  });

  it("supersedes an earlier request instead of queueing two drawers", async () => {
    const first = ask("req-4", "First ask.");
    const second = ask("req-5", "Second ask.");
    await expect(first).resolves.toMatchObject({ status: "dismissed" });
    expect(currentImageHandoff()?.requestId).toBe("req-5");
    expect(completeImageHandoff("req-4", ["asset:from-stale-request"])).toBe(false);
    expect(currentImageHandoff()?.requestId).toBe("req-5");
    expect(completeImageHandoff("req-5", ["asset:three"])).toBe(true);
    await expect(second).resolves.toMatchObject({ status: "provided" });
  });

  it("does not let a superseded request abort the request that replaced it", async () => {
    const first = ask("req-6", "First ask.");
    const second = ask("req-7", "Second ask.");
    await expect(first).resolves.toMatchObject({ status: "dismissed" });

    expect(abortImageHandoff("req-6")).toBe(false);
    expect(currentImageHandoff()?.requestId).toBe("req-7");
    expect(dismissImageHandoff("req-7")).toBe(true);
    await expect(second).resolves.toMatchObject({ status: "dismissed" });
  });

  it("gives a new subscriber the request that is already open", () => {
    void ask("req-8");
    const seen: Array<string | null> = [];
    const stop = subscribeToImageHandoff((request) => seen.push(request?.requestId ?? null));
    expect(seen).toEqual(["req-8"]);
    stop();
    dismissImageHandoff("req-8");
  });
});
