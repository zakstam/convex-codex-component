type Props = {
  title: string;
  description?: string;
};

export function EmptyState({ title, description }: Props) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {description && <p className="empty-state-desc">{description}</p>}
    </div>
  );
}
