import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  mapPbxDirection,
  mapPbxStatus,
  normalizePhone,
  parsePbxStart,
} from "@/lib/pbx/protocol";

export const dynamic = "force-dynamic";

const INVALID_TOKEN = { error: "Invalid token" };
const INVALID_PARAMS = { error: "Invalid parameters" };

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  if (contentType.includes("application/json")) {
    const json = (await req.json()) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(json ?? {}).map(([k, v]) => [k, String(v ?? "")]),
    );
  }
  // АТС шлёт form-urlencoded, но пробуем разобрать как форму по умолчанию.
  const text = await req.text();
  if (text.includes("=")) {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  return {};
}

type Db = ReturnType<typeof serviceDb>;

async function profileIdByLogin(
  db: Db,
  login: string | undefined,
): Promise<string | null> {
  if (!login) return null;
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("pbx_login", login)
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

async function findContactByPhone(
  db: Db,
  rawPhone: string,
): Promise<{ contactId: string; fullName: string } | null> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return null;
  const last8 = normalized.replace(/\D/g, "").slice(-8);
  const { data: phoneRows, error: phoneError } = await db
    .from("contact_phones")
    .select("contact_id")
    .or(`phone.eq.${normalized},phone.like.%${last8}`);
  if (phoneError)
    throw new Error(`contact_phones lookup failed: ${phoneError.message}`);

  const { data: importedRows, error: importedError } = await db
    .from("imported_contact_phones")
    .select("contact_id, normalized_phone")
    .or(`normalized_phone.eq.${normalized},normalized_phone.like.%${last8}`);
  if (importedError) {
    throw new Error(
      `imported_contact_phones lookup failed: ${importedError.message}`,
    );
  }

  const candidateIds = new Set<string>([
    ...(phoneRows ?? []).map((row) => row.contact_id as string),
    ...(importedRows ?? [])
      .filter(
        (row) => normalizePhone(row.normalized_phone as string) === normalized,
      )
      .map((row) => row.contact_id as string),
  ]);
  if (candidateIds.size === 0) return null;

  // Resolve merges before deciding whether the number is ambiguous: two old
  // cards that point at one survivor are still one logical contact.
  const resolvedIds = new Set<string>();
  for (const candidateId of candidateIds) {
    let currentId = candidateId;
    const visited = new Set<string>();
    let reachedTerminal = false;
    while (!visited.has(currentId)) {
      visited.add(currentId);
      const { data: current, error } = await db
        .from("contacts")
        .select("id, merged_into")
        .eq("id", currentId)
        .maybeSingle();
      if (error)
        throw new Error(`contact merge lookup failed: ${error.message}`);
      if (!current) break;
      if (!current.merged_into) {
        resolvedIds.add(current.id as string);
        reachedTerminal = true;
        break;
      }
      currentId = current.merged_into as string;
    }
    if (!reachedTerminal) {
      throw new Error(`Contact merge cycle detected at ${currentId}`);
    }
  }
  if (resolvedIds.size > 1) {
    throw new Error(`Ambiguous phone match: ${resolvedIds.size} contacts`);
  }
  const contactId = [...resolvedIds][0];
  if (!contactId) return null;
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .select("id, full_name")
    .eq("id", contactId)
    .single();
  if (contactError)
    throw new Error(`contact lookup failed: ${contactError.message}`);
  return {
    contactId: contact.id as string,
    fullName: contact.full_name as string,
  };
}

async function openDeals(db: Db, contactId: string) {
  const { data, error } = await db
    .from("deals")
    .select("id, title, owner_id")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`open deals lookup failed: ${error.message}`);
  return (data ?? []) as {
    id: string;
    title: string | null;
    owner_id: string | null;
  }[];
}

async function firstStageId(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from("stages")
    .select("id")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`first stage lookup failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function phoneSourceId(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from("sources")
    .select("id")
    .eq("code", "phone")
    .maybeSingle();
  if (error) throw new Error(`phone source lookup failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

async function callTaskTypeId(db: Db): Promise<string | null> {
  const { data, error } = await db
    .from("task_types")
    .select("id")
    .eq("code", "call")
    .maybeSingle();
  if (error) throw error;
  return (data?.id as string | undefined) ?? null;
}

// Создаёт контакт + телефон + сделку на первом этапе без ответственного.
async function ensureContactAndDeal(
  db: Db,
  rawPhone: string,
): Promise<{ contactId: string; dealId: string }> {
  const existing = await findContactByPhone(db, rawPhone);
  if (existing) {
    const deals = await openDeals(db, existing.contactId);
    if (deals.length > 0)
      return { contactId: existing.contactId, dealId: deals[0].id };
    const stageId = await firstStageId(db);
    const sourceId = await phoneSourceId(db);
    const { data: deal, error } = await db
      .from("deals")
      .insert({
        contact_id: existing.contactId,
        stage_id: stageId,
        source_id: sourceId,
        first_inbound_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    return { contactId: existing.contactId, dealId: deal.id as string };
  }
  const normalized = normalizePhone(rawPhone) ?? rawPhone;
  const stageId = await firstStageId(db);
  const sourceId = await phoneSourceId(db);
  const { data: contact, error: contactError } = await db
    .from("contacts")
    .insert({ full_name: normalized })
    .select("id")
    .single();
  if (contactError) throw contactError;
  const contactId = contact.id as string;
  const { error: phoneError } = await db
    .from("contact_phones")
    .insert({ contact_id: contactId, phone: normalized, is_primary: true });
  if (phoneError) throw phoneError;
  const { data: deal, error: dealError } = await db
    .from("deals")
    .insert({
      contact_id: contactId,
      stage_id: stageId,
      source_id: sourceId,
      first_inbound_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (dealError) throw dealError;
  return { contactId, dealId: deal.id as string };
}

function nextFullHour(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);

  const expected = process.env.PBX_CRM_TOKEN ?? "";
  if (!expected || body.crm_token !== expected) {
    return NextResponse.json(INVALID_TOKEN, { status: 401 });
  }

  const cmd = body.cmd;
  if (cmd !== "history" && cmd !== "event" && cmd !== "contact") {
    return NextResponse.json(INVALID_PARAMS, { status: 400 });
  }

  const type = body.type ?? "";
  const kind = cmd === "event" ? `event:${type}` : cmd;
  const dedupKey = body.callid ? `${cmd}:${body.callid}:${type}` : null;

  const db = serviceDb();

  // Любое событие сперва пишем в inbound_events сырым.
  let { data: inbound, error: inboundError } = await db
    .from("inbound_events")
    .insert({
      channel: "phone",
      kind,
      payload: body,
      dedup_key: dedupKey,
    })
    .select("id")
    .single();
  if (inboundError) {
    const inboundErrorCode = inboundError.code;
    let retryingIncoming = false;
    // For INCOMING, retry an unprocessed duplicate so a transient notification
    // insert failure cannot permanently lose the overlay.
    if (inboundErrorCode === "23505" && kind === "event:INCOMING") {
      const { data: existing, error: existingError } = await db
        .from("inbound_events")
        .select("id,processed_at,error")
        .eq("dedup_key", dedupKey)
        .maybeSingle();
      if (existingError) {
        return NextResponse.json(
          { error: "Inbound event lookup failed" },
          { status: 503 },
        );
      }
      if (existing && !existing.processed_at) {
        inbound = existing as typeof inbound;
        inboundError = null;
        retryingIncoming = true;
      }
    }
    if (!retryingIncoming) {
      if (inboundErrorCode === "23505")
        return NextResponse.json({}, { status: 200 });
      return NextResponse.json(
        { error: "Inbound event insert failed" },
        { status: 503 },
      );
    }
  }
  if (!inbound) return NextResponse.json(INVALID_PARAMS, { status: 400 });
  const inboundId = inbound.id as string;
  const fail = async (status: number, payload: unknown) => {
    const update = await db
      .from("inbound_events")
      .update({ error: JSON.stringify(payload) })
      .eq("id", inboundId);
    if (update.error)
      return NextResponse.json(
        { error: "Inbound event update failed" },
        { status: 503 },
      );
    return NextResponse.json(payload, { status });
  };
  const done = async (payload: unknown = {}) => {
    const update = await db
      .from("inbound_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", inboundId);
    if (update.error)
      return NextResponse.json(
        { error: "Inbound event update failed" },
        { status: 503 },
      );
    return NextResponse.json(payload, { status: 200 });
  };

  try {
    if (cmd === "contact") {
      if (!body.phone || !body.callid) return fail(400, INVALID_PARAMS);
      const found = await findContactByPhone(db, body.phone);
      if (!found) return done({});
      const deals = await openDeals(db, found.contactId);
      let responsible: string | null = null;
      const ownerId = deals.find((d) => d.owner_id)?.owner_id ?? null;
      if (ownerId) {
        const { data: profile, error: profileError } = await db
          .from("profiles")
          .select("pbx_login")
          .eq("id", ownerId)
          .maybeSingle();
        if (profileError) throw profileError;
        responsible = (profile?.pbx_login as string | undefined) ?? null;
      }
      if (!responsible) return done({});
      return done({ contact_name: found.fullName, responsible });
    }

    if (cmd === "event") {
      if (
        !body.phone ||
        !body.user ||
        !body.callid ||
        !body.direction ||
        !type
      ) {
        return fail(400, INVALID_PARAMS);
      }
      if (
        ![
          "INCOMING",
          "ACCEPTED",
          "COMPLETED",
          "CANCELLED",
          "OUTGOING",
          "TRANSFERRED",
        ].includes(type)
      ) {
        return fail(400, INVALID_PARAMS);
      }
      const direction = mapPbxDirection(body.direction);
      if (!direction) return fail(400, INVALID_PARAMS);
      const staffId = await profileIdByLogin(db, body.user);

      if (type === "INCOMING") {
        const found = await findContactByPhone(db, body.phone);
        if (found) {
          const deals = await openDeals(db, found.contactId);
          const owners = [
            ...new Set(deals.map((d) => d.owner_id).filter(Boolean)),
          ] as string[];
          const recipients =
            owners.length > 0 ? owners : staffId ? [staffId] : [];
          const dealTitles =
            deals.map((d) => d.title ?? "Без названия").join(", ") ||
            "сделок нет";
          for (const recipient of recipients) {
            const {
              data: existingNotification,
              error: notificationLookupError,
            } = await db
              .from("notifications")
              .select("id")
              .eq("user_id", recipient)
              .eq("kind", "incoming_call")
              .contains("payload", { callid: body.callid })
              .maybeSingle();
            if (notificationLookupError) throw notificationLookupError;
            if (existingNotification) continue;
            const notificationInsert = await db.from("notifications").insert({
              user_id: recipient,
              kind: "incoming_call",
              title: `Входящий звонок: ${found.fullName}`,
              body: `Сделки: ${dealTitles}`,
              contact_id: found.contactId,
              deal_id: deals.length === 1 ? deals[0].id : null,
              payload: {
                phone: body.phone,
                callid: body.callid,
                deals: deals.map((d) => d.id),
              },
            });
            if (notificationInsert.error) throw notificationInsert.error;
          }
        } else {
          const { contactId, dealId } = await ensureContactAndDeal(
            db,
            body.phone,
          );
          if (staffId) {
            const {
              data: existingNotification,
              error: notificationLookupError,
            } = await db
              .from("notifications")
              .select("id")
              .eq("user_id", staffId)
              .eq("kind", "new_lead")
              .contains("payload", { callid: body.callid })
              .maybeSingle();
            if (notificationLookupError) throw notificationLookupError;
            if (existingNotification) return done({});
            const notificationInsert = await db.from("notifications").insert({
              user_id: staffId,
              kind: "new_lead",
              title: `Новый лид: звонок с ${body.phone}`,
              body: "Контакт и сделка созданы автоматически из входящего звонка.",
              contact_id: contactId,
              deal_id: dealId,
              payload: { phone: body.phone, callid: body.callid },
            });
            if (notificationInsert.error) throw notificationInsert.error;
          }
        }
        return done({});
      }

      if (type === "ACCEPTED" || type === "COMPLETED" || type === "CANCELLED") {
        // Менеджер снял трубку — всплывающую карточку можно убрать.
        const notificationUpdate = await db
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .in("kind", ["incoming_call", "new_lead"])
          .is("read_at", null)
          .contains("payload", { callid: body.callid });
        if (notificationUpdate.error) throw notificationUpdate.error;
        if (type !== "CANCELLED") return done({});
      }

      if (type === "CANCELLED") {
        // CANCELLED на входящем — пропущенный: задача «Перезвонить».
        if (direction === "in") {
          const found = await findContactByPhone(db, body.phone);
          const contactId =
            found?.contactId ??
            (await ensureContactAndDeal(db, body.phone)).contactId;
          const deals = await openDeals(db, contactId);
          const assignee =
            deals.find((d) => d.owner_id)?.owner_id ??
            deals[0]?.owner_id ??
            staffId;
          if (!assignee) return fail(400, INVALID_PARAMS);
          const typeId = await callTaskTypeId(db);
          const taskInsert = await db.from("tasks").insert({
            deal_id: deals[0]?.id ?? null,
            contact_id: contactId,
            assignee_id: assignee,
            type_id: typeId,
            title: "Перезвонить",
            due_at: nextFullHour(),
            is_auto: true,
          });
          if (taskInsert.error) throw taskInsert.error;
        }
        return done({});
      }

      if (type === "OUTGOING") {
        const { contactId, dealId } = await ensureContactAndDeal(
          db,
          body.phone,
        );
        const deals = await openDeals(db, contactId);
        const callUpsert = await db.from("calls").upsert(
          {
            external_id: body.callid,
            direction: "out",
            contact_id: contactId,
            deal_id: deals.length === 1 ? dealId : null,
            user_id: staffId,
            to_phone: body.phone,
            raw: body,
          },
          { onConflict: "external_id", ignoreDuplicates: true },
        );
        if (callUpsert.error) throw callUpsert.error;
        return done({});
      }

      if (type === "TRANSFERRED") {
        // Звонок перевели на другого сотрудника — перепривязываем.
        if (staffId) {
          const transferUpdate = await db
            .from("calls")
            .update({ user_id: staffId })
            .eq("external_id", body.callid);
          if (transferUpdate.error) throw transferUpdate.error;
        }
        return done({});
      }

      // COMPLETED: запись звонка придёт командой history, здесь только OK.
      return done({});
    }

    // cmd=history: данные о состоявшемся звонке и ссылка на запись.
    if (
      !body.phone ||
      !body.user ||
      !body.callid ||
      !body.type ||
      !body.start ||
      !body.duration ||
      !body.status
    ) {
      return fail(400, INVALID_PARAMS);
    }
    const direction = mapPbxDirection(body.type);
    const status = mapPbxStatus(body.status);
    const startedAt = parsePbxStart(body.start);
    const durationSec = Number(body.duration);
    if (!direction || !status || !startedAt || !Number.isFinite(durationSec)) {
      return fail(400, INVALID_PARAMS);
    }
    const staffId = await profileIdByLogin(db, body.user);
    const { contactId } = await ensureContactAndDeal(db, body.phone);
    const deals = await openDeals(db, contactId);
    const { data: existingCall, error: existingCallError } = await db
      .from("calls")
      .select("id, deal_id")
      .eq("external_id", body.callid)
      .maybeSingle();
    if (existingCallError) throw existingCallError;
    const row = {
      external_id: body.callid,
      direction,
      status,
      from_phone: direction === "in" ? body.phone : body.telnum || null,
      to_phone: direction === "in" ? body.diversion || null : body.phone,
      contact_id: contactId,
      // Сделку не выбираем сами при нескольких: менеджер выберет в интерфейсе.
      deal_id:
        existingCall?.deal_id ?? (deals.length === 1 ? deals[0].id : null),
      user_id: staffId,
      started_at: startedAt,
      duration_sec: Math.trunc(durationSec),
      recording_url: body.link || null,
      raw: body,
    };
    if (existingCall) {
      const { error } = await db
        .from("calls")
        .update(row)
        .eq("id", existingCall.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("calls").insert(row);
      if (error) throw error;
    }
    return done({});
  } catch (e) {
    const inboundUpdate = await db
      .from("inbound_events")
      .update({ error: e instanceof Error ? e.message : String(e) })
      .eq("id", inboundId);
    if (inboundUpdate.error) {
      return NextResponse.json(
        { error: "Inbound event processing failed" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Inbound event processing failed" },
      { status: 503 },
    );
  }
}
