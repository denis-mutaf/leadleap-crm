-- QA B-01, B-02, тикет 47: серверная половина гейтов воронки.
-- Клиент (src/lib/stage-gate.ts) показывает те же правила заранее, но обойти
-- его можно, поэтому решает база.
--   1. Следующий шаг — только живая задача в будущем (due_at > now()).
--   2. Гейт полей квалификации видит и текстовые поля карточки
--      («Срок покупки» → purchase_timing_text, «В стране» → residency_detail).
--   3. «неквал» не идёт дальше «В работе» (amo:stage:30). Исключения: назад по
--      воронке, «Перестал отвечать / не готов пока» (amo:stage:40) и «Отказ».

create or replace function public.enforce_stage_gates()
 returns trigger
 language plpgsql
as $function$
declare
  old_position smallint;
  new_stage    stages%rowtype;
  missing      text[] := '{}';
begin
  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select * into new_stage from stages where id = new.stage_id;
  select position into old_position from stages where id = old.stage_id;

  -- назад по воронке и в закрывающие этапы пускаем без гейтов:
  -- менеджер должен иметь право откатить ошибку и закрыть безнадёжную сделку
  if new_stage.position <= old_position or new_stage.kind <> 'open' then
    return new;
  end if;

  if new_stage.requires_qualification then
    if new.budget is null then missing := array_append(missing, 'бюджет'); end if;
    if new.payment is null then missing := array_append(missing, 'способ оплаты'); end if;
    if new.horizon is null and nullif(btrim(new.purchase_timing_text), '') is null then
      missing := array_append(missing, 'срок покупки');
    end if;
    if new.residency is null and nullif(btrim(new.residency_detail), '') is null then
      missing := array_append(missing, 'диаспора или местный');
    end if;
    if new.rooms is null then missing := array_append(missing, 'комнатность'); end if;
    if new.purpose is null then missing := array_append(missing, 'цель покупки'); end if;

    if array_length(missing, 1) > 0 then
      raise exception 'Не заполнена квалификация: %', array_to_string(missing, ', ')
        using errcode = 'check_violation';
    end if;
  end if;

  if new_stage.requires_next_step then
    if not exists (
      select 1 from tasks
      where deal_id = new.id
        and done_at is null
        and deleted_at is null
        and due_at > now()
    ) then
      raise exception 'Нет следующего шага: поставьте задачу с датой в будущем, иначе сделка дальше не идёт'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.enforce_qualification_tag()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  source_position smallint;
  target_stage public.stages%rowtype;
  limit_position smallint;
begin
  if new.stage_id is not distinct from old.stage_id then return new; end if;
  select * into target_stage from public.stages where id = new.stage_id;
  select position into source_position from public.stages where id = old.stage_id;
  if target_stage.kind = 'lost' or target_stage.position <= source_position then
    return new;
  end if;

  -- «неквал» дальше «В работе» не пускаем (кроме парковки amo:stage:40)
  select position into limit_position from public.stages where import_key = 'amo:stage:30';
  if limit_position is not null
    and target_stage.position > limit_position
    and target_stage.import_key is distinct from 'amo:stage:40'
    and exists (
      select 1 from public.deal_tags dt
      join public.tags t on t.id = dt.tag_id
      where dt.deal_id = new.id and t.name = 'неквал'
    ) then
    raise exception 'Неквалифицированную сделку нельзя перевести дальше этапа «В работе»'
      using errcode = '23514';
  end if;

  if target_stage.kind <> 'open' or not target_stage.requires_qualification_tag then
    return new;
  end if;
  if not exists (
    select 1 from public.deal_tags dt
    join public.tags t on t.id = dt.tag_id
    where dt.deal_id = new.id and t.name in ('КВАЛ', 'неквал')
  ) then
    raise exception 'Отметьте КВАЛ или неквал перед переходом'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
