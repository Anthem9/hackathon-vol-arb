import { MockVenueAdapter } from "@vol-arb/adapters";

const adapter = new MockVenueAdapter();

export async function getDashboardData() {
  return adapter.getDashboardData();
}

export async function getOverview() {
  const data = await getDashboardData();
  return data.overview;
}

export async function getSurfaces() {
  const data = await getDashboardData();
  return data.surfaces;
}

export async function getOpportunities() {
  const data = await getDashboardData();
  return data.opportunities;
}

export async function getSviHealth() {
  const data = await getDashboardData();
  return data.sviHealth;
}

export async function getRiskRules() {
  const data = await getDashboardData();
  return data.riskRules;
}
