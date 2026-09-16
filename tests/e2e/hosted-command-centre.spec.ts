import { expect, test } from "@playwright/test";

const identityHeaders = {
  "x-hosted-user-id": "hosted-browser-review",
  "x-hosted-tenant-id": "hosted-browser-review-tenant",
};

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(identityHeaders);
});

test("keeps workspace features available when skills fail", async ({ page }) => {
  await page.route("**/api/skills", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unavailable" }),
    })
  );
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Today / Focus Board" })).toBeVisible();
  await page.getByRole("button", { name: "Skills" }).click();
  await expect(page.getByText("Skills could not be loaded.")).toBeVisible();
  await expect(page.locator(".hosted-error")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Work Queue" })).toBeVisible();
});

test("prevents duplicate work-item submissions", async ({ page }) => {
  let createRequests = 0;
  await page.route("**/api/hosted/domain**", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes("create-work-item")
    ) {
      createRequests += 1;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ workItem: { id: "guarded" } }),
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Work Queue" }).click();
  await page.getByLabel("Title").fill("Duplicate guard review");

  await page.getByRole("button", { name: "Capture work item" }).evaluate((element) => {
    const button = element as HTMLButtonElement;
    button.click();
    button.click();
  });

  await expect(page.getByText("Work item captured.")).toBeVisible();
  expect(createRequests).toBe(1);
});

test("keeps the latest workspace paired with its records", async ({ page }) => {
  const alpha = {
    id: "workspace-alpha",
    ownerId: "user",
    name: "Alpha",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const beta = {
    id: "workspace-beta",
    ownerId: "user",
    name: "Beta",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  await page.route("**/api/hosted/workspaces", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspaces: [alpha, beta], activeWorkspace: alpha }),
    })
  );
  await page.route("**/api/hosted/workspaces/*/select", async (route) => {
    const selected = route.request().url().includes(alpha.id) ? alpha : beta;
    if (selected === alpha) await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workspace: selected }),
    });
  });
  await page.route("**/api/hosted/domain**", (route) => {
    const title = route.request().url().includes(alpha.id) ? "Alpha record" : "Beta record";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        records: {
          workItems: [
            {
              id: title,
              title,
              status: "open",
              priority: "normal",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Workspaces" }).click();

  await page.getByRole("button", { name: /Alpha Active/ }).click();
  await page.getByRole("button", { name: /Beta Open workspace/ }).click();
  await expect(page.getByText("Beta is active.")).toBeVisible();
  await page.getByRole("button", { name: "Today" }).click();

  await expect(page.locator(".hosted-account > span").first()).toHaveText("Beta");
  await expect(page.getByText("Beta record")).toBeVisible();
  await expect(page.getByText("Alpha record")).toHaveCount(0);
});
