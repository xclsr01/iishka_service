/// <reference types="vite/client" />

type TelegramWebAppUser = {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  colorScheme?: 'light' | 'dark';
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
  };
};

interface Window {
  Telegram?: {
    WebApp?: TelegramWebApp;
  };
}
