-- Создаём таблицу knowledge_base для хранения эмбеддингов, которые пишет ассистент через n8n.

create extension if not exists pgcrypto with schema public;
create extension if not exists vector with schema public;

drop table if exists public.knowlage_base cascade;
drop table if exists public.knowledge_base cascade;

create table public.knowledge_base (
  id uuid primary key default gen_random_uuid(),
  source text,                                        -- Произвольный источник данных (например, имя файла или URL).
  source_ref text,                                    -- Дополнительная ссылка/идентификатор в исходной системе.
  content text not null,                              -- Нормализованный текст фрагмента, который индексируется.
  chunk_hash text not null,                           -- Детеминированный хэш содержимого для дедупликации.
  embedding vector(1536) not null,                    -- Векторное представление (pgvector) фрагмента.
  metadata jsonb default '{}'::jsonb not null,        -- Произвольные метаданные (теги, автор, язык и т.п.).
  tokens integer,                                     -- Количество использованных токенов для построения embedding.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.knowledge_base is 'Хранилище фрагментов знаний с эмбеддингами для ассистента.';
comment on column public.knowledge_base.source is 'Имя источника (например, документ или раздел).';
comment on column public.knowledge_base.source_ref is 'Внешний идентификатор записи в исходной системе.';
comment on column public.knowledge_base.content is 'Очистенный текст фрагмента, который индексируется.';
comment on column public.knowledge_base.chunk_hash is 'Детерминированный хэш содержимого для предотвращения дублей.';
comment on column public.knowledge_base.embedding is 'Векторное представление текста (pgvector).';
comment on column public.knowledge_base.metadata is 'JSON-метаданные (например, категория, теги, язык).';
comment on column public.knowledge_base.tokens is 'Число токенов, затраченных на генерацию embedding.';

create unique index if not exists idx_knowledge_base_chunk_hash on public.knowledge_base (chunk_hash);
create index if not exists idx_knowledge_base_source on public.knowledge_base using btree (source);
create index if not exists idx_knowledge_base_embedding on public.knowledge_base using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.knowledge_base
  alter column updated_at set default now();

create or replace function public.knowledge_base_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.knowledge_base_assign_defaults()
returns trigger
language plpgsql
as $$
begin
  if new.chunk_hash is null then
    new.chunk_hash := encode(digest(coalesce(new.content, ''), 'sha256'), 'hex');
  end if;
  return new;
end
$$;

drop trigger if exists trg_knowledge_base_set_updated_at on public.knowledge_base;
drop trigger if exists trg_knowledge_base_assign_defaults on public.knowledge_base;

create trigger trg_knowledge_base_set_updated_at
before update on public.knowledge_base
for each row
execute function public.knowledge_base_touch_updated_at();

create trigger trg_knowledge_base_assign_defaults
before insert on public.knowledge_base
for each row
execute function public.knowledge_base_assign_defaults();

alter table public.knowledge_base enable row level security;

drop policy if exists "Service role writes embeddings" on public.knowledge_base;

create policy "Service role writes embeddings"
  on public.knowledge_base
  as permissive
  for all
  to service_role
  using (true)
  with check (true);
