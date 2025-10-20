-- Дополняем request_documents полями для договоров ГПХ.

alter table public.request_documents
  add column if not exists payer_name text,
  add column if not exists executor_name text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists work_volume text,
  add column if not exists curator text,
  add column if not exists payment_terms text,
  add column if not exists payment_details text,
  add column if not exists only_after_act boolean default false,
  add column if not exists ndfl_rate numeric(5,2),
  add column if not exists insurance_required boolean,
  add column if not exists withholdings text,
  add column if not exists tax_notes text,
  add column if not exists payer_id uuid references public.counterparties(id) on delete set null,
  add column if not exists executor_id uuid references public.counterparties(id) on delete set null;

comment on column public.request_documents.payer_name is 'Отображаемое имя плательщика (контрагент 1) для ГПХ.';
comment on column public.request_documents.executor_name is 'Отображаемое имя исполнителя (контрагент 2) для ГПХ.';
comment on column public.request_documents.period_start is 'Дата начала периода исполнения ГПХ.';
comment on column public.request_documents.period_end is 'Дата окончания периода исполнения ГПХ.';
comment on column public.request_documents.work_volume is 'Количество часов / услуг по договору ГПХ.';
comment on column public.request_documents.curator is 'Ответственный куратор договора ГПХ.';
comment on column public.request_documents.payment_terms is 'Порядок расчётов по договору.';
comment on column public.request_documents.payment_details is 'Реквизиты для перечисления вознаграждения.';
comment on column public.request_documents.only_after_act is 'Флаг «Оплата только после акта».';
comment on column public.request_documents.ndfl_rate is 'Применяемая ставка НДФЛ.';
comment on column public.request_documents.insurance_required is 'Нужно ли начислять страховые взносы.';
comment on column public.request_documents.withholdings is 'Удержания / вычеты по договору.';
comment on column public.request_documents.tax_notes is 'Комментарии к налогам и выплатам.';
comment on column public.request_documents.payer_id is 'Дублирующий FK на плательщика для ГПХ (контрагент 1).';
comment on column public.request_documents.executor_id is 'Дублирующий FK на исполнителя для ГПХ (контрагент 2).';

create index if not exists idx_request_documents_executor_id on public.request_documents using btree (executor_id);
create index if not exists idx_request_documents_payer_id on public.request_documents using btree (payer_id);
