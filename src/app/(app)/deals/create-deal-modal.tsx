"use client";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
type Option = { id: string; name: string };
type Stage = Option & { kind: "open" | "won" | "lost" };
type Owner = { id: string; full_name: string };
type Candidate = {
  contact_id: string;
  full_name: string;
  latest_deal_id: string | null;
  latest_stage: string | null;
  deal_count: number;
};
export function CreateDealModal({
  stages,
  sources,
  projects,
  tags,
  owners,
}: {
  stages: Stage[];
  sources: Option[];
  projects: Option[];
  tags: Option[];
  owners: Owner[];
}) {
  const router = useRouter();
  const defaultStageId = stages.find((s) => s.kind === "open")?.id ?? "";
  const [open, setOpen] = useState(false),
    [fullName, setFullName] = useState(""),
    [phone, setPhone] = useState(""),
    [sourceId, setSourceId] = useState(""),
    [projectIds, setProjectIds] = useState<string[]>([]),
    [stageId, setStageId] = useState(defaultStageId),
    [ownerId, setOwnerId] = useState(""),
    [title, setTitle] = useState(""),
    [objectText, setObjectText] = useState(""),
    [tagIds, setTagIds] = useState<string[]>([]),
    [tagPickerOpen, setTagPickerOpen] = useState(false),
    [tagSearch, setTagSearch] = useState(""),
    [note, setNote] = useState(""),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [selectedContact, setSelectedContact] = useState<string | null>(null),
    [searching, setSearching] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const digits = phone.replace(/\D/g, "");
  useEffect(() => {
    if (!open || digits.length < 8) return;
    const n = ++request.current;
    const timer = window.setTimeout(async () => {
      const r = await createClient().rpc("find_contacts_by_phone", {
        p_phone: phone,
      });
      if (n !== request.current) return;
      setSearching(false);
      if (r.error) setError(r.error.message);
      else setCandidates((r.data ?? []) as Candidate[]);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [open, phone, digits.length]);
  useEffect(() => {
    const openFromBoard = () => setOpen(true);
    window.addEventListener("crm:create-deal-open", openFromBoard);
    return () => window.removeEventListener("crm:create-deal-open", openFromBoard);
  }, []);
  // reset is intentionally stable in behavior; Escape closes the current form snapshot.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && tagPickerOpen) {
        setTagPickerOpen(false);
        return;
      }
      if (e.key === "Escape" && !saving) {
        setOpen(false);
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving, tagPickerOpen]);
  function reset() {
    request.current += 1;
    setFullName("");
    setPhone("");
    setSourceId("");
    setProjectIds([]);
    setStageId(defaultStageId);
    setOwnerId("");
    setTitle("");
    setObjectText("");
    setTagIds([]);
    setTagPickerOpen(false);
    setTagSearch("");
    setNote("");
    setCandidates([]);
    setSelectedContact(null);
    setSearching(false);
    setError(null);
  }
  function close() {
    if (!saving) {
      setOpen(false);
      reset();
    }
  }
  function toggle(xs: string[], id: string) {
    return xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id];
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      !fullName.trim() ||
      digits.length < 8 ||
      !sourceId ||
      !projectIds.length ||
      !stageId ||
      !title.trim()
    ) {
      setError(
        "Заполните обязательные поля: имя, телефон, источник, проект, этап и название",
      );
      return;
    }
    setSaving(true);
    setError(null);
    const r = await createClient().rpc("create_crm_deal", {
      p_full_name: fullName.trim(),
      p_phone: phone,
      p_source_id: sourceId,
      p_project_ids: projectIds,
      p_stage_id: stageId,
      p_title: title.trim(),
      p_owner_id: ownerId || null,
      p_object_text: objectText.trim() || null,
      p_tag_ids: tagIds,
      p_note: note.trim() || null,
      p_reuse_contact_id: selectedContact,
    });
    if (r.error) {
      setError(r.error.message);
      setSaving(false);
      return;
    }
    const result = r.data;
    if (!result || typeof result !== "object") {
      setError("Неожиданный ответ сервера");
      setSaving(false);
      return;
    }
    const payload = result as { kind?: unknown; deal_id?: unknown };
    if (payload.kind === "created" && typeof payload.deal_id === "string") {
      router.push(`/deals/${payload.deal_id}`);
      return;
    }
    if (payload.kind === "duplicate") {
      setError(
        "Найден существующий контакт. Выберите его ниже, чтобы добавить сделку.",
      );
      setSaving(false);
      const n = ++request.current;
      const duplicateSearch = await createClient().rpc(
        "find_contacts_by_phone",
        { p_phone: phone },
      );
      if (n !== request.current) return;
      if (duplicateSearch.error) setError(duplicateSearch.error.message);
      else setCandidates((duplicateSearch.data ?? []) as Candidate[]);
      return;
    }
    setError("Не удалось создать сделку");
    setSaving(false);
  }
  return (
    <>
      <button
        className="btn create-deal-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Plus size={15} /> Новая сделка
      </button>
      {open && (
        <div
          className="create-deal-overlay motion-veil"
          role="presentation"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <section
            className="create-deal-modal create-deal-modal-wide motion-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-deal-title"
          >
            <header className="create-deal-header">
              <div>
                <h2 id="create-deal-title">Новая сделка</h2>
                <p>Контакт и параметры новой сделки</p>
              </div>
              <button
                className="create-deal-close"
                type="button"
                aria-label="Закрыть"
                onClick={close}
              >
                <X size={16} />
              </button>
            </header>
            <form onSubmit={submit}>
              <div className="create-deal-fields create-deal-scroll">
                <div className="create-deal-grid">
                  <label>
                    Имя контакта *
                    <input
                      autoFocus
                      value={fullName}
                      onChange={(e) => {
                        setFullName(e.target.value);
                        setSelectedContact(null);
                      }}
                    />
                  </label>
                  <label>
                    Телефон *
                    <input
                      value={phone}
                      onChange={(e) => {
                        request.current += 1;
                        setPhone(e.target.value);
                        setSearching(
                          e.target.value.replace(/\D/g, "").length >= 8,
                        );
                        setSelectedContact(null);
                        setCandidates([]);
                        setError(null);
                      }}
                      placeholder="+373 60000000"
                    />
                  </label>
                </div>
                {searching && (
                  <p className="create-deal-hint">Проверяем дубликаты…</p>
                )}
                {candidates.length > 0 && (
                  <div className="duplicate-list">
                    <strong>Найдено совпадение</strong>
                    {candidates.map((c) => (
                      <div
                        className={`duplicate-card ${selectedContact === c.contact_id ? "is-selected" : ""}`}
                        key={c.contact_id}
                      >
                        <div>
                          <b>{c.full_name}</b>
                          <span>
                            {c.latest_stage
                              ? `Последняя сделка · ${c.latest_stage}`
                              : "Сделок нет"}{" "}
                            · всего {c.deal_count}
                          </span>
                        </div>
                        <div className="duplicate-actions">
                          {c.latest_deal_id && (
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() =>
                                router.push(`/deals/${c.latest_deal_id}`)
                              }
                            >
                              Открыть сделку
                            </button>
                          )}
                          <button
                            className="btn"
                            type="button"
                            onClick={() => {
                              setSelectedContact(c.contact_id);
                              setFullName(c.full_name);
                            }}
                          >
                            Добавить сделку этому контакту
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="create-deal-grid">
                  <label>
                    Источник / канал *
                    <select
                      value={sourceId}
                      onChange={(e) => setSourceId(e.target.value)}
                    >
                      <option value="">Выберите источник</option>
                      {sources.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Этап *
                    <select
                      value={stageId}
                      onChange={(e) => setStageId(e.target.value)}
                    >
                      {stages
                        .filter((s) => s.kind === "open")
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend>Проекты * — выберите хотя бы один</legend>
                  <div className="create-deal-checks">
                    {projects.map((x) => (
                      <label key={x.id}>
                        <input
                          type="checkbox"
                          checked={projectIds.includes(x.id)}
                          onChange={() =>
                            setProjectIds(toggle(projectIds, x.id))
                          }
                        />
                        {x.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Название сделки *
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Например, Покупка квартиры"
                  />
                </label>
                <label>
                  Ответственный (необязательно)
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                  >
                    <option value="">Общий котёл</option>
                    {owners.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.full_name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="create-deal-tag-picker">
                  <span className="create-deal-field-label">Метки</span>
                  <div className="create-deal-tag-control">
                    <div className="create-deal-tag-chips">
                      {tagIds.length === 0 && (
                        <span className="create-deal-muted">Нет меток</span>
                      )}
                      {tagIds.map((id) => {
                        const tag = tags.find((item) => item.id === id);
                        return tag ? (
                          <button
                            className="create-deal-chip"
                            key={id}
                            type="button"
                            aria-label={`Удалить метку ${tag.name}`}
                            onClick={() => setTagIds(toggle(tagIds, id))}
                          >
                            {tag.name} ×
                          </button>
                        ) : null;
                      })}
                      <button
                        className="btn btn-ghost create-deal-add-tag"
                        type="button"
                        aria-label="Добавить метку"
                        aria-expanded={tagPickerOpen}
                        onClick={() => setTagPickerOpen((value) => !value)}
                      >
                        + Добавить метку
                      </button>
                    </div>
                    {tagPickerOpen && (
                      <div className="create-deal-tag-menu motion-popover">
                        <input
                          autoFocus
                          aria-label="Поиск меток"
                          placeholder="Поиск меток"
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                        />
                        <div className="create-deal-tag-options">
                          {tags
                            .filter((tag) =>
                              tag.name
                                .toLocaleLowerCase()
                                .includes(tagSearch.toLocaleLowerCase()),
                            )
                            .map((tag) => (
                              <button
                                className="create-deal-tag-option"
                                key={tag.id}
                                type="button"
                                aria-pressed={tagIds.includes(tag.id)}
                                onClick={() =>
                                  setTagIds(toggle(tagIds, tag.id))
                                }
                              >
                                <span>{tag.name}</span>
                                {tagIds.includes(tag.id) && <span>✓</span>}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <label>
                  Объект / комментарий
                  <textarea
                    value={objectText}
                    onChange={(e) => setObjectText(e.target.value)}
                    rows={2}
                  />
                </label>
                <label>
                  Заметка
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                  />
                </label>
              </div>
              {error && (
                <p className="create-deal-error" role="alert">
                  {error}
                </p>
              )}
              <footer className="create-deal-footer">
                <button className="btn" type="button" onClick={close}>
                  Отмена
                </button>
                <button
                  className="btn create-deal-submit"
                  type="submit"
                  disabled={saving}
                >
                  {saving ? "Создаём…" : "Создать сделку"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
