import { Funnel } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
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
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? Math.min(requestedPage, 100_000)
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

  const sortColumn: Record<string, string> = {
    created: "created_at",
    activity: "updated_at",
    contact: "contact_id",
    stage: "stage_id",
    owner: "owner_id",
    tags: "id",
    task: "updated_at",
  };
  const selectedSortColumn = sortColumn[sort] ?? "updated_at";
  const filter = query ? `%${query}%` : "";
  const offset = page * PAGE_SIZE;
  const lastRow = offset + PAGE_SIZE - 1;
  let dataQuery = supabase
    .from("deals")
    .select(
      "id, contact_id, owner_id, stage_id, status, title, object_text, created_at, updated_at, contact:contacts!deals_contact_id_fkey(full_name), deal_tags(tag:tags(name)), tasks(title, due_at, done_at), notes(body, created_at), calls(direction, started_at), stage_transitions(changed_at)",
      { count: "exact" },
    );
  dataQuery = dataQuery.is("deleted_at", null);
  if (owner) {
    dataQuery = dataQuery.eq("owner_id", owner);
  }
  if (stage) {
    dataQuery = dataQuery.eq("stage_id", stage);
  }
  if (query) {
    dataQuery = dataQuery.or(
      `object_text.ilike.${filter},title.ilike.${filter}`,
    );
  }
  const rows =
    lastRow >= offset
      ? await dataQuery
          .order(selectedSortColumn, { ascending: direction === "asc" })
          .order("id", { ascending: true })
          .range(offset, lastRow)
      : { data: [], error: null, count: 0 };
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
      .select("id, name, kind")
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
        .select("id, name, kind")
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
  const tableRows: TableDeal[] = deals.map((deal) => {
    const stageRow = stageMap.get(deal.stage_id);
    const contact = Array.isArray(deal.contact) ? deal.contact[0] : deal.contact;
    const task = (deal.tasks ?? [])
      .filter((row) => !row.done_at)
      .sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
    const activities = [
      ...(deal.notes ?? []).map((row) => ({
        text: row.body ? `Заметка: ${row.body}` : "Заметка",
        at: row.created_at,
      })),
      ...(deal.calls ?? []).map((row) => ({
        text: row.direction === "in" ? "Входящий звонок" : "Исходящий звонок",
        at: row.started_at,
      })),
      ...(deal.stage_transitions ?? []).map((row) => ({
        text: "Этап изменён",
        at: row.changed_at,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    return {
      id: deal.id,
      contact: contact?.full_name ?? "Без имени",
      stage: stageRow?.name ?? "Без этапа",
      stageKind: stageRow?.kind ?? "open",
      tags: (deal.deal_tags ?? [])
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
      <div className="filterbar">
        <span className="static-filter">Сортировка и фильтры</span>
        <span className="header-spacer" />
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
