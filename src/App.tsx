import React, { useState, useEffect } from 'react';
import { SettingsProvider } from './context/SettingsContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { SessionProvider } from './context/SessionContext';
import { AgentChatProvider } from './context/AgentChatContext';
import { HeaderBar } from './components/Header/HeaderBar';
import { SftpSidebar } from './components/SFTP/SftpSidebar';
import { MainWorkspace } from './components/MainView/MainWorkspace';
import { StatusBar } from './components/StatusBar/StatusBar';
import { HostManagerModal } from './components/Modals/HostManagerModal';
import { SettingsModal } from './components/Modals/SettingsModal';
import { SnippetModal } from './components/Modals/SnippetModal';
import { DangerConfirmModal } from './components/Modals/DangerConfirmModal';
import { LandingPage } from './components/Landing/LandingPage';

const isStaticDemo =
  typeof window !== 'undefined' && window.location.hostname.includes('github.io');

const AppContent: React.FC<{ onOpenLanding: () => void }> = ({ onOpenLanding }) => {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-orca-bg text-orca-text select-none">
      {/* Top Header Bar (36px) */}
      <HeaderBar onOpenLanding={onOpenLanding} />

      {/* Main 2-Column Ergonomic Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Column 1: Collapsible SFTP File Tree */}
        <SftpSidebar />

        {/* Column 2: Shell & Agent Combined Workspace */}
        <MainWorkspace />
      </div>

      {/* Bottom Status Bar (24px) */}
      <StatusBar />

      {/* Floating Modals */}
      <HostManagerModal />
      <SettingsModal />
      <SnippetModal />
      <DangerConfirmModal />
    </div>
  );
};

export const App: React.FC = () => {
  const getInitialView = (): 'landing' | 'terminal' => {
    if (typeof window === 'undefined') return 'landing';
    if (window.location.hash === '#app') return 'terminal';
    if (window.location.hash === '#intro') return 'landing';
    return isStaticDemo ? 'landing' : 'terminal';
  };

  const [currentView, setCurrentView] = useState<'landing' | 'terminal'>(getInitialView);

  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#app') {
        setCurrentView('terminal');
      } else if (window.location.hash === '#intro') {
        setCurrentView('landing');
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleEnterDemo = () => {
    window.location.hash = '#app';
    setCurrentView('terminal');
  };

  const handleOpenLanding = () => {
    window.location.hash = '#intro';
    setCurrentView('landing');
  };

  if (currentView === 'landing') {
    return <LandingPage onEnterDemo={handleEnterDemo} />;
  }

  return (
    <SettingsProvider>
      <WebSocketProvider>
        <SessionProvider>
          <AgentChatProvider>
            <AppContent onOpenLanding={handleOpenLanding} />
          </AgentChatProvider>
        </SessionProvider>
      </WebSocketProvider>
    </SettingsProvider>
  );
};

export default App;
