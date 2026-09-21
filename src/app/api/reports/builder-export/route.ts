import { getCurrentProfile } from "@/lib/auth";
import { loadBuilderDashboard } from "@/app/(app)/reports/builder-data";

type Period = "month" | "quarter" | "year";

function parsePeriod(value: string | null): Period {
  return value === "quarter" || value === "year" ? value : "month";
}

function csvCell(value: string | number | null) {
  const text = value == null ? "" : String(value);
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function csvRow(values: Array<string | number | null>) {
  return values.map(csvCell).join(",");
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
        "Количество",
        "Сумма EUR",
        "Известно сумм",
        "Всего записей",
      ],
      [
        "Итоги",
        "Резервации",
        data.metrics.reservations,
        data.metrics.reservationAmount.sum,
        data.metrics.reservationAmount.knownCount,
        data.metrics.reservationAmount.totalCount,
      ],
      [
        "Итоги",
        "Договоры",
        data.metrics.contracts,
        data.metrics.contractAmount.sum,
        data.metrics.contractAmount.knownCount,
        data.metrics.contractAmount.totalCount,
      ],
      ...data.projects.map((project) => [
        "Площадка",
        project.name,
        project.reservations,
        project.reservationAmount.sum,
        project.reservationAmount.knownCount,
        project.reservationAmount.totalCount,
      ]),
      ...data.stageBars.map((stage) => [
        "Этап",
        stage.name,
        stage.count,
        null,
        null,
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
