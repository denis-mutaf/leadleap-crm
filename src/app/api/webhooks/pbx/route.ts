import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { mapPbxDirection, mapPbxStatus, normalizePhone, parsePbxStart } from "@/lib/pbx/protocol";

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

async function profileIdByLogin(db: Db, login: string | undefined): Promise<string | null> {
  if (!login) return null;
  const { data } = await db.from("profiles").select("id").eq("pbx_login", login).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function findContactByPhone(
  db: Db,
  rawPhone: string,
): Promise<{ contactId: string; fullName: string } | null> {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return null;
  const { data: phoneRow } = await db
    .from("contact_phones")
    .select("contact_id")
    .eq("phone", normalized)
    .maybeSingle();
  if (!phoneRow) return null;
  const { data: contact } = await db
    .from("contacts")
    .select("id, full_name")
    .eq("id", phoneRow.contact_id)
    .maybeSingle();
  if (!contact) return null;
  return { contactId: contact.id as string, fullName: contact.full_name as string };
}

async function openDeals(db: Db, contactId: string) {
  const { data } = await db
    .from("deals")
    .select("id, title, owner_id")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  return (data ?? []) as { id: string; title: string | null; owner_id: string | null }[];
}

async function firstStageId(db: Db): Promise<string | null> {
  const { data } = await db
    .from("stages")
    .select("id")
    .eq("is_active", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function phoneSourceId(db: Db): Promise<string | null> {
  const { data } = await db.from("sources").select("id").eq("code", "phone").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function callTaskTypeId(db: Db): Promise<string | null> {
  const { data } = await db.from("task_types").select("id").eq("code", "call").maybeSingle();
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
    if (deals.length > 0) return { contactId: existing.contactId, dealId: deals[0].id };
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
  await db.from("contact_phones").insert({ contact_id: contactId, phone: normalized, is_primary: true });
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
  const { data: inbound, error: inboundError } = await db
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
    // Повтор вебхука от оператора: дубля не создаём, отвечаем OK.
    if (inboundError.code === "23505") return NextResponse.json({}, { status: 200 });
    return NextResponse.json(INVALID_PARAMS, { status: 400 });
  }
  const inboundId = inbound.id as string;
  const fail = async (status: number, payload: unknown) => {
    await db.from("inbound_events").update({ error: JSON.stringify(payload) }).eq("id", inboundId);
    return NextResponse.json(payload, { status });
  };
  const done = async (payload: unknown = {}) => {
    await db.from("inbound_events").update({ processed_at: new Date().toISOString() }).eq("id", inboundId);
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
        const { data: profile } = await db.from("profiles").select("pbx_login").eq("id", ownerId).maybeSingle();
        responsible = (profile?.pbx_login as string | undefined) ?? null;
      }
      if (!responsible) return done({});
      return done({ contact_name: found.fullName, responsible });
    }

    if (cmd === "event") {
      if (!body.phone || !body.user || !body.callid || !body.direction || !type) {
        return fail(400, INVALID_PARAMS);
      }
      if (!["INCOMING", "ACCEPTED", "COMPLETED", "CANCELLED", "OUTGOING", "TRANSFERRED"].includes(type)) {
        return fail(400, INVALID_PARAMS);
      }
      const direction = mapPbxDirection(body.direction);
      if (!direction) return fail(400, INVALID_PARAMS);
      const staffId = await profileIdByLogin(db, body.user);

      if (type === "INCOMING") {
        const found = await findContactByPhone(db, body.phone);
        if (found) {
          const deals = await openDeals(db, found.contactId);
          const owners = [...new Set(deals.map((d) => d.owner_id).filter(Boolean))] as string[];
          const recipients = owners.length > 0 ? owners : staffId ? [staffId] : [];
          const dealTitles = deals.map((d) => d.title ?? "Без названия").join(", ") || "сделок нет";
          for (const recipient of recipients) {
            await db.from("notifications").insert({
              user_id: recipient,
              kind: "incoming_call",
              title: `Входящий звонок: ${found.fullName}`,
              body: `Сделки: ${dealTitles}`,
              contact_id: found.contactId,
              deal_id: deals.length === 1 ? deals[0].id : null,
              payload: { phone: body.phone, callid: body.callid, deals: deals.map((d) => d.id) },
            });
          }
        } else {
          const { contactId, dealId } = await ensureContactAndDeal(db, body.phone);
          if (staffId) {
            await db.from("notifications").insert({
              user_id: staffId,
              kind: "new_lead",
              title: `Новый лид: звонок с ${body.phone}`,
              body: "Контакт и сделка созданы автоматически из входящего звонка.",
              contact_id: contactId,
              deal_id: dealId,
              payload: { phone: body.phone, callid: body.callid },
            });
          }
        }
        return done({});
      }

      if (type === "ACCEPTED") {
        // Менеджер снял трубку — всплывающую карточку можно убрать.
        await db
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("kind", "incoming_call")
          .is("read_at", null)
          .contains("payload", { callid: body.callid });
        return done({});
      }

      if (type === "CANCELLED") {
        // CANCELLED на входящем — пропущенный: задача «Перезвонить».
        if (direction === "in") {
          const found = await findContactByPhone(db, body.phone);
          const contactId = found?.contactId ?? (await ensureContactAndDeal(db, body.phone)).contactId;
          const deals = await openDeals(db, contactId);
          const assignee =
            deals.find((d) => d.owner_id)?.owner_id ?? deals[0]?.owner_id ?? staffId;
          if (!assignee) return fail(400, INVALID_PARAMS);
          const typeId = await callTaskTypeId(db);
          await db.from("tasks").insert({
            deal_id: deals[0]?.id ?? null,
            contact_id: contactId,
            assignee_id: assignee,
            type_id: typeId,
            title: "Перезвонить",
            due_at: nextFullHour(),
            is_auto: true,
          });
        }
        return done({});
      }

      if (type === "OUTGOING") {
        const { contactId, dealId } = await ensureContactAndDeal(db, body.phone);
        const deals = await openDeals(db, contactId);
        await db.from("calls").upsert(
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
        return done({});
      }

      if (type === "TRANSFERRED") {
        // Звонок перевели на другого сотрудника — перепривязываем.
        if (staffId) {
          await db.from("calls").update({ user_id: staffId }).eq("external_id", body.callid);
        }
        return done({});
      }

      // COMPLETED: запись звонка придёт командой history, здесь только OK.
      return done({});
    }

    // cmd=history: данные о состоявшемся звонке и ссылка на запись.
    if (!body.phone || !body.user || !body.callid || !body.type || !body.start || !body.duration || !body.status) {
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
    const { data: existingCall } = await db
      .from("calls")
      .select("id, deal_id")
      .eq("external_id", body.callid)
      .maybeSingle();
    const row = {
      external_id: body.callid,
      direction,
      status,
      from_phone: direction === "in" ? body.phone : (body.telnum || null),
      to_phone: direction === "in" ? (body.diversion || null) : body.phone,
      contact_id: contactId,
      // Сделку не выбираем сами при нескольких: менеджер выберет в интерфейсе.
      deal_id: existingCall?.deal_id ?? (deals.length === 1 ? deals[0].id : null),
      user_id: staffId,
      started_at: startedAt,
      duration_sec: Math.trunc(durationSec),
      recording_url: body.link || null,
      raw: body,
    };
    if (existingCall) {
      const { error } = await db.from("calls").update(row).eq("id", existingCall.id);
      if (error) throw error;
    } else {
      const { error } = await db.from("calls").insert(row);
      if (error) throw error;
    }
    return done({});
  } catch (e) {
    await db
      .from("inbound_events")
      .update({ error: e instanceof Error ? e.message : String(e) })
      .eq("id", inboundId);
    return NextResponse.json(INVALID_PARAMS, { status: 400 });
  }
}
