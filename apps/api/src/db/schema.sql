create table if not exists dashboard_snapshots (
  id bigserial primary key,
  mode text not null check (mode in ('mock', 'hybrid', 'real')),
  system_status text not null,
  btc_spot numeric(20, 8) not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists source_status_snapshots (
  id bigserial primary key,
  snapshot_id bigint references dashboard_snapshots(id) on delete cascade,
  source_id text not null,
  label text not null,
  status text not null,
  mode text not null,
  latency_ms integer,
  detail text not null,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists alert_events (
  id bigserial primary key,
  alert_id text not null unique,
  rule_id text not null,
  title text not null,
  message text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  status text not null check (status in ('active', 'resolved')),
  source_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists alert_operator_events (
  id bigserial primary key,
  alert_id text not null,
  action text not null check (action in ('resolve', 'silence')),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists paper_trade_events (
  id bigserial primary key,
  trade_id text not null,
  opportunity_id text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists chain_transaction_events (
  id bigserial primary key,
  digest text not null unique,
  action text not null check (action in ('create_manager', 'deposit_quote', 'mint_binary', 'redeem_binary', 'withdraw_quote')),
  status text not null check (status in ('submitted', 'success', 'failed')),
  lifecycle_status text not null default 'submitted' check (lifecycle_status in ('pending', 'submitted', 'confirmed', 'indexed', 'reconciled', 'failed')),
  owner text,
  manager_id text,
  oracle_id text,
  expiry bigint,
  strike text,
  direction text,
  quantity text,
  payload jsonb not null default '{}'::jsonb,
  failure_reason text,
  observed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  indexed_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table chain_transaction_events
  add column if not exists lifecycle_status text not null default 'submitted';

alter table chain_transaction_events
  add column if not exists failure_reason text;

alter table chain_transaction_events
  add column if not exists confirmed_at timestamptz;

alter table chain_transaction_events
  add column if not exists indexed_at timestamptz;

alter table chain_transaction_events
  add column if not exists reconciled_at timestamptz;

update chain_transaction_events
set lifecycle_status = case
  when status = 'failed' then 'failed'
  when status = 'success' and lifecycle_status = 'submitted' then 'confirmed'
  else lifecycle_status
end;

create table if not exists wallet_manager_bindings (
  network text not null default 'testnet',
  owner text not null,
  manager_id text not null,
  source text not null default 'wallet_ui',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (network, owner)
);

create table if not exists wallet_mint_dry_run_events (
  id bigserial primary key,
  network text not null default 'testnet',
  owner text not null,
  manager_id text not null,
  oracle_id text not null,
  expiry bigint not null,
  strike text not null,
  direction text not null check (direction in ('up', 'down')),
  quantity text not null,
  status text not null check (status in ('success', 'failed')),
  dry_run_digest text,
  failure_reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists polymarket_btc5m_markets (
  slug text primary key,
  event_id text,
  market_id text,
  condition_id text,
  question text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  up_token_id text not null,
  down_token_id text not null,
  closed boolean not null default false,
  resolved boolean not null default false,
  winning_outcome text,
  raw_json jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists polymarket_btc5m_orderbook_snapshots (
  id bigserial primary key,
  market_slug text not null references polymarket_btc5m_markets(slug) on delete cascade,
  token_id text not null,
  outcome text not null check (outcome in ('up', 'down')),
  bid numeric(20, 8),
  ask numeric(20, 8),
  bid_size numeric(32, 8),
  ask_size numeric(32, 8),
  spread numeric(20, 8),
  snapshot_time timestamptz not null,
  collected_at timestamptz not null default now(),
  source text not null default 'clob_book',
  raw_json jsonb not null default '{}'::jsonb,
  unique (market_slug, token_id, snapshot_time, source)
);

create table if not exists polymarket_btc5m_price_history (
  id bigserial primary key,
  market_slug text not null references polymarket_btc5m_markets(slug) on delete cascade,
  token_id text not null,
  outcome text not null check (outcome in ('up', 'down')),
  price numeric(20, 8) not null,
  point_time timestamptz not null,
  fidelity_seconds integer not null,
  source text not null default 'clob_prices_history',
  raw_json jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  unique (market_slug, token_id, point_time, fidelity_seconds, source)
);

create table if not exists polymarket_btc5m_trades (
  id bigserial primary key,
  trade_id text,
  market_slug text not null references polymarket_btc5m_markets(slug) on delete cascade,
  token_id text not null,
  outcome text not null check (outcome in ('up', 'down')),
  price numeric(20, 8) not null,
  size numeric(32, 8),
  side text,
  trade_time timestamptz not null,
  transaction_hash text,
  source text not null default 'clob_data_trades',
  raw_json jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

create table if not exists btc_price_ticks (
  id bigserial primary key,
  source text not null,
  symbol text not null default 'BTC/USD',
  price numeric(20, 8) not null,
  source_timestamp timestamptz not null,
  collected_at timestamptz not null default now(),
  raw_json jsonb not null default '{}'::jsonb,
  unique (source, symbol, source_timestamp)
);

create table if not exists btc5m_backtest_runs (
  id bigserial primary key,
  run_id text not null unique,
  strategy text not null,
  parameters jsonb not null default '{}'::jsonb,
  data_start timestamptz,
  data_end timestamptz,
  initial_capital numeric(20, 8) not null,
  final_capital numeric(20, 8) not null,
  total_pnl numeric(20, 8) not null,
  max_drawdown numeric(20, 8) not null,
  win_rate numeric(10, 6) not null,
  trade_count integer not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists btc5m_backtest_orders (
  id bigserial primary key,
  run_id text not null references btc5m_backtest_runs(run_id) on delete cascade,
  market_slug text not null,
  token_id text not null,
  outcome text not null check (outcome in ('up', 'down')),
  action text not null check (action in ('limit_buy', 'limit_sell', 'settle', 'cancel')),
  limit_price numeric(20, 8),
  requested_size numeric(32, 8),
  filled_size numeric(32, 8) not null default 0,
  status text not null,
  submit_time timestamptz,
  fill_time timestamptz,
  cancel_time timestamptz,
  realized_pnl numeric(20, 8) not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists btc5m_paper_signals (
  id bigserial primary key,
  signal_id text not null unique,
  market_slug text not null,
  token_id text,
  outcome text check (outcome in ('up', 'down')),
  decision text not null,
  strategy text not null,
  limit_price numeric(20, 8),
  size numeric(32, 8),
  expected_risk numeric(20, 8),
  reason text not null,
  segment text not null,
  evaluation_status text not null default 'pending' check (evaluation_status in ('pending', 'settled', 'ignored')),
  winning_outcome text check (winning_outcome in ('up', 'down')),
  settlement_value numeric(20, 8),
  realized_pnl numeric(20, 8),
  evaluated_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table btc5m_paper_signals
  add column if not exists evaluation_status text not null default 'pending';

alter table btc5m_paper_signals
  add column if not exists winning_outcome text;

alter table btc5m_paper_signals
  add column if not exists settlement_value numeric(20, 8);

alter table btc5m_paper_signals
  add column if not exists realized_pnl numeric(20, 8);

alter table btc5m_paper_signals
  add column if not exists evaluated_at timestamptz;

create index if not exists dashboard_snapshots_created_at_idx
  on dashboard_snapshots (created_at desc);

create index if not exists source_status_snapshots_source_created_idx
  on source_status_snapshots (source_id, created_at desc);

create index if not exists alert_events_created_at_idx
  on alert_events (created_at desc);

create index if not exists alert_events_active_severity_idx
  on alert_events (severity, created_at desc)
  where status = 'active';

create index if not exists alert_events_metadata_gin_idx
  on alert_events using gin (metadata);

create index if not exists alert_operator_events_alert_created_idx
  on alert_operator_events (alert_id, created_at desc);

create index if not exists paper_trade_events_trade_created_idx
  on paper_trade_events (trade_id, created_at desc);

create index if not exists paper_trade_events_created_idx
  on paper_trade_events (created_at desc);

create index if not exists chain_transaction_events_created_idx
  on chain_transaction_events (created_at desc);

create index if not exists chain_transaction_events_manager_created_idx
  on chain_transaction_events (manager_id, created_at desc);

create index if not exists wallet_manager_bindings_manager_idx
  on wallet_manager_bindings (network, manager_id);

create index if not exists wallet_mint_dry_run_events_owner_created_idx
  on wallet_mint_dry_run_events (network, owner, created_at desc);

create index if not exists wallet_mint_dry_run_events_market_idx
  on wallet_mint_dry_run_events (network, owner, manager_id, oracle_id, expiry, strike, direction, created_at desc);

create index if not exists polymarket_btc5m_markets_time_idx
  on polymarket_btc5m_markets (start_time desc);

create index if not exists polymarket_btc5m_orderbook_market_time_idx
  on polymarket_btc5m_orderbook_snapshots (market_slug, snapshot_time);

create index if not exists polymarket_btc5m_price_history_market_time_idx
  on polymarket_btc5m_price_history (market_slug, point_time);

create index if not exists polymarket_btc5m_trades_market_time_idx
  on polymarket_btc5m_trades (market_slug, trade_time);

create unique index if not exists polymarket_btc5m_trades_unique_idx
  on polymarket_btc5m_trades (market_slug, token_id, trade_time, price, coalesce(size, 0), source);

create index if not exists btc_price_ticks_source_time_idx
  on btc_price_ticks (source, source_timestamp);

create index if not exists btc5m_backtest_runs_created_idx
  on btc5m_backtest_runs (created_at desc);

create index if not exists btc5m_backtest_orders_run_idx
  on btc5m_backtest_orders (run_id, market_slug);

create index if not exists btc5m_paper_signals_created_idx
  on btc5m_paper_signals (created_at desc);

create index if not exists btc5m_paper_signals_market_idx
  on btc5m_paper_signals (market_slug, created_at desc);
