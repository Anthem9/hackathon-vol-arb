export class DeepBookPredictAdapter {
  venueName = "DeepBook Predict";

  async healthCheck() {
    return {
      venue: this.venueName,
      status: "stub",
      reason: "Version 1 uses deterministic mock data. Real OracleSVI integration is reserved for Version 2.",
    };
  }
}
