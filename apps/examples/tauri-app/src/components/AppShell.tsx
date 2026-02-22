import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  sidebar: ReactNode;
  sidebarOpen: boolean;
  drawer: ReactNode;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  children: ReactNode;
};

export function AppShell({
  header,
  sidebar,
  sidebarOpen,
  drawer,
  drawerOpen,
  onCloseDrawer,
  children,
}: Props) {
  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-open" : ""}`} role="main">
      {header}
      <div className="app-shell-body">
        <aside
          className={`thread-sidebar ${sidebarOpen ? "open" : ""}`}
          aria-label="Thread navigation"
        >
          {sidebar}
        </aside>
        <section className="chat-main">
          {children}
        </section>
      </div>

      {drawerOpen && (
        <div
          className="drawer-backdrop"
          onClick={onCloseDrawer}
          aria-hidden="true"
        />
      )}
      <aside
        className={`settings-drawer ${drawerOpen ? "open" : ""}`}
        aria-label="Settings"
      >
        {drawer}
      </aside>
    </div>
  );
}
