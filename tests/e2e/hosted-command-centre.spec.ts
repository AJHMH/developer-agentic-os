import { expect, test } from "@playwright/test";

const identityHeaders = {
  "x-hosted-user-id": "hosted-browser-review",
  "x-hosted-tenant-id": "hosted-browser-review-tenant",
};

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(identityHeaders);
});

test("renders the unified Command Centre shell and stays resilient when skills fail", async ({
  page,
}) => {
  await page.route("**/api/skills", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unavailable" }),
    })
  );
  await page.goto("/");

  // Verify unified Command Centre shell elements are rendered
  await expect(page.getByRole("main", { name: "Developer Agentic OS dashboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Developer/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Central workspace graph" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Work Queue" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Focus Board/ })).toBeVisible();

  // Micro-apps launcher remains accessible in Left Rail
  await expect(page.getByRole("button", { name: /Workspace Switcher/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Second Brain/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Session Handoff/ })).toBeVisible();
});

test("captures and inspects a work item in hosted environment", async ({ page }) => {
  await page.goto("/");

  const title = `Hosted work item ${Date.now()}`;
  const workQueue = page.getByRole("region", { name: "Work Queue" });
  await expect(workQueue.getByRole("heading", { name: "Work Queue" })).toBeVisible();

  await workQueue.getByLabel("Work item title").fill(title);
  await workQueue.getByLabel("Work item notes").fill("Notes for hosted review");
  await workQueue.getByRole("button", { name: "Capture" }).click();

  // Verify the newly captured work item appears in the list
  const itemButton = workQueue.getByRole("button", { name: new RegExp(title) });
  await expect(itemButton).toBeVisible();

  // Click to open WorkItemInspector
  await itemButton.click();
  const inspector = page.getByRole("complementary", { name: "Work Item Inspector" });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(title);

  // Close inspector
  await inspector.getByRole("button", { name: "Close" }).click();
  await expect(inspector).toHaveCount(0);
});

test("switches hosted workspace and launches Second Brain micro-app", async ({ page }) => {
  await page.goto("/");

  // Launch Workspace Switcher drawer
  await page.getByRole("button", { name: /Workspace Switcher/ }).click();
  const switcher = page.getByRole("region", { name: "Workspace Switcher" });
  await expect(switcher).toBeVisible();
  await expect(switcher.getByText("Workspace Switcher")).toBeVisible();

  // Close Workspace Switcher by toggling
  await page.getByRole("button", { name: /Workspace Switcher/ }).click();
  await expect(switcher).toHaveCount(0);

  // Launch Second Brain micro-app from Left Rail
  const secondBrainButton = page.getByRole("button", { name: /Second Brain/ });
  await secondBrainButton.click();
  const secondBrain = page.getByRole("region", { name: "Second Brain Explorer" });
  await expect(secondBrain).toBeVisible();
  await expect(secondBrain.getByPlaceholder("Search nodes or paths...")).toBeVisible();
  await expect(secondBrain.getByText(/Nodes:/)).toBeVisible();

  // Close Second Brain by toggling
  await secondBrainButton.click();
  await expect(secondBrain).toHaveCount(0);
});
