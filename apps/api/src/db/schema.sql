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
