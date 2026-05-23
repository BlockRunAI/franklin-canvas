import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { listSessions } from '../api/franklin';

export default function SessionsView() {
  const [items, setItems] = useState<Session[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listSessions()
      .then(setItems)
      .catch((e: Error) => setErr(e.message));
  }, []);

  if (err) {
    return (
      <div className="view">
        <h2>Sessions</h2>
        <p className="error">Could not reach daemon: {err}</p>
      </div>
    );
  }

  if (!items) return <div className="view"><p>Loading…</p></div>;

  return (
    <div className="view">
      <h2>Sessions ({items.length})</h2>
      <table className="table">
        <thead>
          <tr><th>Title</th><th>Model</th><th>Messages</th><th>Updated</th></tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id}>
              <td>{s.title}</td>
              <td>{s.model}</td>
              <td>{s.messageCount}</td>
              <td>{new Date(s.updatedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
