import { describe, expect, it } from "vitest"

import {
  buildMessageRefSegments,
  buildMessageRefUrl,
  parseMessageRefUrl,
  stripStructuredRefPayload,
} from "./message-refs"

describe("message refs", () => {
  it("parses search request refs", () => {
    const href = buildMessageRefUrl({
      kind: "search_request",
      search_request_id: "artifact-123",
      label: "品牌组",
    })

    expect(parseMessageRefUrl(href)).toEqual({
      kind: "search_request",
      search_request_id: "artifact-123",
      label: "品牌组",
      source: undefined,
    })
  })

  it("parses bundle group refs", () => {
    const href = buildMessageRefUrl({
      kind: "bundle_group",
      artifact_id: "bundle-123",
      group_id: "artifact-456",
      label: "语义组",
    })

    expect(parseMessageRefUrl(href)).toEqual({
      kind: "bundle_group",
      artifact_id: "bundle-123",
      group_id: "artifact-456",
      label: "语义组",
    })
  })

  it("parses search plan refs", () => {
    const href = buildMessageRefUrl({
      kind: "search_plan",
      session_id: "session-1",
      label: "Akris 连衣裙",
      query: "red dress",
      brand: "Akris",
      categories: ["dress"],
      quarter: "FW",
    })

    expect(parseMessageRefUrl(href)).toEqual({
      kind: "search_plan",
      session_id: "session-1",
      label: "Akris 连衣裙",
      query: "red dress",
      brand: "Akris",
      categories: ["dress"],
      gender: undefined,
      quarter: "FW",
      year_min: undefined,
      image_type: undefined,
      source: undefined,
    })
  })

  it("builds structured segments from exact span annotations", () => {
    const target = {
      kind: "search_request" as const,
      search_request_id: "artifact-123",
      label: "Akris",
    }
    const content = "这一组里 Akris 的轮廓更干净，建议先看 Akris。"

    expect(buildMessageRefSegments(content, [{
      type: "message_ref_spans",
      items: [
        {
          target,
          quote: "Akris",
          occurrence: 2,
        },
      ],
    }])).toEqual([
      { type: "text", text: "这一组里 Akris 的轮廓更干净，建议先看 " },
      { type: "ref", text: "Akris", target },
      { type: "text", text: "。" },
    ])
  })

  it("falls back to inline numeric refs when phrases cannot be matched", () => {
    const target = {
      kind: "search_request" as const,
      search_request_id: "artifact-456",
      label: "精筛结果",
    }

    expect(buildMessageRefSegments("这一组更贴近你的需求。", [{
      type: "message_refs",
      items: [
        {
          target,
          phrases: ["Akris"],
        },
      ],
    }])).toEqual([
      { type: "text", text: "这一组更贴近你的需求。" },
      { type: "text", text: " " },
      { type: "ref", text: "[1]", target },
    ])
  })

  it("converts legacy aimoda markdown links into structured segments", () => {
    const target = {
      kind: "search_request" as const,
      search_request_id: "artifact-789",
      label: "Dior",
    }
    const href = buildMessageRefUrl(target)

    expect(buildMessageRefSegments(`建议先看 [Dior](${href})。`)).toEqual([
      { type: "text", text: "建议先看 " },
      { type: "ref", text: "Dior", target },
      { type: "text", text: "。" },
    ])
  })

  it("strips hidden structured ref payload from visible text", () => {
    const content = '建议先看 Akris。[AIMODA_REFS]{"items":[{"quote":"Akris","query":"minimal akris dress"}]}[/AIMODA_REFS]'
    expect(stripStructuredRefPayload(content)).toBe("建议先看 Akris。")
  })
})
