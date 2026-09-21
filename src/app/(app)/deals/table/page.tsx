import { Funnel } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DealsTableView, type TableDeal } from "../table-view";

const PAGE_SIZE = 50;
const SORT_FIELDS = new Set(["updated", "budget"]);
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
  const sort = SORT_FIELDS.has(sortParam) ? sortParam : "updated";
  const direction = firstString(params.dir) === "asc" ? "asc" : "desc";
  const query = clean(firstString(params.q)).slice(0, 80);
  const ownerParam = firstString(params.owner);
  const stageParam = firstString(params.stage);
  const owner = isUuid(ownerParam) ? ownerParam : "";
  const stage = isUuid(stageParam) ? stageParam : "";
  const supabase = await createClient();

  const buildCountQuery = () => {
    let countQuery = supabase
      .from("deals")
      .select("id", { count: "exact", head: true });
    if (owner) countQuery = countQuery.eq("owner_id", owner);
    if (stage) countQuery = countQuery.eq("stage_id", stage);
    if (query) {
      const filter = `%${query}%`;
      countQuery = countQuery.or(
        `object_text.ilike.${filter},title.ilike.${filter}`,
      );
    }
    return countQuery;
  };
  const isTransientCountError = (
    response: { status?: number },
    error: { code?: string },
  ) => {
    const status = response.status;
    return (
      status === 0 ||
      status === 408 ||
      status === 429 ||
      (status !== undefined && status >= 500) ||
      error.code?.startsWith("08") === true
    );
  };
  let countResponse = await buildCountQuery();
  for (let attempt = 1; countResponse.error && attempt < 3; attempt += 1) {
    if (!isTransientCountError(countResponse, countResponse.error)) break;
    await new Promise((resolve) =>
      setTimeout(resolve, attempt === 1 ? 100 : 250),
    );
    countResponse = await buildCountQuery();
  }
  if (countResponse.error) {
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
            Не удалось получить точное количество сделок. Данные не заменены
            пустым списком.
          </span>
          <Link href={`/deals/table?${retryParams}`}>Повторить</Link>
        </div>
      </div>
    );
  }
  let dataQuery = supabase
    .from("deals")
    .select(
      "id, contact_id, owner_id, stage_id, status, object_text, source_id, budget, budget_currency, updated_at",
    );
  if (owner) {
    dataQuery = dataQuery.eq("owner_id", owner);
  }
  if (stage) {
    dataQuery = dataQuery.eq("stage_id", stage);
  }
  if (query) {
    const filter = `%${query}%`;
    dataQuery = dataQuery.or(
      `object_text.ilike.${filter},title.ilike.${filter}`,
    );
  }
  const total = countResponse.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const offset = safePage * PAGE_SIZE;
  const lastRow = Math.min(offset + PAGE_SIZE, total) - 1;
  const rows =
    offset < total
      ? await dataQuery
          .order(sort === "budget" ? "budget" : "updated_at", {
            ascending: direction === "asc",
          })
          .order("id", { ascending: true })
          .range(offset, lastRow)
      : { data: [], error: null };
  if (rows.error) throw new Error(`Сделки: ${rows.error.message}`);
  const deals = rows.data ?? [];
  const dealIds = deals.map((deal) => deal.id);
  const contactIdsOnPage = deals.map((deal) => deal.contact_id);
  const ownerIdsOnPage = deals.flatMap((deal) =>
    deal.owner_id ? [deal.owner_id] : [],
  );
  const [contacts, owners, stages, sources, projects, links, tasks] =
    await Promise.all([
      contactIdsOnPage.length
        ? supabase
            .from("contacts")
            .select("id, full_name")
            .in("id", contactIdsOnPage)
        : Promise.resolve({ data: [], error: null }),
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
      supabase.from("sources").select("id, name"),
      supabase.from("projects").select("id, name, code"),
      dealIds.length
        ? supabase
            .from("deal_projects")
            .select("deal_id, project_id")
            .in("deal_id", dealIds)
        : Promise.resolve({ data: [], error: null }),
      dealIds.length
        ? supabase
            .from("tasks")
            .select("deal_id, title, due_at")
            .in("deal_id", dealIds)
            .is("done_at", null)
            .order("due_at")
        : Promise.resolve({ data: [], error: null }),
    ]);
  const [tags, lostReasons] = await Promise.all([
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
  const missingOwnerIds = ownerIdsOnPage.filter(
    (id) => !(owners.data ?? []).some((row) => row.id === id),
  );
  const historicalOwners = missingOwnerIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", missingOwnerIds)
    : { data: [], error: null };
  const activeStageIds = new Set((stages.data ?? []).map((row) => row.id));
  const missingStageIds = [
    ...new Set(deals.map((deal) => deal.stage_id)),
  ].filter((id) => !activeStageIds.has(id));
  const historicalStages = missingStageIds.length
    ? await supabase
        .from("stages")
        .select("id, name, kind")
        .in("id", missingStageIds)
    : { data: [], error: null };
  for (const response of [
    contacts,
    owners,
    stages,
    sources,
    projects,
    links,
    tasks,
    tags,
    lostReasons,
    historicalOwners,
    historicalStages,
  ])
    if (response.error)
      throw new Error(`Связанные данные: ${response.error.message}`);
  const contactMap = new Map(
    (contacts.data ?? []).map((row) => [row.id, row.full_name]),
  );
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
  const sourceMap = new Map(
    (sources.data ?? []).map((row) => [row.id, row.name]),
  );
  const projectMap = new Map(
    (projects.data ?? []).map((row) => [row.id, row.name]),
  );
  const projectByDeal = new Map<string, string[]>();
  for (const link of links.data ?? []) {
    const name = projectMap.get(link.project_id);
    if (name)
      projectByDeal.set(link.deal_id, [
        ...(projectByDeal.get(link.deal_id) ?? []),
        name,
      ]);
  }
  const taskByDeal = new Map<string, string>();
  for (const task of tasks.data ?? [])
    if (!taskByDeal.has(task.deal_id)) taskByDeal.set(task.deal_id, task.title);
  const tableRows: TableDeal[] = deals.map((deal) => {
    const stageRow = stageMap.get(deal.stage_id);
    return {
      id: deal.id,
      contact: contactMap.get(deal.contact_id) ?? "Без имени",
      stage: stageRow?.name ?? "—",
      stageKind: stageRow?.kind ?? "open",
      projects: projectByDeal.get(deal.id) ?? [],
      object: deal.object_text ?? "",
      budget: deal.budget,
      currency: deal.budget_currency,
      task: taskByDeal.get(deal.id) ?? "",
      owner: deal.owner_id ? (ownerMap.get(deal.owner_id) ?? "—") : "",
      ownerId: deal.owner_id,
      stageId: deal.stage_id,
      source: deal.source_id ? (sourceMap.get(deal.source_id) ?? "—") : "",
      updated: deal.updated_at,
    };
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
        <span className="summary">Серверный поиск</span>
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
