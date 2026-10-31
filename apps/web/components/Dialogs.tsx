'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Profile } from '@sidekick/shared';
import { api, savePasscode } from '../lib/api';

export function ProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: (profile: Profile) => void;
}) {
  const [form, setForm] = useState(profile);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      onSaved(await api.saveProfile(form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save');
    }
  }

  const field = (key: keyof Profile, label: string, placeholder: string) => (
    <label className="field">
      <span>{label}</span>
      <input
        value={form[key]}
        placeholder={placeholder}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
      />
    </label>
  );

  return (
    <div className="overlay">
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title" onSubmit={submit}>
        <h2 id="profile-title">Tell Sidekick about you</h2>
        <p className="muted">All optional. It helps with quotes, reminders, and everyday admin.</p>
        {field('name', 'Your name or business', 'Mwila Tailoring')}
        {field('work', 'What you do', 'School uniforms and alterations')}
        {field('currency', 'Currency', 'ZMW')}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row end">
          <button type="button" className="ghost" onClick={onClose}>Skip</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
    </div>
  );
}

export function PasscodeGate({ onDone }: { onDone: () => void }) {
  const [passcode, setPasscode] = useState('');
  return (
    <div className="overlay">
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          savePasscode(passcode);
          onDone();
        }}
      >
        <h2>Enter the demo passcode</h2>
        <label className="field">
          <span>Passcode</span>
          <input type="password" value={passcode} autoFocus onChange={(event) => setPasscode(event.target.value)} />
        </label>
        <div className="row end">
          <button type="submit" className="primary">Continue</button>
        </div>
      </form>
    </div>
  );
}
