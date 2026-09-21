import Link from "next/link";
import { ExternalLink, PhoneIncoming, PhoneOutgoing, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  CALLS_SELECT,
  callPhone,
  displayName,
  type CallDbRow,
  type CallTranscriptRow,
} from "@/lib/calls/types";
import { hydrateCalls } from "@/lib/calls/server";
import { CallPlayer } from "./call-player";
import { CallTabs } from "./call-tabs";
import { CallNoteForm } from "./call-note-form";
import { CallbackButton } from "./callback-button";
import styles from "./calls.module.css";

// Правая панель звонка: грузится отдельным запросом, чтобы при переключении
// строки список не исчезал, а панель показывала скелетон (образец — inbox).
export async function CallPanel({ callId }: { callId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calls")
    .select(CALLS_SELECT)
    .eq("id", callId)
    .maybeSingle();
  if (error || !data)
    return (
      <aside className={styles.panel} aria-label="Звонок">
        <div className={styles.panelEmpty}>
          <p>{error ? "Не удалось открыть звонок" : "Звонок не найден или недоступен"}</p>
        </div>
      </aside>
    );

  const [call] = await hydrateCalls(supabase, [data as unknown as CallDbRow]);
  const { data: transcriptData } = await supabase
    .from("call_transcripts")
    .select("*")
    .eq("call_id", callId)
    .maybeSingle();
  const transcript = (transcriptData ?? null) as CallTranscriptRow | null;
  const phone = callPhone(call);
  const name = displayName(call, phone) ?? phone;
  const DirectionIcon = call.direction === "in" ? PhoneIncoming : PhoneOutgoing;

  return (
    <aside className={styles.panel} aria-label="Звонок">
      <div className={styles.panelHead}>
        <DirectionIcon size={16} aria-hidden="true" />
        <span className={styles.panelWho}>
          <span className={styles.n}>{name}</span>
          {name !== phone && <span className={styles.s}>{phone}</span>}
        </span>
        <CallbackButton callId={call.id} />
        {call.deal ? (
          <Link className={styles.iconBtn} href={`/deals/${call.deal.id}`} title="Открыть сделку" aria-label="Открыть сделку">
            <ExternalLink size={15} aria-hidden="true" />
          </Link>
        ) : null}
        <Link className={styles.iconBtn} href="/calls" title="Закрыть" aria-label="Закрыть">
          <X size={15} aria-hidden="true" />
        </Link>
      </div>
      <div className={styles.panelBody}>
        <CallPlayer key={call.id} callId={call.id} durationSec={call.duration_sec ?? 0} />
        <CallTabs call={call} transcript={transcript} />
      </div>
      <CallNoteForm
        callId={call.id}
        initialNote={call.note}
        author={call.note_author?.full_name ?? null}
        noteAt={call.note_at}
      />
    </aside>
  );
}

export function PanelSkeleton() {
  return (
    <aside className={styles.panel} aria-label="Звонок загружается">
      <div className={styles.panelHead}>
        <span className="sk" style={{ width: 16, height: 16 }} />
        <span className="sk" style={{ width: 140, height: 14 }} />
      </div>
      <div className={styles.panelBody}>
        <span className="sk" style={{ width: 32, height: 32, borderRadius: "50%" }} />
        <span className="sk" style={{ width: "100%", height: 28 }} />
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="sk" style={{ width: i % 2 ? "82%" : "64%", height: 12 }} />
        ))}
      </div>
    </aside>
  );
}
