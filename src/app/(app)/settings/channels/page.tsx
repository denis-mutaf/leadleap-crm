import { MessageCircle } from "lucide-react";
import { SettingsPlaceholder } from "../settings-placeholder";
export default function ChannelsPage() {
  return <SettingsPlaceholder title="Каналы" description="Телефония, мессенджеры и формы сайта" icon={<MessageCircle size={18} />} />;
}
