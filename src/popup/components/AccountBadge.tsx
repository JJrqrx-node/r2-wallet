interface AccountBadgeProps {
  name: string;
}

export function AccountBadge({ name }: AccountBadgeProps) {
  return (
    <div className="account-badge">
      <span className="account-badge-dot" aria-hidden="true" />
      <span className="account-badge-name">{name}</span>
    </div>
  );
}
