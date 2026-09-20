"use client";

import { Plus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Stage = { id: string; name: string; kind: "open" | "won" | "lost" };
type Contact = { id: string; full_name: string };

export function CreateDealModal({
  stages,
  contacts,
  currentUserId,
}: {
  stages: Stage[];
  contacts: Contact[];
  currentUserId: string;
}) {
  const openStages = stages.filter((stage) => stage.kind === "open");
  const [isOpen, setIsOpen] = useState(false);
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const [stageId, setStageId] = useState(openStages[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [objectText, setObjectText] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (!saving) {
      setIsOpen(false);
      setError(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contactId || !stageId || !title.trim()) {
      setError("Укажите контакт, этап и название сделки");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createClient()
      .from("deals")
      .insert({
        contact_id: contactId,
        owner_id: currentUserId,
        stage_id: stageId,
        title: title.trim(),
        object_text: objectText.trim() || null,
        budget: budget ? Number(budget) : null,
        budget_currency: "EUR",
      })
      .select("id")
      .maybeSingle();
    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }
    setTitle("");
    setObjectText("");
    setBudget("");
    setSaving(false);
    setIsOpen(false);
    window.location.reload();
  }

  return (
    <>
      <button className="btn create-deal-trigger" type="button" onClick={() => setIsOpen(true)}>
        <Plus size={15} /> Новая сделка
      </button>
      {isOpen && (
        <div className="create-deal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <section className="create-deal-modal" role="dialog" aria-modal="true" aria-labelledby="create-deal-title">
            <header className="create-deal-header">
              <div>
                <h2 id="create-deal-title">Новая сделка</h2>
                <p>Добавьте сделку в воронку</p>
              </div>
              <button className="create-deal-close" type="button" aria-label="Закрыть" onClick={close}>
                <X size={16} />
              </button>
            </header>
            <form onSubmit={submit}>
              <div className="create-deal-fields">
                <label>Название сделки<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, Квартира на Пушкина" /></label>
                <label>Контакт<select value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">Выберите контакт</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.full_name}</option>)}</select></label>
                <div className="create-deal-grid">
                  <label>Этап<select value={stageId} onChange={(event) => setStageId(event.target.value)}>{openStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label>
                  <label>Бюджет<input inputMode="decimal" type="number" min="0" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="0" /></label>
                </div>
                <label>Объект или комментарий<textarea value={objectText} onChange={(event) => setObjectText(event.target.value)} placeholder="Необязательно" rows={3} /></label>
              </div>
              {error && <p className="create-deal-error" role="alert">{error}</p>}
              <footer className="create-deal-footer"><button className="btn" type="button" onClick={close}>Отмена</button><button className="btn create-deal-submit" type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Создать сделку"}</button></footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
