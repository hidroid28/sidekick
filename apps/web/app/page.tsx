'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ConversationSummary, Profile } from '@sidekick/shared';
import { Chat } from '../components/Chat';
import { DocumentsPanel, LibraryPanel, RecordsPanel } from '../components/Panels';
import { PasscodeGate, ProfileDialog } from '../components/Dialogs';
import { api, ApiError } from '../lib/api';

type View = 'chat' | 'records' | 'documents' | 'library';

const VIEWS: { id: View; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'records', label: 'Records' },
  { id: 'documents', label: 'Documents' },
  { id: 'library', label: 'Skills & rules' },
];

const EMPTY_PROFILE: Profile = { name: '', work: '', currency: '' };

export default function Home() {
  const [view, setView] = useState<View>('chat');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [showProfile, setShowProfile] = useState(false);
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [error, setError] = useState('');

  const refreshConversations = useCallback(async () => {
    setConversations(await api.conversations());
  }, []);

  const load = useCallback(async () => {
    try {
      setError('');
      setNeedsPasscode(false);
      const loaded = await api.profile();
      setProfile(loaded);
      setShowProfile(!loaded.name && !loaded.work && !loaded.currency);
      await refreshConversations();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setNeedsPasscode(true);
      else setError(cause instanceof Error ? cause.message : 'Something went wrong');
    }
  }, [refreshConversations]);

  useEffect(() => {
    void load();
  }, [load]);

  if (needsPasscode) return <PasscodeGate onDone={() => void load()} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">S</span>
          <span>Sidekick</span>
        </div>
        <nav aria-label="Sections" className="nav">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? 'nav-item active' : 'nav-item'}
              aria-current={view === item.id ? 'page' : undefined}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="history">
          <button
            className="new-chat"
            onClick={() => {
              setActiveId(undefined);
              setView('chat');
            }}
          >
            New chat
          </button>
          <ul>
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  className={c.id === activeId ? 'history-item active' : 'history-item'}
                  onClick={() => {
                    setActiveId(c.id);
                    setView('chat');
                  }}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <button className="profile-button" onClick={() => setShowProfile(true)}>
          {profile.name || 'Set up your profile'}
        </button>
      </aside>

      <main className="main">
        {error && <p className="banner" role="alert">{error}</p>}
        {view === 'chat' && (
          <Chat
            conversationId={activeId}
            onConversation={setActiveId}
            onChanged={() => void refreshConversations()}
          />
        )}
        {view === 'records' && <RecordsPanel />}
        {view === 'documents' && <DocumentsPanel />}
        {view === 'library' && <LibraryPanel />}
      </main>

      {showProfile && (
        <ProfileDialog
          profile={profile}
          onClose={() => setShowProfile(false)}
          onSaved={(saved) => {
            setProfile(saved);
            setShowProfile(false);
          }}
        />
      )}
    </div>
  );
}
