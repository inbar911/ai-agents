create table if not exists processed_emails (
    gmail_message_id text primary key,
    processed_at timestamptz not null default now()
);

create table if not exists opportunities (
    id bigserial primary key,
    gmail_message_id text references processed_emails(gmail_message_id) on delete cascade,
    from_addr text,
    subject text,
    complaint text not null,
    domain text,
    created_at timestamptz not null default now()
);
create index if not exists opportunities_created_at_idx on opportunities(created_at desc);
create index if not exists opportunities_domain_idx on opportunities(domain);

create table if not exists processed_complaints (
    hash text primary key,
    source text,
    url text,
    created_at timestamptz not null default now()
);

create table if not exists ideas_history (
    id bigserial primary key,
    fingerprint text unique not null,
    title text not null,
    problem text not null,
    target_user text,
    solution text not null,
    evidence jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now()
);
create index if not exists ideas_history_created_at_idx on ideas_history(created_at desc);

create table if not exists ai_updates (
    id bigserial primary key,
    url text unique not null,
    source text not null,
    title text not null,
    summary text,
    score real not null default 0,
    captured_at timestamptz not null default now()
);
create index if not exists ai_updates_score_idx on ai_updates(score desc);
create index if not exists ai_updates_captured_at_idx on ai_updates(captured_at desc);

create table if not exists runs_log (
    id bigserial primary key,
    agent text not null,
    status text not null,
    payload_count int not null default 0,
    error text,
    ran_at timestamptz not null default now()
);
create index if not exists runs_log_agent_ran_at_idx on runs_log(agent, ran_at desc);
