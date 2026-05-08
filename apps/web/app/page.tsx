import { Dashboard } from "../components/dashboard/dashboard";
import { fetchDashboardData } from "../lib/api-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  try {
    const initialData = await fetchDashboardData();
    return <Dashboard initialData={initialData} />;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown API error";
    return <Dashboard initialError={message} />;
  }
}
