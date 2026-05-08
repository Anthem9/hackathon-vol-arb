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

create table if not exists paper_trade_events (
  id bigserial primary key,
  trade_id text not null,
  opportunity_id text not null,
  status text not null,
  payload jsonb not null,
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

create index if not exists paper_trade_events_trade_created_idx
  on paper_trade_events (trade_id, created_at desc);
