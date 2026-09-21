"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, Timer } from "lucide-react";
import { formatDuration } from "@/lib/calls/types";
import styles from "./calls.module.css";

type State =
  | { kind: "loading" }
  | { kind: "ready"; url: string; warning: string | null }
  | { kind: "gone"; message: string };

const SPEEDS = [1, 1.5, 2] as const;

// Честный плеер: URL получаем с сервера после проверки прав.
// Своя копия — основной источник; живая ссылка АТС — запасной путь,
// если копии ещё нет. Пустой recording_url у недозвонов — нормальное
// «записи нет»: разговора не было, записывать нечего.
export function CallPlayer({ callId, durationSec }: { callId: string; durationSec: number }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(durationSec);
  const [speed, setSpeed] = useState<number>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Панель пересоздаётся под каждый звонок (Suspense key в page),
  // поэтому начальное состояние loading/current уже верное — эффект
  // только подтягивает URL, синхронных сбросов не нужно.
  useEffect(() => {
    let alive = true;
    fetch(`/api/calls/recording?id=${callId}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          url?: string;
          warning?: string;
          error?: string;
        } | null;
        if (!alive) return;
        if (res.ok && body?.url)
          setState({ kind: "ready", url: body.url, warning: body.warning ?? null });
        else
          setState({
            kind: "gone",
            message:
              body?.error && res.status !== 410
                ? body.error
                : "Записи нет — разговор не был записан",
          });
      })
      .catch(() => {
        if (alive) setState({ kind: "gone", message: "Не удалось загрузить запись" });
      });
    return () => {
      alive = false;
    };
  }, [callId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed, state]);

  if (state.kind === "loading")
    return (
      <div className={styles.playerLoading} aria-label="Запись загружается">
        <span className="sk" style={{ width: 32, height: 32, borderRadius: "50%" }} />
        <span className="sk" style={{ flex: 1, height: 4, borderRadius: 2 }} />
      </div>
    );

  if (state.kind === "gone")
    return (
      <div className={styles.noRec} role="status">
        <Timer size={16} aria-hidden="true" />
        <span>{state.message}</span>
      </div>
    );

  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <section className={styles.player} aria-label="Запись разговора">
      <audio
        ref={audioRef}
        src={state.url}
        preload="metadata"
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(Math.round(d));
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className={styles.playerRow1}>
        <button
          className={styles.play}
          type="button"
          aria-label={playing ? "Пауза" : "Слушать запись"}
          onClick={() => {
            const audio = audioRef.current;
            if (!audio) return;
            if (playing) void audio.pause();
            else void audio.play();
          }}
        >
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <span className={styles.track}>
          <span className={styles.times}>
            <span>{formatDuration(Math.round(current)) === "—" ? "0:00" : formatDuration(Math.round(current))}</span>
            <span className={styles.total}>{formatDuration(total)}</span>
          </span>
          <span
            className={styles.bar}
            role="slider"
            aria-label="Позиция записи"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, Math.round(total))}
            aria-valuenow={Math.round(current)}
            tabIndex={0}
            onClick={(e) => {
              const audio = audioRef.current;
              if (!audio || !total) return;
              const rect = e.currentTarget.getBoundingClientRect();
              audio.currentTime = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) * total;
            }}
            onKeyDown={(e) => {
              const audio = audioRef.current;
              if (!audio) return;
              if (e.key === "ArrowRight") audio.currentTime = Math.min(total, audio.currentTime + 5);
              if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
            }}
          >
            <span className={styles.fill} style={{ width: `${progress}%` }} />
          </span>
        </span>
      </div>
      <div className={styles.playerRow2}>
        <span className={styles.speedSeg} role="group" aria-label="Скорость">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              className={speed === value ? styles.speedOn : ""}
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
            >
              {String(value).replace(".", ",")}×
            </button>
          ))}
        </span>
        <span style={{ flex: 1 }} />
        <a className={styles.iconBtn} href={state.url} download aria-label="Скачать запись" title="Скачать запись">
          <Download size={15} aria-hidden="true" />
        </a>
      </div>
      {state.warning && <p className={styles.recHint}>{state.warning}</p>}
    </section>
  );
}
