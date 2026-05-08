import { getSviHealth } from "../services/dashboard-service";

export async function sviHealthRoute() {
  return getSviHealth();
}
