import { describe, expect, it } from "vitest";
import {
  classifyHttpResponse,
  classifyPostgrestError,
  classifyStorageError,
  classifyThrownError,
} from "../classify";

describe("retry classifiers", () => {
  it("classifies 429 as rate_limit and retryable", async () => {
    await expect(classifyHttpResponse(new Response(null, { status: 429 }))).resolves.toEqual({
      retryable: true,
      reason: "rate_limit",
    });
  });

  it("classifies 5xx as server and retryable", async () => {
    await expect(classifyHttpResponse(new Response(null, { status: 503 }))).resolves.toEqual({
      retryable: true,
      reason: "server",
    });
  });

  it("classifies 4xx other than 429 as terminal", async () => {
    await expect(classifyHttpResponse(new Response(null, { status: 400 }))).resolves.toEqual({
      retryable: false,
      reason: "terminal",
    });
    await expect(classifyHttpResponse(new Response(null, { status: 401 }))).resolves.toEqual({
      retryable: false,
      reason: "terminal",
    });
  });

  it("classifies insufficient_quota as terminal", async () => {
    const body = JSON.stringify({ error: { code: "insufficient_quota" } });
    const byCode = new Response(body, { status: 429 });
    const byType = new Response(
      JSON.stringify({ error: { type: "insufficient_quota" } }),
      { status: 429 },
    );

    await expect(classifyHttpResponse(byCode)).resolves.toEqual({
      retryable: false,
      reason: "terminal",
    });
    await expect(classifyHttpResponse(byType)).resolves.toEqual({
      retryable: false,
      reason: "terminal",
    });
  });

  it("classifies AbortError as timeout", () => {
    const error = Object.assign(new Error("aborted"), { name: "AbortError" });

    expect(classifyThrownError(error)).toEqual({
      retryable: true,
      reason: "timeout",
    });
  });

  it("classifies generic network errors as network", () => {
    expect(classifyThrownError(new TypeError("fetch failed"))).toEqual({
      retryable: true,
      reason: "network",
    });
  });

  it("classifies transient SQLSTATE as retryable", () => {
    for (const code of ["08001", "40001", "40P01", "PGRST000", "PGRST003"]) {
      expect(classifyPostgrestError({ code, message: "temporary" })).toEqual({
        retryable: true,
        reason: "network",
      });
    }
    expect(classifyPostgrestError({ code: "23514", message: "constraint" })).toEqual({
      retryable: false,
      reason: "terminal",
    });
  });

  it("classifies a missing error code as retryable", () => {
    expect(classifyPostgrestError({ message: "connection dropped" })).toEqual({
      retryable: true,
      reason: "network",
    });
  });

  it("classifies transient storage status codes and leaves bad payloads terminal", () => {
    expect(
      classifyStorageError({ data: null, error: { statusCode: 503, message: "busy" } }),
    ).toEqual({ retryable: true, reason: "server" });
    expect(
      classifyStorageError({ data: null, error: { statusCode: 400, message: "bad payload" } }),
    ).toEqual({ retryable: false, reason: "terminal" });
    expect(
      classifyStorageError({
        data: null,
        error: {
          message: "fetch failed",
          originalError: new TypeError("fetch failed"),
        },
      }),
    ).toEqual({ retryable: true, reason: "network" });
  });
});
