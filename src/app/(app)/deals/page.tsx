import { getCurrentProfile } from "@/lib/auth";

export default async function DealsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Сделки</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Профиль сотрудника не найден, обратитесь к руководителю.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Сделки</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Воронка появится на следующем шаге.
      </p>
    </div>
  );
}
