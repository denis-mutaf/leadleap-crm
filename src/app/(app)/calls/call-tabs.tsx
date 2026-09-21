"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Loader2, Search } from "lucide-react";
import type { CallRow, CallTranscriptRow } from "@/lib/calls/types";
import { RESULT_LABEL, callResult, formatCallDate, formatDuration, formatWait, callPhone, callWaitSec } from "@/lib/calls/types";
import { TranscribeButton } from "./transcribe-button";
import styles from "./calls.module.css";

type Tab = "transcript" | "about" | "links";

// Вкладка транскрипта: при диаризации mai-transcribe-2 — компактный чат
// по segments, без приписывания личностей (модель их не знает);
// без сегментов — прежний цельный текст.
export function CallTabs({ call, transcript }: { call: CallRow; transcript: CallTranscriptRow | null }) {
  const [tab, setTab] = useState<Tab>("transcript");
  const result = callResult(call);
  const phone = callPhone(call);
  const line = call.direction === "out" ? call.from_phone : call.to_phone;

  return (
    <div className={styles.tabsWrap}>
      <div className={styles.tabs} role="tablist" aria-label="Разделы звонка">
        {(
          [
            ["transcript", "Транскрипт"],
            ["about", "О звонке"],
            ["links", "Связи"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? styles.tabOn : styles.tab}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transcript" && (
        <section aria-label="Транскрипт">
          {transcript?.status === "completed" && transcript.transcript ? (
            <>
              <TranscriptBody transcript={transcript} />
              <p className={styles.transcriptMeta}>
                {[transcript.model, transcript.completed_at ? formatTranscriptDate(transcript.completed_at) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          ) : transcript?.status === "processing" || transcript?.status === "pending" ? (
            <div className={styles.transcriptEmpty} role="status">
              <Loader2 size={24} aria-hidden="true" className={styles.spin} />
              <strong>Расшифровка идёт</strong>
              <p>Текст появится на этой вкладке через минуту-другую</p>
            </div>
          ) : (
            <div className={styles.transcriptEmpty}>
              <FileText size={24} aria-hidden="true" />
              <strong>Расшифровки пока нет</strong>
              <p>
                {transcript?.status === "failed" && transcript.error
                  ? transcript.error
                  : "Разговор можно прослушать выше — нажмите кнопку, чтобы получить текст"}
              </p>
              <TranscribeButton
                callId={call.id}
                label={transcript?.status === "failed" ? "Попробовать снова" : "Расшифровать"}
              />
            </div>
          )}
        </section>
      )}

      {tab === "about" && (
        <section aria-label="О звонке" className={styles.fields}>
          <Field k="Дата и время" v={formatCallDate(call.started_at)} mono />
          <Field k="Направление" v={call.direction === "in" ? "Входящий" : "Исходящий"} />
          <Field k="Номер клиента" v={phone} mono />
          <Field k="Номер линии" v={line ?? "—"} mono />
          <Field k="Сотрудник" v={call.employee?.full_name ?? "—"} />
          <Field k="Внутренний номер" v={call.extension ?? "—"} mono />
          <Field k="Ожидание ответа" v={formatWait(callWaitSec(call))} mono />
          <Field k="Длительность" v={formatDuration(call.duration_sec ?? 0)} mono />
          <Field k="Результат" v={RESULT_LABEL[result]} />
          <Field k="Источник записи" v="Moldcell PBX" />
          <Field k="ID звонка" v={call.external_id ?? call.id} mono />
        </section>
      )}

      {tab === "links" && (
        <section aria-label="Связи" className={styles.links}>
          {call.contact ? (
            <Link className={styles.linkRow} href={`/contacts/${call.contact.id}`}>
              <span className={styles.avatar}>{initials(call.contact.full_name)}</span>
              <span className={styles.linkText}>
                {call.contact.full_name} · {phone}
              </span>
            </Link>
          ) : (
            <p className={styles.linksEmpty}>Контакт не привязан</p>
          )}
          {call.deal ? (
            <Link className={styles.linkRow} href={`/deals/${call.deal.id}`}>
              <span className={styles.dealDot} aria-hidden="true" />
              <span className={styles.linkText}>
                {call.deal.title ?? "Сделка"} {call.deal_stage ? `· ${call.deal_stage}` : ""}
              </span>
            </Link>
          ) : (
            <div className={styles.noDeal}>
              <p>Сделки нет</p>
              {call.contact && (
                <Link className={styles.noteAdd} href={`/deals?contact=${call.contact.id}`}>
                  Создать сделку
                </Link>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function TranscriptBody({ transcript }: { transcript: CallTranscriptRow }) {
  const segments = Array.isArray(transcript.segments)
    ? transcript.segments.filter(
        (s) => s && typeof s.text === "string" && s.text.trim() !== "",
      )
    : [];
  if (segments.length === 0) {
    return <p className={styles.transcriptText}>{transcript.transcript}</p>;
  }
  // Номера по первому появлению: «Говорящий 1/2», без менеджер/клиент.
  const order = new Map<string, number>();
  for (const s of segments) {
    if (!order.has(s.speaker)) order.set(s.speaker, order.size + 1);
  }
  return (
    <div className={styles.chat} role="log" aria-label="Расшифровка по говорящим">
      {segments.map((s, i) => {
        const n = order.get(s.speaker) ?? 1;
        const side = n % 2 === 1 ? styles.chatLeft : styles.chatRight;
        return (
          <div key={s.id || i} className={`${styles.chatMsg} ${side}`}>
            <span className={styles.chatHead}>
              Говорящий {n} · {formatMmSs(s.start)}
            </span>
            <span className={styles.chatText}>{s.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatMmSs(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldK}>{k}</span>
      <span className={mono ? styles.fieldVMono : styles.fieldV}>{v}</span>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function formatTranscriptDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function TranscriptSearch() {
  return (
    <span className={styles.fakeSearch}>
      <Search size={14} aria-hidden="true" />
      <span>Найти в разговоре</span>
    </span>
  );
}
