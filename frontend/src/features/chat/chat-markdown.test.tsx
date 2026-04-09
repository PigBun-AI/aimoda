import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ChatMarkdown } from "./chat-markdown"
import { buildMessageRefUrl } from "./message-refs"

describe("ChatMarkdown", () => {
  it("renders annotated refs as inline buttons and dispatches clicks", async () => {
    const user = userEvent.setup()
    const onMessageRefClick = vi.fn()
    const target = {
      kind: "search_request" as const,
      search_request_id: "artifact-123",
      label: "Dior",
    }

    render(
      <ChatMarkdown
        content="建议先看 Dior 的这一组。"
        annotations={[
          {
            type: "message_ref_spans",
            items: [{ quote: "Dior", occurrence: 1, target }],
          },
        ]}
        onMessageRefClick={onMessageRefClick}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Dior" }))

    expect(onMessageRefClick).toHaveBeenCalledWith(target)
  })

  it("keeps normal markdown links as external anchors", () => {
    render(<ChatMarkdown content="查看 [OpenAI](https://openai.com) 文档。" />)

    const link = screen.getByRole("link", { name: "OpenAI" })
    expect(link).toHaveAttribute("href", "https://openai.com")
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("renders legacy aimoda links as inline buttons instead of anchors", async () => {
    const user = userEvent.setup()
    const onMessageRefClick = vi.fn()
    const target = {
      kind: "search_request" as const,
      search_request_id: "artifact-456",
      label: "Dior",
    }
    const href = buildMessageRefUrl(target)

    render(
      <ChatMarkdown
        content={`建议先看 [Dior](${href})。`}
        onMessageRefClick={onMessageRefClick}
      />,
    )

    expect(screen.queryByRole("link", { name: "Dior" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Dior" }))
    expect(onMessageRefClick).toHaveBeenCalledWith(target)
  })
})
