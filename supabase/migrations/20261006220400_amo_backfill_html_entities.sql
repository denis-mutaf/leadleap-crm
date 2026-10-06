-- QA / тикет 51, пункт 5 (B-07): HTML-сущности в текстах из Amo.
--
-- Amo отдаёт текст в HTML-экранировании, иногда дважды: «&amp;nbsp;», «&lt;test lead…&gt;»,
-- «Семья: &quot;Братан&quot;». На проде затронуто 16 строк: contacts.full_name — 10,
-- notes.body — 6. По остальным текстовым полям сделок и задач совпадений сейчас 0, они
-- включены на случай повторной загрузки.
-- Декодируются именованные сущности (&amp; &lt; &gt; &quot; &apos; &nbsp;) и апостроф
-- &#39;/&#039;, два прохода (двойное кодирование). &nbsp; становится обычным пробелом.
-- Остальные числовые сущности на проде не встречаются.
-- Пишет только в строки, где текст реально меняется; повторный запуск ничего не меняет.
-- Триггеры (updated_at, аудит) выключены: это правка импорта, а не действие менеджера.

set lock_timeout = '3s';
set session_replication_role = replica;

create or replace function pg_temp.amo_html_unescape(s text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(replace(replace(replace(replace(
           s, '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'),
           '&#039;', ''''), '&#39;', ''''), '&apos;', ''''), '&amp;', '&')
$$;

-- contacts.full_name
update public.contacts c
   set full_name = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(c.full_name))
 where c.full_name ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
   and c.id in (
     select x.id from public.contacts x
      where x.full_name ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
      order by x.id for update skip locked
   );

-- notes.body (включая звонки-двойники)
update public.notes n
   set body = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(n.body))
 where n.body ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
   and n.id in (
     select x.id from public.notes x
      where x.body ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
      order by x.id for update skip locked
   );

-- deals: заголовок и свободные тексты (на проде 0 строк)
with hit as (
  select d.id
    from public.deals d
   where d.amo_id is not null
     and (coalesce(d.title, '') || ' ' || coalesce(d.object_text, '') || ' ' || coalesce(d.wishes, '')
          || ' ' || coalesce(d.lost_comment, '')) ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
   order by d.id
     for update skip locked
)
update public.deals d
   set title = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(d.title)),
       object_text = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(d.object_text)),
       wishes = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(d.wishes)),
       lost_comment = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(d.lost_comment))
  from hit
 where d.id = hit.id;

-- tasks: название и результат (на проде 0 строк)
with hit as (
  select t.id
    from public.tasks t
   where (coalesce(t.title, '') || ' ' || coalesce(t.result_text, '')) ~* '&(quot|amp|lt|gt|apos|nbsp|#0*39);'
   order by t.id
     for update skip locked
)
update public.tasks t
   set title = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(t.title)),
       result_text = pg_temp.amo_html_unescape(pg_temp.amo_html_unescape(t.result_text))
  from hit
 where t.id = hit.id;

drop function pg_temp.amo_html_unescape(text);
reset session_replication_role;
