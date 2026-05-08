import { getSurfaces } from "../services/dashboard-service";

export async function surfacesRoute() {
  return getSurfaces();
}
