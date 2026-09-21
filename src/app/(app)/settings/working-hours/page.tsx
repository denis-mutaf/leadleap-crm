import { Clock3 } from "lucide-react";
import { SettingsPlaceholder } from "../settings-placeholder";
export default function WorkingHoursPage() {
  return (
    <SettingsPlaceholder
      title="Рабочие часы"
      description="Расписание отдела для SLA и автоматических задач"
      icon={<Clock3 size={18} />}
      waitingFor="Расписание отдела пока не задаётся"
      items={[
        "График работы по дням недели и выходные",
        "Срок ответа на заявку внутри рабочего дня",
        "Перенос автоматических задач на ближайшее рабочее время",
      ]}
    />
  );
}
