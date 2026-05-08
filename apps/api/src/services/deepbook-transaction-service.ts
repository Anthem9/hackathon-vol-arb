const CLOCK_OBJECT_ID = "0x6";

type BuildTradeBody = {
  account?: string;
  managerId?: string;
  oracleId?: string;
  expiry?: number;
  strike?: number;
  quantity?: number;
  direction?: "up" | "down";
  action?: "create_manager" | "preview_binary" | "mint_binary";
};

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredNumber(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} is required`);
  }
  return Math.trunc(value);
}

function packageId() {
  return process.env.DEEPBOOK_PREDICT_PACKAGE_ID ?? "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
}

function predictObjectId() {
  return process.env.DEEPBOOK_PREDICT_OBJECT_ID ?? "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
}

function quoteAssetType() {
  return process.env.DEEPBOOK_QUOTE_ASSET_TYPE ?? "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
}

export function buildDeepBookTradeIntent(body: unknown) {
  const input = typeof body === "object" && body !== null ? (body as BuildTradeBody) : {};
  const action = input.action ?? "create_manager";
  const pkg = packageId();

  if (action === "create_manager") {
    return {
      network: "testnet",
      safeMode: "wallet_sign_required",
      action,
      description: "Create a shared PredictManager for the connected wallet.",
      calls: [
        {
          target: `${pkg}::predict::create_manager`,
          arguments: [],
          typeArguments: [],
        },
      ],
    };
  }

  const oracleId = requiredString(input.oracleId, "oracleId");
  const expiry = requiredNumber(input.expiry, "expiry");
  const strike = requiredNumber(input.strike, "strike");
  const quantity = requiredNumber(input.quantity, "quantity");
  const direction = input.direction ?? "up";

  const keyCall = {
    target: `${pkg}::market_key::${direction}`,
    arguments: [oracleId, expiry, strike],
    typeArguments: [],
  };

  if (action === "preview_binary") {
    return {
      network: "testnet",
      safeMode: "read_only_preview",
      action,
      description: "Preview DeepBook Predict binary mint cost and redeem payout.",
      calls: [
        {
          target: `${pkg}::predict::get_trade_amounts`,
          arguments: [predictObjectId(), oracleId, keyCall, quantity, CLOCK_OBJECT_ID],
          typeArguments: [],
        },
      ],
    };
  }

  const managerId = requiredString(input.managerId, "managerId");
  return {
    network: "testnet",
    safeMode: "dry_run_first",
    action,
    description: "Build a DeepBook Predict testnet mint transaction. UI keeps execution behind wallet confirmation and dry-run controls.",
    calls: [
      {
        target: `${pkg}::market_key::${direction}`,
        arguments: [oracleId, expiry, strike],
        typeArguments: [],
        assignTo: "marketKey",
      },
      {
        target: `${pkg}::predict::mint`,
        arguments: [predictObjectId(), managerId, oracleId, "marketKey", quantity, CLOCK_OBJECT_ID],
        typeArguments: [quoteAssetType()],
      },
    ],
  };
}
