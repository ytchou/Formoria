import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  AUDITED_PHASES,
  CURATION_TASKS,
  CURATION_TASK_ORDER,
  DEFERRED_PHASES,
  ENRICH_LLM_PHASES,
  ENRICH_PHASES,
  ENRICH_STAGE_GROUPS,
  IMAGE_ENRICH_PHASES,
  LOCAL_PHASES,
  PHASE_DEPENDENCIES,
  SERP_PHASES,
  SUB_PHASES,
  TEXT_ENRICH_PHASES,
  isDeferredPhase,
  parseLegacyStepsToPhases,
  phasesForTask,
} from "../enrich-phases";

describe("scoped enrich phase sets", () => {
  it("registry exhaustiveness — every non-deferred phase assigned to exactly one stage", () => {
    const assigned = new Set<string>([
      ...SERP_PHASES,
      ...ENRICH_LLM_PHASES,
      ...LOCAL_PHASES,
    ]);
    const nonDeferred = ENRICH_PHASES.filter(
      (phase) => !(DEFERRED_PHASES as readonly string[]).includes(phase),
    );
    expect(assigned.size).toBe(nonDeferred.length);
    expect(assigned).toEqual(new Set(nonDeferred));
  });

  it("acquire_in_enrich_phases", () => {
    expect(ENRICH_PHASES).toContain("acquire");
  });

  it("acquire_is_placed_after_links_in_enrich_phases_order", () => {
    const linksIdx = ENRICH_PHASES.indexOf("links");
    const acquireIdx = ENRICH_PHASES.indexOf("acquire");
    expect(acquireIdx).toBeGreaterThan(linksIdx);
  });

  it("products_runs_after_acquire", () => {
    const products = ENRICH_PHASES.indexOf("products");
    const acquire = ENRICH_PHASES.indexOf("acquire");
    expect(products).toBeGreaterThan(acquire);
  });

  it("only contains phases that exist in ENRICH_PHASES", () => {
    const all = ENRICH_PHASES as readonly string[];
    for (const phase of IMAGE_ENRICH_PHASES) expect(all).toContain(phase);
    for (const phase of TEXT_ENRICH_PHASES) expect(all).toContain(phase);
  });

  it("keeps the image and text sets disjoint", () => {
    const image = new Set<string>(IMAGE_ENRICH_PHASES);
    expect(TEXT_ENRICH_PHASES.some((phase) => image.has(phase))).toBe(false);
  });

  it("covers every phase across both sets", () => {
    expect([...IMAGE_ENRICH_PHASES, ...TEXT_ENRICH_PHASES].sort()).toEqual(
      [...ENRICH_PHASES].sort(),
    );
  });
});

describe("sub-phases", () => {
  it("keeps sub-phases out of ENRICH_PHASES", () => {
    const all = new Set<string>(ENRICH_PHASES);
    for (const phase of SUB_PHASES) {
      expect(all.has(phase), `${phase} is both a phase and a sub-phase`).toBe(
        false,
      );
    }
  });

  it("assigns no sub-phase to a task", () => {
    const assigned = new Set<string>(
      Object.values(CURATION_TASKS).flatMap((phases) => [...phases]),
    );
    for (const phase of SUB_PHASES) {
      expect(
        assigned.has(phase),
        `${phase} is a sub-phase but selectable via a task`,
      ).toBe(false);
    }
  });

  it("unions the two sets into AUDITED_PHASES with no duplicates", () => {
    expect([...AUDITED_PHASES].sort()).toEqual(
      [...ENRICH_PHASES, ...SUB_PHASES].sort(),
    );
    expect(new Set(AUDITED_PHASES).size).toBe(AUDITED_PHASES.length);
  });
});

describe("audited phase coverage", () => {
  const NON_BRAND_PHASES = new Set(["preflight", "job"]);

  const servicesDir = fileURLToPath(new URL("../../services", import.meta.url));

  function collectPhaseLiterals(): Map<string, Set<string>> {
    const found = new Map<string, Set<string>>();
    const entries = readdirSync(servicesDir, { recursive: true }) as string[];
    for (const entry of entries) {
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
      if (entry.includes("__tests__") || entry.includes(".test.")) continue;
      const source = readFileSync(`${servicesDir}/${entry}`, "utf8");
      const patterns = [
        /buildPhaseResult\(\s*['"]([a-z_-]+)['"]/g,
        /\bphase:\s*['"]([a-z_-]+)['"]/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          const phase = match[1];
          if (!phase) continue;
          const files = found.get(phase) ?? new Set<string>();
          files.add(entry);
          found.set(phase, files);
        }
      }
    }
    return found;
  }

  it("covers every phase string the services can write with a constant", () => {
    const literals = collectPhaseLiterals();
    const known = new Set<string>(AUDITED_PHASES);
    const uncovered = [...literals.entries()]
      .filter(([phase]) => !known.has(phase) && !NON_BRAND_PHASES.has(phase))
      .map(([phase, files]) => `${phase} (${[...files].sort().join(", ")})`);
    expect(
      uncovered,
      `phase strings written by the services but present in no constant: ${uncovered.join("; ")} — add each to ENRICH_PHASES or SUB_PHASES`,
    ).toEqual([]);
  });

  it("finds the known phase writers, so the scan cannot silently match nothing", () => {
    const literals = collectPhaseLiterals();
    for (const phase of [
      "facts",
      "descriptions",
      "stockists",
      "classification",
    ]) {
      expect(literals.has(phase), `scan found no writer for ${phase}`).toBe(
        true,
      );
    }
  });
});

describe("deferred phases", () => {
  it("reports exactly the DEFERRED_PHASES members as deferred", () => {
    for (const phase of DEFERRED_PHASES)
      expect(isDeferredPhase(phase)).toBe(true);
    for (const phase of ENRICH_PHASES) {
      if ((DEFERRED_PHASES as readonly string[]).includes(phase)) continue;
      expect(isDeferredPhase(phase), `${phase} is not deferred`).toBe(false);
    }
    expect(isDeferredPhase("not-a-phase")).toBe(false);
  });

  it("deferred_phases_includes_retired", () => {
    const retired = [
      "discover",
      "clean",
      "links",
      "site_identity",
      "images",
      "classify_images",
    ];
    for (const phase of retired) {
      expect(
        isDeferredPhase(phase),
        `${phase} should be deferred`,
      ).toBe(true);
    }
  });
});

describe("phase dependencies and task vocabulary", () => {
  it("PHASE_DEPENDENCIES covers every ENRICH_PHASES member", () => {
    for (const phase of ENRICH_PHASES) {
      expect(
        phase in PHASE_DEPENDENCIES,
        `${phase} has no dependency entry`,
      ).toBe(true);
    }
  });

  it("PHASE_DEPENDENCIES references only known phases", () => {
    const all = new Set<string>(ENRICH_PHASES);
    for (const [phase, deps] of Object.entries(PHASE_DEPENDENCIES)) {
      for (const dep of deps) {
        expect(all.has(dep), `${phase} depends on unknown phase ${dep}`).toBe(
          true,
        );
      }
    }
  });

  it("PHASE_DEPENDENCIES has no self-references or cycles of length 1", () => {
    for (const [phase, deps] of Object.entries(PHASE_DEPENDENCIES)) {
      expect(
        (deps as readonly string[]).includes(phase),
        `${phase} depends on itself`,
      ).toBe(false);
    }
  });

  it("phase_dependencies_acquire", () => {
    expect(PHASE_DEPENDENCIES.acquire).toEqual(["detect"]);
  });

  it("every_phase_belongs_to_a_task_or_is_deferred", () => {
    const assigned = new Set<string>(
      Object.values(CURATION_TASKS).flatMap((phases) => [...phases]),
    );
    const unassigned = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !assigned.has(phase),
    );
    expect(
      unassigned,
      `phases with no task assignment: ${unassigned.join(", ") || "(none)"} — add each to a CURATION_TASKS entry or to DEFERRED_PHASES if the omission is deliberate`,
    ).toEqual([...DEFERRED_PHASES]);
  });

  it("visual_task_closure", () => {
    const closure = phasesForTask("visual");
    expect(closure).toEqual(
      expect.arrayContaining(["detect", "acquire", "names", "products"]),
    );
    expect(closure).toHaveLength(4);
    // Must exclude deferred phases
    expect(closure).not.toContain("images");
    expect(closure).not.toContain("classify_images");
    expect(closure).not.toContain("links");
    expect(closure).not.toContain("site_identity");
    // Must exclude unrelated phases
    expect(closure).not.toContain("descriptions");
    expect(closure).not.toContain("faq");
  });

  it("identity_task_closure", () => {
    const closure = phasesForTask("identity");
    expect(closure).toContain("acquire");
    expect(closure).toContain("detect");
    expect(closure).toContain("slugs");
    expect(closure).toContain("names");
    // Must exclude deferred phases
    expect(closure).not.toContain("discover");
    expect(closure).not.toContain("clean");
    expect(closure).not.toContain("links");
    expect(closure).not.toContain("site_identity");
  });

  it("editorial_task_closure", () => {
    const closure = phasesForTask("editorial");
    expect(closure).toContain("acquire");
    expect(closure).toContain("detect");
    expect(closure).toContain("descriptions");
    expect(closure).toContain("faq");
    expect(closure).toContain("tags");
    expect(closure).toContain("stockists");
    // Must exclude deferred phases
    expect(closure).not.toContain("links");
    expect(closure).not.toContain("site_identity");
  });

  it("hidden_alias_image_resolves_full_visual_phases", () => {
    const visual = phasesForTask("visual");
    const image = phasesForTask("image");
    expect(image).toEqual(visual);
  });

  it("hidden_alias_product_resolves_full_visual_phases", () => {
    const visual = phasesForTask("visual");
    const product = phasesForTask("product");
    expect(product).toEqual(visual);
  });

  it("full_task_excludes_deferred", () => {
    const closure = phasesForTask("full");
    for (const phase of DEFERRED_PHASES) {
      expect(closure).not.toContain(phase);
    }
    // Should include all non-deferred phases
    const expected = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !(DEFERRED_PHASES as readonly string[]).includes(phase),
    );
    expect(closure).toEqual(expected);
  });

  it("closure_is_ordered_by_enrich_phases", () => {
    // Every task's closure must be in ENRICH_PHASES order
    for (const task of CURATION_TASK_ORDER) {
      const closure = phasesForTask(task);
      const indices = closure.map((phase) => ENRICH_PHASES.indexOf(phase));
      for (let i = 1; i < indices.length; i++) {
        expect(
          indices[i],
          `${task}: ${closure[i]} appears before ${closure[i - 1]} in the closure but after it in ENRICH_PHASES`,
        ).toBeGreaterThan(indices[i - 1]!);
      }
    }
  });

  it("task_order_contains_visual_not_image_or_product", () => {
    expect([...CURATION_TASK_ORDER]).toEqual([
      "identity",
      "visual",
      "editorial",
      "full",
    ]);
    // Hidden aliases exist as task keys but are excluded from the order
    expect(CURATION_TASKS).toHaveProperty("image");
    expect(CURATION_TASKS).toHaveProperty("product");
    expect(CURATION_TASK_ORDER).not.toContain("image");
    expect(CURATION_TASK_ORDER).not.toContain("product");
  });

  it("CURATION_TASK_ORDER entries are all valid task keys", () => {
    for (const task of CURATION_TASK_ORDER) {
      expect(CURATION_TASKS).toHaveProperty(task);
    }
  });
});

describe("parseLegacyStepsToPhases", () => {
  it("expands a legacy step into phases in ENRICH_PHASES order", () => {
    expect(parseLegacyStepsToPhases(["image"])).toEqual([
      "images",
      "classify_images",
    ]);
  });

  it("legacy_step_context_resolves", () => {
    const result = parseLegacyStepsToPhases(["context"]);
    expect(result).toContain("acquire");
    expect(result).toContain("detect");
    expect(result).toContain("slugs");
    expect(result).toContain("names");
  });

  it("expands all legacy steps covering all mapped phases", () => {
    const result = parseLegacyStepsToPhases(["context", "image", "detail"]);
    expect(result).toBeDefined();
    // context + image + detail covers: detect, slugs, acquire, names,
    // images, classify_images, descriptions, faq, products, tags, stockists
    // (some are deferred but still in ENRICH_PHASES for historical parsing)
    expect(result).toContain("detect");
    expect(result).toContain("acquire");
    expect(result).toContain("names");
    expect(result).toContain("products");
  });

  it("drops unknown step names", () => {
    expect(parseLegacyStepsToPhases(["unknown"])).toBeUndefined();
  });

  it("returns undefined for empty input", () => {
    expect(parseLegacyStepsToPhases([])).toBeUndefined();
  });
});

describe("SERP vs enrichment stage groups", () => {
  const groups = Object.entries(ENRICH_STAGE_GROUPS) as [
    string,
    readonly string[],
  ][];

  it("stage_groups_exhaustive — every non-deferred phase assigned to exactly one stage", () => {
    const assigned = new Set<string>(groups.flatMap(([, phases]) => phases));
    const nonDeferred = (ENRICH_PHASES as readonly string[]).filter(
      (phase) => !(DEFERRED_PHASES as readonly string[]).includes(phase),
    );
    const unassigned = nonDeferred.filter(
      (phase) => !assigned.has(phase),
    );
    expect(
      unassigned,
      `non-deferred phases with no stage assignment: ${unassigned.join(", ") || "(none)"} — add each to SERP_PHASES, ENRICH_LLM_PHASES, or LOCAL_PHASES`,
    ).toEqual([]);
  });

  it("assigns no phase outside ENRICH_PHASES", () => {
    const all = new Set<string>(ENRICH_PHASES);
    for (const [name, phases] of groups) {
      const unknown = phases.filter((phase) => !all.has(phase));
      expect(
        unknown,
        `${name} contains unknown phases: ${unknown.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("assigns each phase to exactly one stage", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [name, phases] of groups) {
      for (const phase of phases) {
        const owner = seen.get(phase);
        if (owner) {
          duplicates.push(`${phase} (in ${owner} and ${name})`);
        } else {
          seen.set(phase, name);
        }
      }
    }
    expect(
      duplicates,
      `phases assigned to more than one stage: ${duplicates.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps every pair of stage groups disjoint", () => {
    for (const [nameA, phasesA] of groups) {
      for (const [nameB, phasesB] of groups) {
        if (nameA === nameB) continue;
        const overlap = phasesA.filter((phase) => phasesB.includes(phase));
        expect(
          overlap,
          `${nameA} overlaps ${nameB}: ${overlap.join(", ")}`,
        ).toEqual([]);
      }
    }
  });

  it("has no duplicates within a single stage group", () => {
    for (const [name, phases] of groups) {
      expect(new Set(phases).size, `${name} has duplicate entries`).toBe(
        phases.length,
      );
    }
  });

  it("acquire is in the LLM stage", () => {
    expect(ENRICH_LLM_PHASES).toContain("acquire");
  });

  it("deferred phases are not in any stage group", () => {
    const assigned = new Set<string>(groups.flatMap(([, phases]) => phases));
    for (const phase of DEFERRED_PHASES) {
      expect(
        assigned.has(phase),
        `deferred phase ${phase} is assigned to a stage group`,
      ).toBe(false);
    }
  });
});
