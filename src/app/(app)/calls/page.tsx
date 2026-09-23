import Link from "next/link";
import Form from "next/form";
import { Suspense } from "react";
import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import {
  ExternalLink,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Play,
  Search,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { EmptyState } from "@/components/crm/empty-state";
import {
  CALLS_SELECT,
  RESULT_LABEL,
  callPhone,
  callResult,
  displayName,
  formatCallDate,
  formatDuration,
  formatWait,
  needsCallback,
  type CallDbRow,
} from "@/lib/calls/types";
import { hydrateCalls } from "@/lib/calls/server";
import { CallPanel, PanelSkeleton } from "./call-panel";
import { CallRow } from "./call-row";
import { AutoSubmitForm } from "./calls-filters";
import styles from "./calls.module.css";

const PAGE_SIZE = 50;
type Seg = "all" | "nocallback" | "missed" | "mine";
type Sort = "new" | "old" | "long";
const SEGS: { key: Seg; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "nocallback", label: "Не перезвонили" },
  { key: "missed", label: "Пропущенные" },
  { key: "mine", label: "Мои" },
];

type Params = {
  seg?: string;
  q?: string;
  period?: string;
  user?: string;
  dir?: string;
  rec?: string;
  sort?: string;
  page?: string;
  call?: string;
};

function sanitizeTerm(term: string): string {
  return term.replace(/[%(),]/g, "").trim().slice(0, 40);
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// Нижняя граница периода в ISO: вызывается из серверного кода запроса,
// Date.now здесь — момент запроса, а не рендера клиента.
function periodStart(days: string): string | null {
  if (days === "all") return null;
  return new Date(Date.now() - Number(days) * 86400000).toISOString();
}

export default async function CallsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role === "builder") redirect("/reports");
  if (!["manager", "head", "admin"].includes(profile.role)) redirect("/deals");
  const params = await searchParams;

  const seg: Seg = params.seg === "nocallback" || params.seg === "missed" || params.seg === "mine" ? params.seg : "all";
  const q = sanitizeTerm(params.q ?? "");
  const period = params.period === "7" || params.period === "90" || params.period === "all" ? params.period : "30";
  const userFilter = (params.user ?? "all").trim();
  const dir = params.dir === "in" || params.dir === "out" ? params.dir : "all";
  const onlyRec = params.rec === "1";
  const sort: Sort = params.sort === "old" || params.sort === "long" ? params.sort : "new";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const selectedId = params.call?.trim() || null;

  const supabase = await createClient();
  const errors: string[] = [];

  // Сотрудники для фильтра: только активные.
  const { data: employees } = await supabase
    .from("profiles")
    .select("id,full_name")
    .eq("is_active", true)
    .order("full_name");

  // Поиск: номер — по from/to напрямую, имя — через контакты.
  let contactIds: string[] = [];
  if (q) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id")
      .ilike("full_name", `%${q}%`)
      .limit(200);
    if (error) errors.push("Поиск по именам временно недоступен");
    contactIds = (data ?? []).map((r) => r.id as string);
  }

  // Самореферентный интерфейс вместо дженериков: цепочка PostgREST
  // возвращает тот же тип строителя, глубокий вывод типов не нужен.
  interface Chain {
    eq(column: string, value: string): Chain;
    or(filters: string): Chain;
    is(column: string, value: null): Chain;
    gte(column: string, value: string): Chain;
    gt(column: string, value: number): Chain;
    order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): Chain;
  }

  const applyFilters = (builder: unknown): unknown => {
    let b = builder as Chain;
    if (seg === "mine") b = b.eq("user_id", profile.id);
    else if (seg === "missed") b = b.eq("direction", "in").or("duration_sec.is.null,duration_sec.eq.0");
    else if (seg === "nocallback")
      b = b.eq("direction", "in").or("duration_sec.is.null,duration_sec.eq.0").is("called_back_at", null);
    if (period !== "all") {
      const since = periodStart(period);
      if (since) b = b.gte("started_at", since);
    }
    if (userFilter !== "all") b = b.eq("user_id", userFilter);
    if (dir !== "all") b = b.eq("direction", dir);
    if (onlyRec) b = b.or("recording_path.not.is.null,and(recording_url.not.is.null,recording_url.neq.)");
    if (q) {
      const ors = [`from_phone.ilike.%${q}%`, `to_phone.ilike.%${q}%`];
      if (contactIds.length) ors.push(`contact_id.in.(${contactIds.join(",")})`);
      b = b.or(ors.join(","));
    }
    return b;
  };

  const applySort = (builder: unknown): unknown => {
    const b = builder as Chain;
    if (sort === "old") return b.order("started_at", { ascending: true }).order("id", { ascending: true });
    if (sort === "long")
      return b
        .order("duration_sec", { ascending: false, nullsFirst: true })
        .order("started_at", { ascending: false });
    return b.order("started_at", { ascending: false }).order("id", { ascending: true });
  };

  interface QList extends Chain {
    range(from: number, to: number): QList;
  }

  type ListResult = { data: unknown[] | null; error: { message: string } | null; count: number | null };
  const asList = (builder: unknown): QList => builder as QList;
  const runList = (from: number, to: number): Promise<ListResult> =>
    asList(applySort(applyFilters(supabase.from("calls").select(CALLS_SELECT, { count: "exact" })))).range(
      from,
      to,
    ) as unknown as Promise<ListResult>;

  const from = (page - 1) * PAGE_SIZE;
  let list = await runList(from, from + PAGE_SIZE - 1);
  let total = list.count ?? 0;
  let safePage = page;
  if (page > 1 && (list.data ?? []).length === 0 && total > 0) {
    safePage = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const retryFrom = (safePage - 1) * PAGE_SIZE;
    list = await runList(retryFrom, retryFrom + PAGE_SIZE - 1);
    total = list.count ?? total;
  }
  if (list.error) errors.push("Не удалось загрузить список звонков");
  const rows = (list.data ?? []) as unknown as CallDbRow[];
  const calls = await hydrateCalls(supabase, rows);

  // Счётчик «Не перезвонили» живёт в том же периоде, что и список: иначе
  // таб показывает «за всё время», а строка итогов — за 30 дней.
  const runNoCallback = () => {
    let query = supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("direction", "in")
      .or("duration_sec.is.null,duration_sec.eq.0")
      .is("called_back_at", null);
    if (period !== "all") {
      const since = periodStart(period);
      if (since) query = query.gte("started_at", since);
    }
    return query;
  };
  // Итоги считает та же выборка, что и список: «разговоров» — точный
  // head-счётчик с теми же фильтрами плюс длительность > 0, поэтому их
  // всегда не больше, чем звонков. Сумма длительностей — по первым
  // 5000 строк выборки, на тоталах больше выборки она приблизительная.
  interface QStats extends Chain {
    limit(n: number): QStats;
  }
  type StatsResult = { data: { duration_sec: number | null }[] | null; error: { message: string } | null };
  type HeadResult = { error: { message: string } | null; count: number | null };
  const statsPromise = (applyFilters(supabase.from("calls").select("duration_sec")) as unknown as QStats).limit(
    5000,
  ) as unknown as Promise<StatsResult>;
  const talkedPromise = (applyFilters(
    supabase.from("calls").select("id", { count: "exact", head: true }),
  ) as unknown as QStats).gt("duration_sec", 0) as unknown as Promise<HeadResult>;
  let noCallback = await runNoCallback();
  // Однократный повтор: под manager счётчик иногда не приезжает с первого
  // раза, а таб без числа выглядит сломанным.
  if (noCallback.error) noCallback = await runNoCallback();
  const [talkedHead, stats] = await Promise.all([talkedPromise, statsPromise]);
  if (noCallback.error) errors.push("Счётчик «Не перезвонили» временно недоступен");
  if (talkedHead.error) errors.push("Итоги выборки временно недоступны");
  if (stats.error) errors.push("Длительность разговоров временно недоступна");
  const statRows = (stats.data ?? []) as { duration_sec: number | null }[];
  const talked = talkedHead.error ? statRows.filter((r) => (r.duration_sec ?? 0) > 0).length : (talkedHead.count ?? 0);
  const totalSec = statRows.reduce((sum, r) => sum + Math.max(0, r.duration_sec ?? 0), 0);
  const totalHours = Math.floor(totalSec / 3600);
  const totalMinutes = Math.round((totalSec % 3600) / 60);

  const link = (next: Partial<Record<string, string | number | null>>) => {
    const search = new URLSearchParams();
    const put = (key: string, value: string, def: string) => {
      if (value !== def) search.set(key, value);
    };
    put("seg", typeof next.seg === "string" ? next.seg : seg, "all");
    if (q) search.set("q", q);
    put("period", typeof next.period === "string" ? next.period : period, "30");
    put("user", typeof next.user === "string" ? next.user : userFilter, "all");
    put("dir", typeof next.dir === "string" ? next.dir : dir, "all");
    if (next.rec !== undefined ? next.rec === "1" : onlyRec) search.set("rec", "1");
    put("sort", typeof next.sort === "string" ? next.sort : sort, "new");
    const nextPage = typeof next.page === "number" ? next.page : safePage;
    if (nextPage > 1) search.set("page", String(nextPage));
    const callParam = next.call === null ? null : (typeof next.call === "string" ? next.call : selectedId);
    if (callParam) search.set("call", callParam);
    const text = search.toString();
    return text ? `/calls?${text}` : "/calls";
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <Phone size={16} aria-hidden="true" />
        <span className={styles.titleStack}>
          <span className={styles.t}>Звонки</span>
          <span className={styles.s}>Журнал разговоров отдела</span>
        </span>
        <span className={`${styles.headerCount} pill`}>{total.toLocaleString("ru-RU")}</span>
      </header>
      {errors.length > 0 && (
        <div className={styles.alert} role="alert">
          Не всё удалось загрузить: {errors.join(" · ")}
        </div>
      )}

      <div className={styles.toolbar}>
        <span className={`${styles.seg} view-switch`} role="tablist" aria-label="Быстрый фильтр звонков">
          {SEGS.map((tab) => (
            <Link
              key={tab.key}
              role="tab"
              aria-selected={seg === tab.key}
              className={`${seg === tab.key ? styles.segOn : styles.segItem} ${seg === tab.key ? "view-switch-active" : ""}`}
              href={link({ seg: tab.key, page: 1, call: null })}
            >
              {tab.label}
              {tab.key === "nocallback" && (noCallback.count ?? 0) > 0 && (
                <span className={`${styles.pillAmber} pill`}>{noCallback.count}</span>
              )}
            </Link>
          ))}
        </span>
        <Form className={styles.searchForm} action="/calls" role="search" key={`search|${seg}|${q}`}>
          {seg !== "all" && <input type="hidden" name="seg" value={seg} />}
          <Search size={14} aria-hidden="true" />
          <input name="q" defaultValue={q} placeholder="Поиск по номеру или имени" aria-label="Поиск по номеру или имени" />
        </Form>
      </div>

      <div className={styles.filterbar}>
        <AutoSubmitForm action="/calls" key={`filters|${seg}|${q}|${period}|${userFilter}|${dir}|${sort}|${onlyRec}|${selectedId ?? ""}`}>
          {seg !== "all" && <input type="hidden" name="seg" value={seg} />}
          {q && <input type="hidden" name="q" value={q} />}
          {selectedId && <input type="hidden" name="call" value={selectedId} />}
          <label className={styles.chip}>
            Период:&nbsp;
            <select name="period" defaultValue={period}>
              <option value="7">7 дней</option>
              <option value="30">30 дней</option>
              <option value="90">90 дней</option>
              <option value="all">Всё время</option>
            </select>
          </label>
          <label className={styles.chip}>
            Сотрудник:&nbsp;
            <select name="user" defaultValue={userFilter}>
              <option value="all">все</option>
              {(employees ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {(e.full_name as string) ?? "сотрудник"}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.chip}>
            Направление:&nbsp;
            <select name="dir" defaultValue={dir}>
              <option value="all">все</option>
              <option value="in">входящие</option>
              <option value="out">исходящие</option>
            </select>
          </label>
          <label className={styles.chip}>
            Сортировка:&nbsp;
            <select name="sort" defaultValue={sort}>
              <option value="new">сначала новые</option>
              <option value="old">сначала старые</option>
              <option value="long">сначала длинные</option>
            </select>
          </label>
          <label className={styles.switchLabel}>
            <input type="checkbox" name="rec" value="1" defaultChecked={onlyRec} />
            Только с записью
          </label>
        </AutoSubmitForm>
        <span style={{ flex: 1 }} />
        <span className={styles.totals}>
          {total.toLocaleString("ru-RU")} {plural(total, "звонок", "звонка", "звонков")} ·{" "}
          {talked.toLocaleString("ru-RU")} {plural(talked, "разговор", "разговора", "разговоров")} ·{" "}
          {totalHours > 0 ? `${totalHours} ч ${totalMinutes} мин` : `${totalMinutes} мин`}
        </span>
      </div>

      <div className={`${styles.work} ${selectedId ? "" : styles.workSolo}`}>
        <div className={styles.tableCol}>
          <div className={styles.tableScroll}>
            {calls.length === 0 ? (
              <EmptyState
                icon={<Phone size={18} />}
                title={q || seg !== "all" ? "Звонков нет" : "Звонков пока нет"}
                description={
                  q || seg !== "all"
                    ? "По этому фильтру ничего нет. Снимите фильтр или измените запрос."
                    : "Первый звонок через телефонию появится здесь."
                }
              />
            ) : (
              <table className={styles.table} aria-label="Журнал звонков">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th style={{ width: 32 }} />
                    <th>Контакт</th>
                    <th>Сотрудник</th>
                    <th style={{ textAlign: "right" }}>Ожид.</th>
                    <th style={{ textAlign: "right" }}>Длит.</th>
                    <th>Результат</th>
                    <th style={{ width: 36 }} />
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody className="motion-list">
                  {calls.map((call, index) => {
                    const phone = callPhone(call);
                    const name = displayName(call, phone);
                    const result = callResult(call);
                    const callback = needsCallback(call);
                    const dur = call.duration_sec ?? 0;
                    return (
                      <CallRow
                        key={call.id}
                        href={link({ call: call.id })}
                        style={{ "--i": index } as CSSProperties}
                        className={`${styles.row} ${selectedId === call.id ? styles.selected : ""} ${callback ? styles.isCallback : ""}`}
                      >
                        <td>
                          <Link href={link({ call: call.id })} aria-label={`Открыть звонок ${phone}`}>
                            {dur > 0 ? (
                              <span className={styles.rowPlay}>
                                <Play size={12} aria-hidden="true" />
                              </span>
                            ) : (
                              <span className={styles.rowPlay}>
                                <X size={12} aria-hidden="true" />
                              </span>
                            )}
                          </Link>
                        </td>
                        <td>
                          {result === "missed" ? (
                            <PhoneMissed size={14} color="var(--destructive)" aria-label="Пропущенный" />
                          ) : call.direction === "in" ? (
                            <PhoneIncoming size={14} color="var(--success)" aria-label="Входящий" />
                          ) : (
                            <PhoneOutgoing size={14} color="var(--muted-foreground)" aria-label="Исходящий" />
                          )}
                        </td>
                        <td>
                          <Link href={link({ call: call.id })} className={styles.cellContact}>
                            {name ? (
                              <>
                                <span className={styles.n}>{name}</span>
                                <span className={styles.p}>{phone}</span>
                              </>
                            ) : (
                              <span className={styles.n}>{phone}</span>
                            )}
                          </Link>
                        </td>
                        <td>
                          {call.employee ? (
                            <span className={styles.whoEmp}>
                              <span className={styles.avatar}>
                                {call.employee.full_name.slice(0, 2).toUpperCase()}
                              </span>
                              {call.employee.full_name}
                            </span>
                          ) : (
                            <span className={styles.nobody}>— никто не взял</span>
                          )}
                        </td>
                        <td className={styles.dim}>{formatWait(call.wait_sec)}</td>
                        <td className={styles.num}>{formatDuration(dur)}</td>
                        <td>
                          <span
                            className={
                              result === "talked"
                                ? styles.resOk
                                : result === "missed"
                                  ? styles.resMissed
                                  : result === "busy"
                                    ? styles.resBusy
                                    : styles.resFail
                            }
                          >
                            {RESULT_LABEL[result]}
                          </span>{" "}
                          {callback && (
                            <span className={styles.resNote}>
                              <span className={styles.dotAmber} />
                              не перезвонили
                            </span>
                          )}
                        </td>
                        <td>
                          {call.deal && (
                            <Link
                              className={styles.dealLink}
                              href={`/deals/${call.deal.id}`}
                              aria-label="Открыть сделку"
                            >
                              <ExternalLink size={14} aria-hidden="true" />
                            </Link>
                          )}
                        </td>
                        <td className={styles.dim}>{formatCallDate(call.started_at)}</td>
                      </CallRow>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className={styles.pagination}>
            <span>
              {total ? `${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, total)} из ${total}` : "0 звонков"}
            </span>
            <nav aria-label="Страницы">
              <Link className={safePage <= 1 ? styles.pageBtnDisabled : styles.pageBtn} href={link({ page: Math.max(1, safePage - 1) })}>
                Назад
              </Link>
              <Link className={safePage >= pages ? styles.pageBtnDisabled : styles.pageBtn} href={link({ page: Math.min(pages, safePage + 1) })}>
                Дальше
              </Link>
            </nav>
          </div>
        </div>

        {selectedId && (
          <Suspense key={selectedId} fallback={<PanelSkeleton />}>
            <CallPanel callId={selectedId} closeHref={link({ call: null })} />
          </Suspense>
        )}
      </div>
    </section>
  );
}
