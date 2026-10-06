"use client";

import { useState } from "react";
import { TAG_SEPARATOR } from "@/lib/deals-filters";

type Option = { id: string; name: string };

// Мультивыбор меток для фильтра воронки: поиск по названию и галочки.
// Выбранные уходят одним параметром `name` через «.»; сервер раскладывает.
export function TagMultiSelect({ name, tags, defaultSelected }: { name: string; tags: Option[]; defaultSelected: string[] }) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visible = needle ? tags.filter((tag) => tag.name.toLowerCase().includes(needle)) : tags;
  const toggle = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  return (
    <div className="tag-pick">
      <span className="tag-pick-title">
        Метки{selected.length > 0 && <b className="pill">{selected.length}</b>}
      </span>
      <input type="hidden" name={name} value={selected.join(TAG_SEPARATOR)} />
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        // Enter в поиске не должен отправлять форму: ищем, а не применяем.
        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
        placeholder="Найти метку"
        aria-label="Найти метку"
      />
      <div className="tag-pick-list" role="group" aria-label="Метки">
        {visible.map((tag) => (
          <label className="tag-pick-row" key={tag.id}>
            <input type="checkbox" checked={selected.includes(tag.id)} onChange={() => toggle(tag.id)} />
            <span>{tag.name}</span>
          </label>
        ))}
        {visible.length === 0 && <span className="tag-pick-empty">Такой метки нет</span>}
      </div>
    </div>
  );
}
