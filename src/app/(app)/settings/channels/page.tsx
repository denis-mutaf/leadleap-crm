import { MessageCircle } from "lucide-react";
import { SettingsPlaceholder } from "../settings-placeholder";
export default function ChannelsPage() {
  return (
    <SettingsPlaceholder
      title="Каналы"
      description="Телефония, мессенджеры и формы сайта"
      icon={<MessageCircle size={18} />}
      waitingFor="Ждём подключения WhatsApp, Instagram и Viber"
      items={[
        "Подключение и отключение источников обращений",
        "Правила распределения входящих между менеджерами",
        "Проверка связи и журнал доставки",
      ]}
    />
  );
}
