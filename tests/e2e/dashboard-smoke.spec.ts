import { expect, test } from "@playwright/test";

test("production-like dashboard loads and primary anchors work", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle(/DeepBook Predict Vol-Arb Terminal/);
  await expect(page.getByRole("heading", { name: "BTC Vol-Arb Intelligence Terminal" })).toBeVisible();
  await expect(page.locator("#overview")).toBeVisible();
  await expect(page.locator("#opportunities")).toBeVisible();

  const tradeCells = page.getByText("TRADE", { exact: true });
  await expect(tradeCells).toHaveCount(0);

  await page.getByRole("link", { name: "Polymarket" }).click();
  await expect(page).toHaveURL(/#polymarket-readiness$/);
  await expect(page.getByRole("heading", { name: "Polymarket Trading Readiness" })).toBeVisible();
  await expect(page.getByText("Collateral", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Maintenance" }).click();
  await expect(page).toHaveURL(/#maintenance$/);
  await expect(page.getByRole("heading", { name: "Maintenance" })).toBeVisible();
  await expect(page.getByText("NO SIGNING", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Wallet" }).click();
  await expect(page).toHaveURL(/#wallet$/);
  await expect(page.locator("#wallet")).toBeVisible();
});
