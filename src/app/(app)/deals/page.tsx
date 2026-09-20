import { Funnel } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DealsBoard } from "./deals-board";
import { CreateDealModal } from "./create-deal-modal";

const PAGE_SIZE = 24;
const CHUNK_SIZE = 100;
type Stage = {
  id: string;
  name: string;
  position: number;
  kind: "open" | "won" | "lost";
};
type Deal = {
  id: string;
  contact_id: string;
  owner_id: string | null;
  stage_id: string;
  status: "open" | "postponed" | "won" | "lost";
  object_text: string | null;
  source_id: string | null;
  budget: number | null;
  budget_currency: string;
  postponed_until: string | null;
};
type Contact = { id: string; full_name: string };
type Profile = { id: string; full_name: string; role?: string };
type Project = { id: string; code: string; name: string };
type Source = { id: string; name: string };
type Tag = { id: string; name: string };
type LinkRow = { deal_id: string; project_id?: string; tag_id?: string };
type Task = { deal_id: string; title: string; due_at: string };
type ColumnData = { deals: Deal[]; total: number };

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

async function loadByIds<T>(
  ids: string[],
  load: (
    ids: string[],
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const result: T[] = [];
  for (const chunk of chunks(ids, CHUNK_SIZE)) {
    const response = await load(chunk);
    if (response.error) throw new Error(label + ": " + response.error.message);
    result.push(...(response.data ?? []));
  }
  return result;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function loadColumn(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: string | null,
  page: number,
): Promise<ColumnData> {
  const countQuery = stageId
    ? supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("stage_id", stageId)
        .not("owner_id", "is", null)
    : supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .is("owner_id", null)
        .not("status", "in", "(won,lost)");
  const countResponse = await countQuery;
  if (countResponse.error)
    throw new Error("Сделки: " + countResponse.error.message);
  const total = countResponse.count ?? 0;
  const offset = page * PAGE_SIZE;
  if (offset >= total) return { deals: [], total };
  const query = stageId
    ? supabase
        .from("deals")
        .select(
          "id, contact_id, owner_id, stage_id, status, object_text, source_id, budget, budget_currency, postponed_until",
          { count: "exact" },
        )
        .eq("stage_id", stageId)
        .not("owner_id", "is", null)
        .order("updated_at", { ascending: false })
        .range(offset, Math.min(offset + PAGE_SIZE, total) - 1)
    : supabase
        .from("deals")
        .select(
          "id, contact_id, owner_id, stage_id, status, object_text, source_id, budget, budget_currency, postponed_until",
          { count: "exact" },
        )
        .is("owner_id", null)
        .not("status", "in", "(won,lost)")
        .order("updated_at", { ascending: false })
        .range(offset, Math.min(offset + PAGE_SIZE, total) - 1);
  const response = await query;
  if (response.error) throw new Error("Сделки: " + response.error.message);
  return { deals: (response.data ?? []) as Deal[], total };
}

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const pageValue = Number.parseInt((await searchParams).page ?? "0", 10);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 0;
  const supabase = await createClient();
  const stagesResponse = await supabase
    .from("stages")
    .select("id, name, position, kind")
    .eq("is_active", true)
    .order("position");
  if (stagesResponse.error)
    throw new Error("Этапы: " + stagesResponse.error.message);
  const allStages = (stagesResponse.data ?? []) as Stage[];
  const stages = allStages.filter((stage) => stage.kind !== "lost");
  const lostStage = allStages.find((stage) => stage.kind === "lost");
  const [kettle, ...columns] = await Promise.all([
    loadColumn(supabase, null, page),
    ...stages.map((stage) => loadColumn(supabase, stage.id, page)),
  ]);
  const lostResponse = lostStage
    ? await supabase
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("stage_id", lostStage.id)
    : null;
  if (lostResponse?.error)
    throw new Error("Отказ: " + lostResponse.error.message);
  const lostCount = lostResponse?.count ?? 0;
  const allDeals = [
    kettle.deals,
    ...columns.map((column) => column.deals),
  ].flat();
  const dealIds = allDeals.map((deal) => deal.id);
  const sourceIds = allDeals.flatMap((deal) =>
    deal.source_id ? [deal.source_id] : [],
  );
  const ownerIds = allDeals.flatMap((deal) =>
    deal.owner_id ? [deal.owner_id] : [],
  );
  const [contacts, owners, projectRows, sources, tagRows, tasks] =
    await Promise.all([
      loadByIds(
        allDeals.map((deal) => deal.contact_id),
        (ids) =>
          supabase.from("contacts").select("id, full_name").in("id", ids),
        "Контакты",
      ),
      loadByIds(
        [...new Set(ownerIds)],
        (ids) =>
          supabase.from("profiles").select("id, full_name").in("id", ids),
        "Ответственные",
      ),
      loadByIds(
        dealIds,
        (ids) =>
          supabase
            .from("deal_projects")
            .select("deal_id, project_id")
            .in("deal_id", ids),
        "Проекты сделок",
      ),
      loadByIds(
        [...new Set(sourceIds)],
        (ids) => supabase.from("sources").select("id, name").in("id", ids),
        "Источники",
      ),
      loadByIds(
        dealIds,
        (ids) =>
          supabase
            .from("deal_tags")
            .select("deal_id, tag_id")
            .in("deal_id", ids),
        "Теги сделок",
      ),
      loadByIds(
        dealIds,
        (ids) =>
          supabase
            .from("tasks")
            .select("deal_id, title, due_at")
            .in("deal_id", ids)
            .is("done_at", null)
            .order("due_at"),
        "Задачи",
      ),
    ]);
  const projectIds = (projectRows as LinkRow[]).flatMap((row) =>
    row.project_id ? [row.project_id] : [],
  );
  const tagIds = (tagRows as LinkRow[]).flatMap((row) =>
    row.tag_id ? [row.tag_id] : [],
  );
  const [
    projectsResponse,
    tagsResponse,
    modalSourcesResponse,
    modalProjectsResponse,
    modalTagsResponse,
    modalOwnersResponse,
  ] = await Promise.all([
    loadByIds(
      [...new Set(projectIds)],
      (ids) => supabase.from("projects").select("id, code, name").in("id", ids),
      "Проекты",
    ),
    loadByIds(
      [...new Set(tagIds)],
      (ids) => supabase.from("tags").select("id, name").in("id", ids),
      "Теги",
    ),
    supabase
      .from("sources")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("projects")
      .select("id, code, name")
      .eq("is_active", true)
      .order("position"),
    supabase.from("tags").select("id, name").order("name"),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("is_active", true)
      .in("role", ["manager", "head", "admin"])
      .order("full_name"),
  ]);
  if (modalSourcesResponse.error)
    throw new Error("Источники: " + modalSourcesResponse.error.message);
  if (modalProjectsResponse.error)
    throw new Error("Проекты: " + modalProjectsResponse.error.message);
  if (modalTagsResponse.error)
    throw new Error("Теги: " + modalTagsResponse.error.message);
  if (modalOwnersResponse.error)
    throw new Error("Ответственные: " + modalOwnersResponse.error.message);
  const projects = projectsResponse;
  const tags = tagsResponse;
  const shown = allDeals.length;
  const total =
    kettle.total + columns.reduce((sum, column) => sum + column.total, 0);
  const hasNextPage = [kettle, ...columns].some(
    (column) => (page + 1) * PAGE_SIZE < column.total,
  );
  return (
    <div className="deals-page">
      <header className="page-header">
        <Funnel size={16} />
        <span>Сделки</span>
        <span className="header-spacer" />
        <span className="avatar">{initials(profile.full_name)}</span>
      </header>
      <div className="toolbar">
        <span className="toolbar-label">Воронка</span>
        <span className="header-spacer" />
        <span className="summary">Сделки в воронке</span>
        <CreateDealModal
          stages={stages}
          sources={(modalSourcesResponse.data ?? []) as Source[]}
          projects={(modalProjectsResponse.data ?? []) as Project[]}
          tags={(modalTagsResponse.data ?? []) as Tag[]}
          owners={(modalOwnersResponse.data ?? []) as Profile[]}
        />
      </div>
      <div className="filterbar">
        <span className="static-filter">Сортировка</span>
        <span className="separator" />
        <span className="static-filter">Фильтр</span>
        <span className="header-spacer" />
        <span className="summary">
          Страница {page + 1} · показано {shown} из {total}
        </span>
      </div>
      <DealsBoard
        columns={[
          {
            id: "kettle",
            title: "Общий котёл",
            total: kettle.total,
            deals: kettle.deals,
            kettle: true,
          },
          ...stages.map((stage, index) => ({
            id: stage.id,
            title: stage.name,
            total: columns[index].total,
            deals: columns[index].deals,
            won: stage.kind === "won",
          })),
        ]}
        lostCount={lostCount}
        currentUserId={profile.id}
        contacts={contacts as Contact[]}
        owners={owners as Profile[]}
        sources={sources as Source[]}
        projects={projects as Project[]}
        tags={tags as Tag[]}
        projectLinks={projectRows as LinkRow[]}
        tagLinks={tagRows as LinkRow[]}
        tasks={tasks as Task[]}
      />
      {(page > 0 || hasNextPage) && (
        <nav className="deals-pagination" aria-label="Страницы сделок">
          {page > 0 && <Link href={`/deals?page=${page - 1}`}>Предыдущая</Link>}
          {hasNextPage && (
            <Link href={`/deals?page=${page + 1}`}>Следующая</Link>
          )}
        </nav>
      )}
    </div>
  );
}
