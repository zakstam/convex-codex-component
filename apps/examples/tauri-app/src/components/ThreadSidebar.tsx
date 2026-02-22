import { ThreadItem } from "./ThreadItem";

type Thread = {
  conversationId: string;
  status: string;
  preview: string;
  messageCount?: number;
  updatedAt?: number;
  scope?: "persisted" | "local_unsynced";
};

type Props = {
  threads: Thread[];
  selected: string;
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => void;
  disabled: boolean;
  showLocalThreads: boolean;
  onToggleShowLocalThreads: (next: boolean) => void;
};

type TimeGroup = "Today" | "Yesterday" | "Older";

function getTimeGroup(updatedAt?: number): TimeGroup {
  if (!updatedAt) return "Older";
  const now = new Date();
  const date = new Date(updatedAt);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  if (updatedAt >= todayStart) return "Today";
  if (updatedAt >= yesterdayStart) return "Yesterday";
  return "Older";
}

function groupThreads(threads: Thread[]): Map<TimeGroup, Thread[]> {
  const groups = new Map<TimeGroup, Thread[]>();
  const order: TimeGroup[] = ["Today", "Yesterday", "Older"];
  for (const key of order) groups.set(key, []);
  for (const thread of threads) {
    const group = getTimeGroup(thread.updatedAt);
    groups.get(group)!.push(thread);
  }
  return groups;
}

export function ThreadSidebar({
  threads,
  selected,
  onSelect,
  onDelete,
  disabled,
  showLocalThreads,
  onToggleShowLocalThreads,
}: Props) {
  const persistedThreads = threads.filter((t) => t.scope !== "local_unsynced");
  const localThreads = threads.filter((t) => t.scope === "local_unsynced");
  const grouped = groupThreads(persistedThreads);

  return (
    <div className="thread-sidebar-content">
      <button
        className="thread-sidebar-new secondary"
        onClick={() => onSelect("")}
        disabled={disabled}
        type="button"
      >
        + New Chat
      </button>

      <div className="thread-sidebar-scroll">
        {(["Today", "Yesterday", "Older"] as TimeGroup[]).map((label) => {
          const group = grouped.get(label)!;
          if (group.length === 0) return null;
          return (
            <div className="thread-sidebar-group" key={label}>
              <p className="thread-sidebar-group-label">{label}</p>
              <div className="thread-sidebar-list">
                {group.map((thread) => (
                  <ThreadItem
                    key={thread.conversationId}
                    conversationId={thread.conversationId}
                    preview={thread.preview}
                    status={thread.status}
                    scope="persisted"
                    updatedAt={thread.updatedAt}
                    messageCount={thread.messageCount}
                    active={thread.conversationId === selected}
                    onClick={() => onSelect(thread.conversationId)}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {showLocalThreads && localThreads.length > 0 && (
          <div className="thread-sidebar-group">
            <p className="thread-sidebar-group-label">Local</p>
            <div className="thread-sidebar-list">
              {localThreads.map((thread) => (
                <ThreadItem
                  key={thread.conversationId}
                  conversationId={thread.conversationId}
                  preview={thread.preview}
                  status={thread.status}
                  scope="local_unsynced"
                  updatedAt={thread.updatedAt}
                  messageCount={thread.messageCount}
                  active={thread.conversationId === selected}
                  onClick={() => onSelect(thread.conversationId)}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="thread-sidebar-footer">
        <label className="thread-sidebar-local-toggle">
          <input
            type="checkbox"
            checked={showLocalThreads}
            onChange={(e) => onToggleShowLocalThreads(e.target.checked)}
          />
          <span>Show local threads</span>
        </label>
      </div>
    </div>
  );
}
