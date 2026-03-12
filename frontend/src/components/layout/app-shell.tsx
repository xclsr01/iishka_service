import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-8 pt-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(217,136,58,0.18),transparent_35%),linear-gradient(180deg,rgba(255,255,255,0.3),transparent_30%)]" />
        <main className={cn('relative z-10 flex flex-1 flex-col gap-4', className)}>{children}</main>
      </div>
    </div>
  );
}
