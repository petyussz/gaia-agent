import { useState } from 'react';

import { login } from '../api.ts';

interface GateProps {
  readonly onAuthenticated: () => void;
}

export function Gate({ onAuthenticated }: GateProps): React.ReactElement {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="gate">
      <form
        className="gate-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await login(token);
            onAuthenticated();
          } catch {
            // Deliberately not "wrong token" vs "no such token" — there is only one secret, and
            // distinguishing the cases would only help someone guessing.
            setError('rejected');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="gate-title">G.A.I.A 0.1</div>
        <label className="gate-label" htmlFor="gate-token">
          access token
        </label>
        <input
          id="gate-token"
          className="gate-input"
          type="password"
          value={token}
          autoFocus
          autoComplete="off"
          onChange={(event) => setToken(event.target.value)}
        />
        <button type="submit" className="gate-submit" disabled={busy || token === ''}>
          {busy ? 'checking' : 'connect'}
        </button>
        {error ? <div className="gate-error">{error}</div> : null}
      </form>
    </div>
  );
}
