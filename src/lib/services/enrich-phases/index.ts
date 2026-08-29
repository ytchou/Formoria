export * from "./clean";
export * from "./links";
export * from "./descriptions";
export * from "./reputation";
export * from "./faq";
export * from "./products";
export * from "./images";
export * from "./classify-images";
export * from "./discover";
// Explicit, not a wildcard: `image-search` and `descriptions` each hold their own
// private `preferPatched`, and two wildcards would collide on that name (TS2308).
// The phase entry point is the only symbol this barrel needs to publish; the
// helper stays reachable at `./image-search` for its own test.
export { runImageSearchPhase } from "./image-search";
export * from "./detect";
export * from "./names";
export * from "./site-identity";
export * from "./stockists";
export * from "./types";
