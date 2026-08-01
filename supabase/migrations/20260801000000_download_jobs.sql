create table if not exists public.download_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    run_id text not null unique,
    url text not null,
    source text not null check (source in ('mangadex', 'manual', 'weebcentral')),
    manga_id uuid null,
    manga_name text null,
    status text not null check (
        status in ('queued', 'running', 'completed', 'failed')
    ),
    progress integer not null default 0 check (
        progress >= 0
        and progress <= 100
    ),
    chapter_count integer null,
    stage text null,
    status_message text null,
    error text null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz null
);

create index if not exists download_jobs_user_id_updated_at_idx on public.download_jobs (user_id, updated_at desc);

create index if not exists download_jobs_user_id_status_idx on public.download_jobs (user_id, status);

alter table
    public.download_jobs enable row level security;

create policy "download_jobs_select_own" on public.download_jobs for
select
    using (auth.uid() = user_id);

create policy "download_jobs_insert_own" on public.download_jobs for
insert
    with check (auth.uid() = user_id);

create policy "download_jobs_update_own" on public.download_jobs for
update
    using (auth.uid() = user_id) with check (auth.uid() = user_id);