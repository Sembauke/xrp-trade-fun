interface WidgetHelpProps {
  title: string;
  children: string;
}

export function WidgetHelp({ title, children }: WidgetHelpProps) {
  return (
    <details className="group rounded-lg border border-white/10 bg-surface-700/30 px-2.5 py-1.5">
      <summary className="cursor-pointer list-none text-[11px] text-slate-400 group-open:text-slate-300">
        Uitleg: {title}
      </summary>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        {children}
      </p>
    </details>
  );
}
