import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DealRecordClient, type DealRecordData } from "./record-client";

const FEED_LIMIT = 120;
const emptyRows = <T,>() => ({ data: [] as T[], error: null, count: 0 });

function phoneDedupKeys(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return [];
  const normalized =
    digits.length === 8
      ? `373${digits}`
      : digits.length === 9 && digits.startsWith("0")
        ? `373${digits.slice(1)}`
        : digits;
  return [`normalized:${normalized}`, `last8:${normalized.slice(-8)}`];
}

export default async function DealRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  const { id } = await params;
  const supabase = await createClient();
  const dealResponse = await supabase
    .from("deals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (dealResponse.error)
    throw new Error(`Сделка: ${dealResponse.error.message}`);
  if (!dealResponse.data) notFound();
  const deal = dealResponse.data;
  const [projectRows, tagRows] = await Promise.all([
    supabase.from("deal_projects").select("project_id").eq("deal_id", id),
    supabase.from("deal_tags").select("tag_id").eq("deal_id", id),
  ]);
  if (projectRows.error)
    throw new Error(`Проекты сделки: ${projectRows.error.message}`);
  if (tagRows.error) throw new Error(`Теги сделки: ${tagRows.error.message}`);
  const [
    contact,
    phones,
    importedPhones,
    channels,
    owner,
    stage,
    projects,
    tags,
    source,
    tasks,
    notes,
    calls,
    transitions,
  ] = await Promise.all([
    supabase
      .from("contacts")
      .select("*")
      .eq("id", deal.contact_id)
      .maybeSingle(),
    supabase
      .from("contact_phones")
      .select("id, phone, is_primary")
      .eq("contact_id", deal.contact_id)
      .order("is_primary", { ascending: false }),
    supabase
      .from("imported_contact_phones")
      .select("contact_id, ordinal, raw_phone, label")
      .eq("contact_id", deal.contact_id)
      .order("ordinal"),
    supabase
      .from("contact_channels")
      .select("id, channel, handle, external_id")
      .eq("contact_id", deal.contact_id),
    deal.owner_id
      ? supabase
          .from("profiles")
          .select("id, full_name, role")
          .eq("id", deal.owner_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("stages")
      .select("id, name, kind")
      .eq("id", deal.stage_id)
      .maybeSingle(),
    projectRows.data.length
      ? supabase
          .from("projects")
          .select("id, code, name")
          .in(
            "id",
            projectRows.data.map((row) => row.project_id),
          )
      : emptyRows<{ id: string; code: string; name: string }>(),
    tagRows.data.length
      ? supabase
          .from("tags")
          .select("id, name")
          .in(
            "id",
            tagRows.data.map((row) => row.tag_id),
          )
      : emptyRows<{ id: string; name: string }>(),
    deal.source_id
      ? supabase
          .from("sources")
          .select("id, name")
          .eq("id", deal.source_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("tasks")
      .select(
        "id, deal_id, assignee_id, title, due_at, done_at, done_by, created_at, is_auto",
        { count: "exact" },
      )
      .eq("deal_id", id)
      .order("due_at", { ascending: true })
      .limit(FEED_LIMIT),
    supabase
      .from("notes")
      .select(
        "id, deal_id, author_id, body, created_at, amo_id, amo_note_type",
        { count: "exact" },
      )
      .eq("deal_id", id)
      .or("amo_note_type.is.null,amo_note_type.not.in.(call_in,call_out)")
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("calls")
      .select(
        "id, external_id, direction, status, from_phone, to_phone, user_id, started_at, answered_at, duration_sec, recording_url",
        { count: "exact" },
      )
      .eq("deal_id", id)
      .order("started_at", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("stage_transitions")
      .select(
        "id, from_stage_id, to_stage_id, from_status, to_status, changed_by, changed_at",
        { count: "exact" },
      )
      .eq("deal_id", id)
      .order("changed_at", { ascending: false })
      .limit(FEED_LIMIT),
  ]);
  const responses = {
    contact,
    phones,
    importedPhones,
    channels,
    owner,
    stage,
    projects,
    projectRows,
    tags,
    tagRows,
    source,
    tasks,
    notes,
    calls,
    transitions,
  };
  for (const [label, response] of Object.entries(responses))
    if (response?.error) throw new Error(`${label}: ${response.error.message}`);
  const ids = [
    ...new Set(
      [
        ...(tasks.data ?? []).map((row) => row.assignee_id),
        ...(notes.data ?? []).map((row) => row.author_id),
        ...(calls.data ?? []).map((row) => row.user_id),
        ...(transitions.data ?? []).map((row) => row.changed_by),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const people = ids.length
    ? await supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("id", ids)
    : { data: [], error: null };
  if (people.error) throw new Error(`Профили ленты: ${people.error.message}`);
  const stageIds = [
    ...new Set(
      (transitions.data ?? [])
        .flatMap((row) => [row.from_stage_id, row.to_stage_id])
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const transitionStages = stageIds.length
    ? await supabase.from("stages").select("id, name").in("id", stageIds)
    : { data: [], error: null };
  if (transitionStages.error)
    throw new Error(`Этапы ленты: ${transitionStages.error.message}`);
  const phonesForRecord = [
    ...(phones.data ?? []),
    ...(importedPhones.data ?? []).map((phone) => ({
      id: `imported-${phone.contact_id}-${phone.ordinal}`,
      phone: phone.raw_phone,
      is_primary: false,
    })),
  ].filter((phone, index, all) => {
    const keys = phoneDedupKeys(phone.phone);
    if (!keys.length)
      return all.findIndex((candidate) => candidate.phone === phone.phone) === index;
    const duplicate = all.slice(0, index).some((candidate) =>
      phoneDedupKeys(candidate.phone).some((key) => keys.includes(key)),
    );
    return !duplicate;
  });
  const data: DealRecordData = {
    deal,
    contact: contact.data,
    phones: phonesForRecord,
    channels: channels.data ?? [],
    owner: owner.data,
    stage: stage.data,
    projects: projects.data ?? [],
    tags: tags.data ?? [],
    source: source.data,
    tasks: tasks.data ?? [],
    notes: notes.data ?? [],
    calls: calls.data ?? [],
    transitions: transitions.data ?? [],
    people: people.data ?? [],
    transitionStages: transitionStages.data ?? [],
    currentUser: { id: profile.id, full_name: profile.full_name },
    feedCounts: {
      tasks: tasks.count ?? 0,
      notes: notes.count ?? 0,
      calls: calls.count ?? 0,
      stages: transitions.count ?? 0,
    },
  };
  return (
    <div className="record-page">
      <header className="record-header">
        <Link href="/deals" className="record-back">
          <ArrowLeft size={16} /> Сделки
        </Link>
        <span className="record-separator">/</span>
        <strong>{contact.data?.full_name ?? "Сделка"}</strong>
        <span className="header-spacer" />
      </header>
      <DealRecordClient data={data} />
    </div>
  );
}
