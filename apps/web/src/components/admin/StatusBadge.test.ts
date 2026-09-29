import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

it("keeps a round's status and certificate total in one badge", () => {
  const html = renderToStaticMarkup(createElement(StatusBadge, { status: "PUBLISHED", count: 1166 }));
  expect(html).toContain("เผยแพร่แล้ว 1,166 ใบ");
  expect(html).toContain("whitespace-nowrap");
});
