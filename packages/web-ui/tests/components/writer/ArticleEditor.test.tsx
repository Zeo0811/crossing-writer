import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getFinal: vi.fn(async () => `<!-- section:opening -->
opening body
`),
  rewriteSectionStream: vi.fn(async () => {}),
  putSection: vi.fn(async () => {}),
}));

import { ArticleEditor } from "../../../src/components/writer/ArticleEditor";

describe("ArticleEditor", () => {
  it("renders ArticleFlow for projectId", async () => {
    render(<ArticleEditor projectId="p" />);
    await waitFor(() => {
      expect(screen.getByTestId("card-opening")).toBeInTheDocument();
    });
  });
});
