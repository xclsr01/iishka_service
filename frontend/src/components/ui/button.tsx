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
          'inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60',
          variant === 'default' && 'bg-primary text-primary-foreground shadow-soft',
          variant === 'secondary' && 'bg-secondary text-secondary-foreground',
          variant === 'ghost' && 'bg-transparent text-foreground',
          variant === 'destructive' && 'bg-destructive text-destructive-foreground',
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = 'Button';
