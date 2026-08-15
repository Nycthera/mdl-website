-- Links each legacy manga_data row to the MangaDex series it should be
-- checked against. Nullable because existing rows have no link yet —
-- "Check now" is simply unavailable in the UI until a row is linked.
alter table
    if exists public.manga_data
add
    column if not exists mangadex_id uuid null;

create index if not exists manga_data_mangadex_id_idx on public.manga_data (mangadex_id)
where
    mangadex_id is not null;