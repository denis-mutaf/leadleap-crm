import { getCurrentProfile } from "@/lib/auth";
import { buildReportCsv } from "@/app/(app)/reports/reports-csv";
import {
  loadPeriodReport,
  parseReportParams,
} from "@/app/(app)/reports/reports-data";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const profile = await getCurrentProfile();
  if (!profile)
    return new Response("Unauthorized\n", { status: 401, headers: noStore });
  if (profile.role !== "head" && profile.role !== "admin")
    return new Response("Forbidden\n", { status: 403, headers: noStore });

  const search = Object.fromEntries(new URL(request.url).searchParams);
  const params = parseReportParams(search);
  try {
    const csv = buildReportCsv(params, await loadPeriodReport(params));
    const filename = `reports-${params.from}_${params.to}.csv`;
    return new Response(csv, {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
      },
    });
  } catch {
    return new Response("Export failed\n", { status: 500, headers: noStore });
  }
}
