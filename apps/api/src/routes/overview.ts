import { getOverview } from "../services/dashboard-service";

export async function overviewRoute() {
  return getOverview();
}
