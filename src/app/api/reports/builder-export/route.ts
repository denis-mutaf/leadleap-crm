import { getCurrentProfile } from "@/lib/auth";
import { loadBuilderDashboard } from "@/app/(app)/reports/builder-data";

type Period = "month" | "quarter" | "year";

function parsePeriod(value: string | null): Period {
  return value === "quarter" || value === "year" ? value : "month";
}

function csvCell(value: string | number | null) {
  const text = value == null ? "" : String(value);
  const safeText = /^[\t \r\n]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function csvRow(values: Array<string | number | null>) {
  return values.map(csvCell).join(",");
}

function amountValue(amount: { sum: number; knownCount: number }) {
  return amount.knownCount > 0 ? amount.sum : null;
}

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile)
    return new Response("Unauthorized\n", {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  if (profile.role !== "builder")
    return new Response("Forbidden\n", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });

  const period = parsePeriod(new URL(request.url).searchParams.get("period"));
  try {
    const data = await loadBuilderDashboard(period);
    const rows: Array<Array<string | number | null>> = [
      [
        "Раздел",
        "Название",
        "Обращений",
        "Встреч",
        "Резерваций",
        "Сумма резерваций EUR",
        "Известно сумм резерваций",
        "Всего резерваций",
        "Договоров",
        "Сумма договоров EUR",
        "Известно сумм договоров",
        "Всего договоров",
        "Сделок на открытых этапах",
        "Открытых сделок всего",
        "Дней до резервации",
      ],
      [
        "Итоги",
        "Резервации",
        null,
        null,
        data.metrics.reservations,
        amountValue(data.metrics.reservationAmount),
        data.metrics.reservationAmount.knownCount,
        data.metrics.reservationAmount.totalCount,
        null,
        null,
        null,
        null,
        null,
        data.openTotal,
        data.metrics.daysToReservation,
      ],
      [
        "Итоги",
        "Договоры",
        null,
        null,
        null,
        null,
        null,
        null,
        data.metrics.contracts,
        amountValue(data.metrics.contractAmount),
        data.metrics.contractAmount.knownCount,
        data.metrics.contractAmount.totalCount,
        null,
        null,
        null,
      ],
      ...data.projects.map((project) => [
        "Площадка",
        project.name,
        project.inquiries,
        project.meetings,
        project.reservations,
        amountValue(project.reservationAmount),
        project.reservationAmount.knownCount,
        project.reservationAmount.totalCount,
        project.contracts,
        amountValue(project.contractAmount),
        project.contractAmount.knownCount,
        project.contractAmount.totalCount,
        null,
        null,
        null,
      ]),
      ...data.stageBars.map((stage) => [
        "Этап",
        stage.name,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        stage.count,
        data.openTotal,
        null,
      ]),
    ];
    const csv = `\uFEFF${rows.map(csvRow).join("\r\n")}\r\n`;
    const filename = `builder-dashboard-${period}.csv`;
    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
      },
    });
  } catch {
    return new Response("Export failed\n", {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
