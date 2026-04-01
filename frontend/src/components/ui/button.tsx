import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/cn';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: 'default' | 'secondary' | 'ghost' | 'destructive';
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, asChild, variant = 'default', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    return (
      <Comp
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-full border px-4 py-2.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-60',
          variant === 'default' &&
            'border-primary/40 bg-primary text-primary-foreground shadow-soft hover:brightness-110',
          variant === 'secondary' &&
            'border-accent/25 bg-accent text-accent-foreground shadow-soft hover:brightness-105',
          variant === 'ghost' &&
            'border-transparent bg-transparent text-foreground hover:border-border/70 hover:bg-muted/60',
          variant === 'destructive' &&
            'border-destructive/40 bg-destructive text-destructive-foreground shadow-soft',
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
