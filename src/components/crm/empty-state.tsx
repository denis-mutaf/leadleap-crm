import type { ReactNode } from "react";

/**
 * Пустое состояние: что здесь бывает, почему пусто сейчас и что сделать.
 * Голый белый прямоугольник запрещён контрактом (docs/ux-contract.md).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <span className="empty-icon">{icon}</span>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/** Короткий вариант внутри уже озаглавленного блока. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="empty-inline">{children}</p>;
}
