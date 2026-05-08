import { getOpportunities } from "../services/dashboard-service";

export async function opportunitiesRoute() {
  return getOpportunities();
}
