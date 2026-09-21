import { Clock3 } from "lucide-react";
import { SettingsPlaceholder } from "../settings-placeholder";
export default function WorkingHoursPage() {
  return <SettingsPlaceholder title="Рабочие часы" description="Расписание отдела для SLA и автоматических задач" icon={<Clock3 size={18} />} />;
}
