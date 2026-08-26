/**
 * Tests for Kiro bootstrap model catalog classification.
 *
 * All Kiro models are free/zero-cost, so the isFreeModel Route A detection
 * (cost-based) should classify them all as free. The _pricingKnown and
 * _freeKnown stamps ensure reliable classification.
 */
import { describe, expect, it } from "vitest";
import { isFreeModel } from "../lib/registry.ts";
import { kiroModels } from "../providers/kiro/kiro-models.ts";

describe("Kiro bootstrap model catalog", () => {
  it("has 15 models in the bootstrap catalog", () => {
    expect(kiroModels.length).toBe(15);
  });

  it("all models have provider === 'kiro'", () => {
    for (const model of kiroModels) {
      expect(model.provider).toBe("kiro");
    }
  });

  it("all models use api === 'kiro-api'", () => {
    for (const model of kiroModels) {
      expect(model.api).toBe("kiro-api");
    }
  });

  it("all models have zero cost", () => {
    for (const model of kiroModels) {
      expect(model.cost.input).toBe(0);
      expect(model.cost.output).toBe(0);
      expect(model.cost.cacheRead).toBe(0);
      expect(model.cost.cacheWrite).toBe(0);
    }
  });

  it("all models have _pricingKnown, _freeKnown, _isFree stamps", () => {
    for (const model of kiroModels) {
      expect(model._pricingKnown).toBe(true);
      expect(model._freeKnown).toBe(true);
      expect(model._isFree).toBe(true);
    }
  });

  it("all models are classified as free by isFreeModel", () => {
    for (const model of kiroModels) {
      expect(isFreeModel(model, kiroModels)).toBe(true);
    }
  });

  it("all models have a valid id and name", () => {
    for (const model of kiroModels) {
      expect(model.id).toBeTruthy();
      expect(typeof model.id).toBe("string");
      expect(model.name).toBeTruthy();
      expect(typeof model.name).toBe("string");
    }
  });

  it("all models have positive contextWindow and maxTokens", () => {
    for (const model of kiroModels) {
      expect(model.contextWindow).toBeGreaterThan(0);
      expect(model.maxTokens).toBeGreaterThan(0);
    }
  });

  it("all models have input modalities", () => {
    for (const model of kiroModels) {
      expect(model.input.length).toBeGreaterThan(0);
      for (const modality of model.input) {
        expect(["text", "image"]).toContain(modality);
      }
    }
  });

  it("Claude models support images", () => {
    for (const model of kiroModels) {
      if (model.id.startsWith("claude-")) {
        expect(model.input).toContain("image");
      }
    }
  });

  it("non-Claude models only support text", () => {
    for (const model of kiroModels) {
      if (!model.id.startsWith("claude-") && model.id !== "auto") {
        expect(model.input).toEqual(["text"]);
      }
    }
  });

  it("every model has a kiroModelId that maps to/from the pi id", () => {
    for (const model of kiroModels) {
      expect(model.kiroModelId).toBeTruthy();
      // The pi id is derived by replacing dots with dashes
      const expectedPiId = model.kiroModelId.replace(/(\d)\.(\d)/g, "$1-$2");
      expect(model.id).toBe(expectedPiId);
    }
  });

  it("auto model is the last entry", () => {
    const last = kiroModels[kiroModels.length - 1];
    expect(last.id).toBe("auto");
    expect(last.kiroModelId).toBe("auto");
    expect(last.name).toBe("Auto");
  });
});

describe("Kiro model free classification via isFreeModel", () => {
  it("responds correctly to _freeKnown stamp", () => {
    // All Kiro models are stamped _freeKnown: true, _isFree: true
    const model = kiroModels[0];
    expect(isFreeModel(model, kiroModels)).toBe(true);

    // If we override _isFree to false, isFreeModel should respect it
    const paidModel = { ...model, _isFree: false };
    expect(isFreeModel(paidModel, kiroModels)).toBe(false);
  });

  it("falls back to Route B (name-based) when _freeKnown is not set and all models have zero cost", () => {
    const model = { ...kiroModels[0], _freeKnown: undefined, _isFree: undefined };
    // Since all Kiro models have zero cost, detectPricingExposed returns false
    // Route B requires "free" in the name, which Kiro model names don't have
    expect(isFreeModel(model, kiroModels)).toBe(false);
  });

  it("Route B classifies models with 'free' in the name when no pricing is exposed", () => {
    const model = { ...kiroModels[0], _freeKnown: undefined, _isFree: undefined, name: "Free Model" };
    // Route B: name contains "free" => free
    expect(isFreeModel(model, kiroModels)).toBe(true);
  });
});

describe("Kiro model IDs", () => {
  it("each model has a unique id", () => {
    const ids = kiroModels.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each model has a unique kiroModelId", () => {
    const ids = kiroModels.map((m) => m.kiroModelId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});