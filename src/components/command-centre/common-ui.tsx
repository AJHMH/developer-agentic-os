import type { LucideIcon } from "lucide-react";

export function ModuleHeading({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="module-heading">
      <div className="heading-left">
        <Icon className="icon-box" aria-hidden="true" size={19} />
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function OutlineButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="outline-button" type="button">
      {children}
    </button>
  );
}
