import { mockDashboardData, mockInstruments, mockSviParams } from "./mock-market-data";

export class MockVenueAdapter {
  venueName = "Mock Composite Venue";

  async getDashboardData() {
    return mockDashboardData;
  }

  async discoverMarkets() {
    return mockInstruments;
  }

  async getSviParams() {
    return mockSviParams;
  }

  async healthCheck() {
    return {
      venue: this.venueName,
      status: "healthy",
      mode: "deterministic-mock",
    };
  }
}
