import { Funnel } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { buildStageHueMap } from "@/lib/stage-colors";
import { createClient } from "@/lib/supabase/server";
import { DealsTableView, type TableDeal } from "./table-view";

const PAGE_SIZE = 50;
const SORT_FIELDS = new Set([
  "contact",
  "stage",
  "tags",
  "task",
  "activity",
  "created",
  "owner",
]);
const firstString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
const clean = (value: string) =>
  value
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

export default async function DealsTablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const params = await searchParams;
  const requestedPage = Number.parseInt(firstString(params.page), 10);
  // В адресе страница с единицы (?page=2 — вторая), внутри — с нуля.
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 1
      ? Math.min(requestedPage - 1, 100_000)
      : 0;
  const sortParam = firstString(params.sort);
  const sort = SORT_FIELDS.has(sortParam) ? sortParam : "activity";
  const direction = firstString(params.dir) === "asc" ? "asc" : "desc";
  const query = clean(firstString(params.q)).slice(0, 80);
  const ownerParam = firstString(params.owner);
  const stageParam = firstString(params.stage);
  const owner = isUuid(ownerParam) ? ownerParam : "";
  const stage = isUuid(stageParam) ? stageParam : "";
  const supabase = await createClient();

  const flagParam = firstString(params.flag);
  const flag = ["overdue", "today", "no_next_step"].includes(flagParam) ? flagParam : "";
  const offset = page * PAGE_SIZE;
  // Порядок, фильтры и поиск (включая имя контакта и телефон) считает
  // crm_deals_table; здесь только дочитываем строки страницы в её порядке.
  const order = await supabase.rpc("crm_deals_table", {
    p_q: query || null,
    p_owner: owner || null,
    p_stage: stage || null,
    p_flag: flag || null,
    p_sort: sort,
    p_dir: direction,
    p_offset: offset,
    p_limit: PAGE_SIZE,
  });
  const orderRows = (order.data ?? []) as Array<{ id: string; total: number }>;
  const orderedIds = orderRows.map((row) => row.id);
  // Страница за концом списка (фильтр сузил выдачу) — на первую, а не «найдено 0».
  if (!order.error && !orderedIds.length && offset > 0) {
    const first = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const item = Array.isArray(value) ? value[0] : value;
      if (item && key !== "page") first.set(key, item);
    }
    redirect(`/deals/table?${first}`);
  }
  const pageRows = order.error
    ? { data: null, error: order.error }
    : orderedIds.length
      ? await supabase
          .from("deals")
          .select(
            "id, contact_id, owner_id, stage_id, status, title, object_text, created_at, updated_at, contact:contacts!deals_contact_id_fkey(full_name)",
          )
          .in("id", orderedIds)
      : { data: [], error: null };
  const position = new Map(orderedIds.map((id, index) => [id, index]));
  const rows = {
    error: pageRows.error,
    count: Number(orderRows[0]?.total ?? 0),
    data: (pageRows.data ?? []).sort(
      (a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0),
    ),
  };
  if (rows.error) {
    console.error("[deals/table]", rows.error);
    const retryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const item = Array.isArray(value) ? value[0] : value;
      if (item) retryParams.set(key, item);
    }
    return (
      <div className="deals-page">
        <header className="page-header">
          <Funnel size={16} />
          <span>Сделки</span>
        </header>
        <div className="deals-table-empty" role="alert">
          <strong>Список сделок временно недоступен</strong>
          <span>
            Не удалось получить сделки. Данные не заменены пустым списком.
          </span>
          <Link href={`/deals/table?${retryParams}`}>Повторить</Link>
        </div>
      </div>
    );
  }
  const total = rows.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const deals = rows.data ?? [];
  const dealIds = deals.map((deal) => deal.id);
  type DealTagRow = {
    deal_id: string;
    tag: { name?: string | null } | Array<{ name?: string | null }> | null;
  };
  type DealTaskRow = {
    deal_id: string;
    title: string;
    due_at: string;
    done_at: string | null;
  };
  type DealNoteRow = { deal_id: string; body: string | null; created_at: string };
  type DealCallRow = {
    deal_id: string;
    direction: string | null;
    started_at: string;
  };
  type DealTransitionRow = { deal_id: string; changed_at: string };
  const emptyTagData: DealTagRow[] = [];
  const emptyTaskData: DealTaskRow[] = [];
  const emptyNoteData: DealNoteRow[] = [];
  const emptyCallData: DealCallRow[] = [];
  const emptyTransitionData: DealTransitionRow[] = [];
  const [dealTags, dealTasks, dealNotes, dealCalls, dealTransitions] =
    dealIds.length > 0
      ? await Promise.all([
          supabase
            .from("deal_tags")
            .select("deal_id, tag:tags(name)")
            .in("deal_id", dealIds),
          supabase
            .from("tasks")
            .select("deal_id, title, due_at, done_at")
            .in("deal_id", dealIds),
          supabase
            .from("notes")
            .select("deal_id, body, created_at")
            .in("deal_id", dealIds),
          supabase
            .from("calls")
            .select("deal_id, direction, started_at")
            .in("deal_id", dealIds),
          supabase
            .from("stage_transitions")
            .select("deal_id, changed_at")
            .in("deal_id", dealIds),
        ])
      : [
          { data: emptyTagData, error: null },
          { data: emptyTaskData, error: null },
          { data: emptyNoteData, error: null },
          { data: emptyCallData, error: null },
          { data: emptyTransitionData, error: null },
        ];
  for (const child of [
    dealTags,
    dealTasks,
    dealNotes,
    dealCalls,
    dealTransitions,
  ]) {
    if (child.error) {
      console.error("[deals/table]", child.error.code ?? "child_query_failed");
      const retryParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        const item = Array.isArray(value) ? value[0] : value;
        if (item) retryParams.set(key, item);
      }
      return (
        <div className="deals-page">
          <header className="page-header">
            <Funnel size={16} />
            <span>Сделки</span>
          </header>
          <div className="deals-table-empty" role="alert">
            <strong>Список сделок временно недоступен</strong>
            <span>
              Не удалось получить сделки. Данные не заменены пустым списком.
            </span>
            <Link href={`/deals/table?${retryParams}`}>Повторить</Link>
          </div>
        </div>
      );
    }
  }
  const groupByDeal = <T extends { deal_id: string }>(items: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const list = map.get(item.deal_id);
      if (list) list.push(item);
      else map.set(item.deal_id, [item]);
    }
    return map;
  };
  const tagsByDeal = groupByDeal<DealTagRow>(
    (dealTags.data ?? []) as unknown as DealTagRow[],
  );
  const tasksByDeal = groupByDeal<DealTaskRow>(
    (dealTasks.data ?? []) as unknown as DealTaskRow[],
  );
  const notesByDeal = groupByDeal<DealNoteRow>(
    (dealNotes.data ?? []) as unknown as DealNoteRow[],
  );
  const callsByDeal = groupByDeal<DealCallRow>(
    (dealCalls.data ?? []) as unknown as DealCallRow[],
  );
  const transitionsByDeal = groupByDeal<DealTransitionRow>(
    (dealTransitions.data ?? []) as unknown as DealTransitionRow[],
  );
  const ownerIdsOnPage = deals.flatMap((deal) =>
    deal.owner_id ? [deal.owner_id] : [],
  );
  const [owners, stages, tags, lostReasons] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .in("role", ["manager", "head", "admin"])
      .order("full_name"),
    supabase
      .from("stages")
      .select("id, name, kind, position")
      .eq("is_active", true)
      .order("position"),
    supabase
      .from("tags")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .limit(500),
    supabase
      .from("lost_reasons")
      .select("id, name")
      .eq("is_active", true)
      .order("position")
      .limit(200),
  ]);
  const activeOwnerIds = new Set((owners.data ?? []).map((row) => row.id));
  const missingOwnerIds = ownerIdsOnPage.filter((id) => !activeOwnerIds.has(id));
  const historicalOwners = missingOwnerIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", missingOwnerIds)
    : { data: [], error: null };
  const activeStageIds = new Set((stages.data ?? []).map((row) => row.id));
  const missingStageIds = [...new Set(deals.map((deal) => deal.stage_id))].filter(
    (id) => !activeStageIds.has(id),
  );
  const historicalStages = missingStageIds.length
    ? await supabase
        .from("stages")
        .select("id, name, kind, position")
        .in("id", missingStageIds)
    : { data: [], error: null };
  for (const response of [
    owners,
    stages,
    tags,
    lostReasons,
    historicalOwners,
    historicalStages,
  ])
    if (response.error)
      throw new Error(`Связанные данные: ${response.error.message}`);
  const ownerMap = new Map(
    [...(owners.data ?? []), ...(historicalOwners.data ?? [])].map((row) => [
      row.id,
      row.full_name,
    ]),
  );
  const stageMap = new Map(
    [...(stages.data ?? []), ...(historicalStages.data ?? [])].map((row) => [
      row.id,
      row,
    ]),
  );
  const stageHueMap = buildStageHueMap(
    [...(stages.data ?? []), ...(historicalStages.data ?? [])].map((row) => ({
      id: row.id,
      kind: row.kind as "open" | "won" | "lost",
      position: row.position ?? Number.MAX_SAFE_INTEGER,
    })),
  );
  const tableRows: TableDeal[] = deals.map((deal) => {
    const stageRow = stageMap.get(deal.stage_id);
    const contact = Array.isArray(deal.contact) ? deal.contact[0] : deal.contact;
    const dealTaskRows = tasksByDeal.get(deal.id) ?? [];
    const dealNoteRows = notesByDeal.get(deal.id) ?? [];
    const dealCallRows = callsByDeal.get(deal.id) ?? [];
    const dealTransitionRows = transitionsByDeal.get(deal.id) ?? [];
    const task = dealTaskRows
      .filter((row) => !row.done_at)
      .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
    const activities = [
      ...dealNoteRows.map((row) => ({
        text: row.body ? `Заметка: ${row.body}` : "Заметка",
        at: row.created_at,
      })),
      ...dealCallRows.map((row) => ({
        text: row.direction === "in" ? "Входящий звонок" : "Исходящий звонок",
        at: row.started_at,
      })),
      ...dealTransitionRows.map((row) => ({
        text: "Этап изменён",
        at: row.changed_at,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return {
      id: deal.id,
      contact: contact?.full_name ?? "Без имени",
      stage: stageRow?.name ?? "Без этапа",
      stageKind: stageRow?.kind ?? "open",
      stageHue: stageHueMap.get(deal.stage_id) ?? "grey",
      tags: (tagsByDeal.get(deal.id) ?? [])
        .map((row) => {
          const tag = row.tag as unknown as
            | { name?: string }
            | { name?: string }[]
            | null;
          return Array.isArray(tag) ? tag[0]?.name : tag?.name;
        })
        .filter((name): name is string => Boolean(name)),
      task: task?.title ?? "",
      taskDueAt: task?.due_at ?? null,
      activity: activities[0]?.text ?? "Нет активности",
      activityAt: activities[0]?.at ?? null,
      created: deal.created_at,
      owner: deal.owner_id ? ownerMap.get(deal.owner_id) ?? "" : "",
      ownerId: deal.owner_id,
      stageId: deal.stage_id,
    };
  });
  const sortValue = (row: TableDeal): string => {
    if (sort === "tags") return row.tags.join(" ");
    if (sort === "task") return row.taskDueAt ?? "";
    if (sort === "activity") return row.activityAt ?? "";
    if (sort === "created") return row.created;
    if (sort === "owner") return row.owner;
    if (sort === "stage") return row.stage;
    return row.contact;
  };
  tableRows.sort((left, right) => {
    const comparison = sortValue(left).localeCompare(sortValue(right), "ru", {
      numeric: true,
      sensitivity: "base",
    });
    return direction === "asc" ? comparison : -comparison;
  });
  return (
    <div className="deals-page">
      <header className="page-header">
        <Funnel size={16} />
        <span>Сделки</span>
        <span className="header-spacer" />
      </header>
      <div className="toolbar">
        <Link className="view-switch" href="/deals">
          Воронка
        </Link>
        <span className="view-switch active">Таблица</span>
        <span className="header-spacer" />
        <span className="summary">Сделки · 50 на страницу</span>
      </div>
      <DealsTableView
        rows={tableRows}
        total={total}
        page={safePage}
        pageSize={PAGE_SIZE}
        sort={sort}
        direction={direction}
        query={query}
        owner={owner}
        stage={stage}
        flag={flag}
        owners={owners.data ?? []}
        stages={stages.data ?? []}
        tags={tags.data ?? []}
        lostReasons={lostReasons.data ?? []}
        canExport={profile.role === "head" || profile.role === "admin"}
        canDelete={
          profile.role === "manager" ||
          profile.role === "head" ||
          profile.role === "admin"
        }
      />
    </div>
  );
}
