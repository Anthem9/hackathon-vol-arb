export class PolymarketAdapter {
  venueName = "Polymarket";

  async healthCheck() {
    return {
      venue: this.venueName,
      status: "stub",
      reason: "Version 1 does not call external APIs. Real market discovery is reserved for Version 2.",
    };
  }
}
