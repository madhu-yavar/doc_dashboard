import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NoteRichText from "./NoteRichText";

describe("NoteRichText", () => {
  it("renders bold markers and list items instead of showing raw markdown", () => {
    render(
      <NoteRichText
        text={`**Priority:** Review today

- First action
- Second action`}
      />,
    );

    expect(screen.getByText("Priority:")).toBeInTheDocument();
    expect(screen.queryByText("**Priority:**")).not.toBeInTheDocument();
    expect(screen.getByText("First action")).toBeInTheDocument();
    expect(screen.getByText("Second action")).toBeInTheDocument();
  });
});
