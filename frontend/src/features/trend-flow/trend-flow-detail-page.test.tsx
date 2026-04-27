import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTER_FUTURE } from "@/app/router-future";
import "@/i18n";
import { TrendFlowDetailPage } from "@/features/trend-flow/trend-flow-detail-page";
import { useTrendFlowDetail } from "@/features/trend-flow/use-trend-flow-detail";
import { ApiError } from "@/lib/api";

const mockedUseTrendFlowDetail = vi.fn();

vi.mock("@/features/trend-flow/use-trend-flow-detail", () => ({
  useTrendFlowDetail: (...args: Parameters<typeof useTrendFlowDetail>) =>
    mockedUseTrendFlowDetail(...args),
}));

describe("TrendFlowDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows membership lock state for 403 responses", () => {
    mockedUseTrendFlowDetail.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new ApiError("subscription required", 403),
    });

    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/trend-flow/1"]} future={ROUTER_FUTURE}>
          <Routes>
            <Route
              path="/trend-flow/:trendFlowId"
              element={<TrendFlowDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen.getByText("Full trend-flow archives require membership access"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open membership" }),
    ).toHaveAttribute("href", "/profile?tab=access");
  });
});
