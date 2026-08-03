// セッション横断検索: タイトル/指示/ログを全ワーカーから検索
import { useEffect, useRef, useState } from 'react';
import type { SearchHit } from '../lib/types';
import { STATUS_META } from '../lib/types';
import { api } from '../lib/api';

export function SearchBar({ onSelect }: { onSelect: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .search(q)
        .then((r) => {
          setResults(r.results);
          setOpen(true);
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={boxRef} className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="🔍 ワーカー横断検索"
        className="w-44 rounded-lg border border-edge bg-panel px-2 py-1.5 text-xs focus:w-64 focus:border-accent focus:outline-none"
      />
      {open && q.trim() && (
        <div className="absolute right-0 z-30 mt-2 max-h-96 w-96 overflow-auto rounded-xl border border-edge bg-panel2 shadow-2xl">
          {results.length === 0 && (
            <div className="px-3 py-4 text-center text-xs text-slate-600">一致するワーカーがありません</div>
          )}
          {results.map((r) => {
            const meta = STATUS_META[r.session.status];
            return (
              <button
                key={r.session.id}
                onClick={() => {
                  onSelect(r.session.id);
                  setOpen(false);
                }}
                className="block w-full border-b border-edge/40 px-3 py-2 text-left last:border-0 hover:bg-panel"
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="flex-1 truncate text-xs font-medium">{r.session.title}</span>
                  <span className={`text-[10px] ${meta.color}`}>{meta.label}</span>
                </div>
                {r.hits.slice(0, 3).map((h, i) => (
                  <div key={i} className="mt-0.5 truncate pl-4 text-[10px] text-slate-500">{h}</div>
                ))}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
