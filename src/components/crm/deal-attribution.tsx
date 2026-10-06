import type { Attribution } from "@/lib/deal-fields";
import styles from "./deal-attribution.module.css";

type AttributionDeal = {
  created_at: string;
  first_inbound_at?: string | null;
  utm?: unknown;
  [key: string]: unknown;
};

type Row = { label: string; value: string; hint?: string; clip?: boolean };

const asText = (value: unknown): string | null => {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
};

const PLATFORMS: Record<string, string> = { fb: "Facebook", ig: "Instagram", facebook: "Facebook", instagram: "Instagram" };

const formatDate = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    timeZone: "Europe/Chisinau",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

// Имя, если оно есть, иначе идентификатор; идентификатор остаётся во всплывающей подсказке.
function named(name: string | null, id: string | null): Pick<Row, "value" | "hint"> | null {
  if (name) return { value: name, hint: id ? `ID ${id}` : undefined };
  if (id) return { value: id };
  return null;
}

export function attributionRows(deal: AttributionDeal, attribution: Attribution, sourceName: string | null): Row[] {
  const utm = deal.utm && typeof deal.utm === "object" && !Array.isArray(deal.utm) ? (deal.utm as Record<string, unknown>) : {};
  const metaCampaignId = asText(deal.meta_campaign_id);
  const rows: Row[] = [];
  const add = (label: string, value: Pick<Row, "value" | "hint"> | string | null) => {
    if (!value) return;
    rows.push({ label, ...(typeof value === "string" ? { value } : value) });
  };

  add("Источник", sourceName);
  add("Канал", attribution.utm_medium);
  add("Форма", named(attribution.FORMNAME, asText(deal.meta_form_id) ?? asText(utm.form_id)));
  const platform = asText(utm.platform);
  add("Площадка", platform ? (PLATFORMS[platform.toLowerCase()] ?? platform) : null);
  add("UTM-источник", attribution.utm_source);
  add("UTM-кампания", attribution.utm_campaign);
  add("UTM-содержание", attribution.utm_content);
  add("UTM-ключ", attribution.utm_term);
  // У импорта из Amo utm_id — тот же номер кампании Meta: второй раз его не повторяем.
  if (attribution.UTM_ID !== metaCampaignId) add("UTM-ID", attribution.UTM_ID);
  add("Кампания Meta", named(asText(deal.meta_campaign_name), metaCampaignId));
  add("Группа объявлений Meta", named(asText(deal.meta_adset_name), asText(deal.meta_adset_id)));
  add("Объявление Meta", named(asText(deal.meta_ad_name), asText(deal.meta_ad_id) ?? asText(utm.ad_id)));
  // Метки клика — длинные случайные строки: в одну строку с многоточием, целиком во всплывающей подсказке.
  const clicks: [string, string | null][] = [["Метка клика Facebook", attribution.fbclid], ["Метка клика Google", asText(utm.gclid)]];
  for (const [label, value] of clicks) if (value) rows.push({ label, value, clip: true });
  add("Страница отправки", asText(utm.page_url));
  add("Пришёл со страницы", asText(utm.referrer));
  return rows;
}

/** Блок «Откуда пришёл»: только то, что записано. Пусто — одна строка вместо прочерков. */
export function DealAttribution({
  deal,
  attribution,
  sourceName,
  className,
}: {
  deal: AttributionDeal;
  attribution: Attribution;
  sourceName: string | null;
  className?: string;
}) {
  const rows = attributionRows(deal, attribution, sourceName);
  if (rows.length === 0) {
    return (
      <section className={className}>
        <p className={styles.empty}>Атрибуция не записана</p>
      </section>
    );
  }
  const first = deal.first_inbound_at ?? deal.created_at;
  return (
    <section className={className} aria-label="Откуда пришёл">
      <h3>Откуда пришёл</h3>
      {rows.map((row) => (
        <div className="field-row" key={row.label}>
          <span>{row.label}</span>
          <span className={`field-static ${row.clip ? styles.clip : styles.value}`} title={row.hint ?? row.value}>
            {row.value}
          </span>
        </div>
      ))}
      <div className="field-row">
        <span>Первое обращение</span>
        <span className="field-static">{formatDate(first)}</span>
      </div>
    </section>
  );
}
