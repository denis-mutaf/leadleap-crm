import { Bell } from "lucide-react";
import { SettingsPlaceholder } from "../settings-placeholder";
export default function NotificationsPage() {
  return <SettingsPlaceholder title="Уведомления" description="События, адресаты и способы доставки" icon={<Bell size={18} />} />;
}
