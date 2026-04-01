import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(191 58% 28%)',
        input: 'hsl(191 58% 28%)',
        ring: 'hsl(186 100% 63%)',
        background: 'hsl(235 33% 8%)',
        foreground: 'hsl(195 38% 92%)',
        muted: 'hsl(236 24% 16%)',
        'muted-foreground': 'hsl(193 20% 70%)',
        accent: 'hsl(39 100% 62%)',
        'accent-foreground': 'hsl(234 30% 10%)',
        card: 'hsla(235 28% 14% / 0.84)',
        'card-foreground': 'hsl(195 38% 92%)',
        primary: 'hsl(186 100% 54%)',
        'primary-foreground': 'hsl(233 38% 10%)',
        secondary: 'hsl(263 84% 66%)',
        'secondary-foreground': 'hsl(233 38% 10%)',
        destructive: 'hsl(355 95% 66%)',
        'destructive-foreground': 'hsl(0 0% 100%)',
      },
      borderRadius: {
        lg: '1.125rem',
        md: '0.875rem',
        sm: '0.625rem',
      },
      boxShadow: {
        soft: '0 18px 48px rgba(5, 12, 28, 0.46), 0 0 0 1px rgba(87, 225, 255, 0.08)',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        grain:
          'radial-gradient(circle at 1px 1px, rgba(125, 229, 255, 0.08) 1px, transparent 0)',
      },
    },
  },
  plugins: [],
};

export default config;
