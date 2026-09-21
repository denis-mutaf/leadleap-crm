import { Bell } from "lucide-react";
import { SettingsPlaceholder } from "../settings-placeholder";
export default function NotificationsPage() {
  return (
    <SettingsPlaceholder
      title="Уведомления"
      description="События, адресаты и способы доставки"
      icon={<Bell size={18} />}
      waitingFor="Правила уведомлений пока не настраиваются"
      items={[
        "Кого звать на новую заявку и на просроченную задачу",
        "Куда слать: колокольчик, почта, мессенджер",
        "Тихие часы и повторные напоминания",
      ]}
    />
  );
}
