import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

export type TableDeal = {
  id: string;
  contact: string;
  stage: string;
  stageKind: string;
  projects: string[];
  object: string;
  budget: number | null;
  currency: string;
  task: string;
  owner: string;
  source: string;
  updated: string;
};
type Props = {
  rows: TableDeal[];
  total: number;
  page: number;
  pageSize: number;
  sort: string;
  direction: "asc" | "desc";
  query: string;
  owner: string;
  stage: string;
  owners: { id: string; full_name: string }[];
  stages: { id: string; name: string }[];
};

function href(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") search.set(key, String(value));
  return `/deals/table?${search}`;
}
function money(value: number | null, currency: string) {
  return value === null
    ? "—"
    : `${currency === "EUR" ? "€" : currency} ${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)}`;
}
function date(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DealsTableView(props: Props) {
  const pages = Math.max(1, Math.ceil(props.total / props.pageSize));
  const sortLink = (field: "updated" | "budget") =>
    href({
      q: props.query,
      owner: props.owner,
      stage: props.stage,
      sort: field,
      dir: props.sort === field && props.direction === "asc" ? "desc" : "asc",
    });
  const commonParams = {
    q: props.query,
    owner: props.owner,
    stage: props.stage,
    sort: props.sort,
    dir: props.direction,
  };
  return (
    <div className="deals-table-wrap">
      <form className="table-filters" method="get">
        <input
          name="q"
          defaultValue={props.query}
          placeholder="Название или объект"
          aria-label="Поиск названия или объекта"
        />
        <select
          name="owner"
          defaultValue={props.owner}
          aria-label="Ответственный"
        >
          <option value="">Все ответственные</option>
          {props.owners.map((item) => (
            <option key={item.id} value={item.id}>
              {item.full_name}
            </option>
          ))}
        </select>
        <select name="stage" defaultValue={props.stage} aria-label="Этап">
          <option value="">Все этапы</option>
          {props.stages.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button type="submit">Применить</button>
        {(props.query || props.owner || props.stage) && (
          <Link href="/deals/table">Сбросить</Link>
        )}
      </form>
      {props.rows.length === 0 ? (
        <div className="deals-table-empty">
          <strong>Сделки не найдены</strong>
          <span>Измените фильтры или поисковый запрос.</span>
        </div>
      ) : (
        <div className="deals-table-scroll">
          <table className="deals-table">
            <thead>
              <tr>
                <th>
                  <span>Контакт</span>
                </th>
                <th>
                  <span>Этап</span>
                </th>
                <th>
                  <span>Проект</span>
                </th>
                <th>
                  <span>Объект</span>
                </th>
                <th className="deals-table-money">
                  <Link href={sortLink("budget")}>
                    Деньги{" "}
                    {props.sort === "budget" &&
                      (props.direction === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      ))}
                  </Link>
                </th>
                <th>
                  <span>Следующий шаг</span>
                </th>
                <th>
                  <span>Ответственный</span>
                </th>
                <th>
                  <span>Канал</span>
                </th>
                <th>
                  <Link href={sortLink("updated")}>
                    Обновлена{" "}
                    {props.sort === "updated" &&
                      (props.direction === "asc" ? (
                        <ArrowUp size={12} />
                      ) : (
                        <ArrowDown size={12} />
                      ))}
                  </Link>
                </th>
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link
                      className="deal-table-contact"
                      href={`/deals/${row.id}`}
                    >
                      {row.contact}
                    </Link>
                  </td>
                  <td>
                    <span
                      className={`deals-table-stage-dot ${row.stageKind}`}
                    />
                    {row.stage}
                  </td>
                  <td>
                    <div className="deals-table-projects">
                      {row.projects.length
                        ? row.projects.map((project) => (
                            <span className="deals-table-chip" key={project}>
                              {project}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </td>
                  <td className="deals-table-truncate">{row.object || "—"}</td>
                  <td className="deals-table-money">
                    {money(row.budget, row.currency)}
                  </td>
                  <td>{row.task || "Нет следующего шага"}</td>
                  <td>{row.owner || "—"}</td>
                  <td>{row.source || "—"}</td>
                  <td className="deals-table-muted">{date(row.updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav className="table-pagination" aria-label="Пагинация">
        <span>
          Страница {props.page + 1} из {pages} · найдено {props.total}
        </span>
        <span>
          {props.page > 0 && (
            <Link href={href({ ...commonParams, page: props.page - 1 })}>
              <ChevronLeft size={16} />
              Назад
            </Link>
          )}
          {props.page + 1 < pages && (
            <Link href={href({ ...commonParams, page: props.page + 1 })}>
              Вперёд
              <ChevronRight size={16} />
            </Link>
          )}
        </span>
      </nav>
    </div>
  );
}
