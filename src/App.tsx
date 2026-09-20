import React from 'react';
import { SettingsProvider } from './context/SettingsContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { SessionProvider } from './context/SessionContext';
import { HeaderBar } from './components/Header/HeaderBar';
import { SftpSidebar } from './components/SFTP/SftpSidebar';
import { MainWorkspace } from './components/MainView/MainWorkspace';
import { StatusBar } from './components/StatusBar/StatusBar';
import { HostManagerModal } from './components/Modals/HostManagerModal';
import { SettingsModal } from './components/Modals/SettingsModal';
import { SnippetModal } from './components/Modals/SnippetModal';
import { DangerConfirmModal } from './components/Modals/DangerConfirmModal';

const AppContent: React.FC = () => {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-orca-bg text-orca-text select-none">
      {/* Top Header Bar (36px) */}
      <HeaderBar />

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
  return (
    <SettingsProvider>
      <WebSocketProvider>
        <SessionProvider>
          <AppContent />
        </SessionProvider>
      </WebSocketProvider>
    </SettingsProvider>
  );
};

export default App;
