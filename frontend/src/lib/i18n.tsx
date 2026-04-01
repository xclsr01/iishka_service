import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Provider } from '@/lib/api';

export type Locale = 'ru' | 'en';

const LOCALE_STORAGE_KEY = 'iishka.locale';

type TranslationParams = Record<string, string | number | null | undefined>;
type TranslationValue = string | ((params?: TranslationParams) => string);

const translations: Record<Locale, Record<string, TranslationValue>> = {
  ru: {
    openInTelegram: 'Открыть в Telegram',
    bootstrapFailed: 'Ошибка запуска',
    standaloneBrowserMessage:
      'Приложение уже развернуто, но авторизация для Mini App приходит только из Telegram. Откройте бота, отправьте /start и запустите приложение кнопкой оттуда.',
    retryInTelegram: 'Повторить в Telegram',
    standaloneBrowserHint:
      'Открывать прямой `pages.dev` URL в обычном браузере можно для быстрой проверки, но для входа в приложение нужна подписанная Telegram-сессия.',
    neuralAccess: 'Neural Access',
    heroTitle: 'Одна подписка, три AI-канала.',
    heroWelcome: (params) =>
      `Добро пожаловать${params?.firstName ? `, ${params.firstName}` : ''}. Выбирайте модель, сохраняйте историю и переключайтесь между ассистентами без потери контекста.`,
    subscriptionStatus: 'Статус подписки',
    subscriptionActive: (params) => `Подписка активна: ${params?.planCode}.`,
    subscriptionOutOfTokens:
      'Токены закончились. Обновите подписку, чтобы продолжить переписку.',
    subscriptionInactive: 'Подписка неактивна. Отправка сообщений откроется после активации тарифа.',
    tokensLeft: 'Токенов',
    activating: 'Активация...',
    getSubscription: 'Оформить подписку',
    unsubscribing: 'Отключение...',
    unsubscribe: 'Отписаться',
    aiCatalog: 'Каталог AI',
    scroll: 'Листать',
    unavailable: 'Недоступно',
    fileUploadsEnabled: 'Загрузка файлов включена',
    enterChat: 'Открыть чат',
    back: 'Назад',
    subscriptionRequired: 'Нужна подписка',
    subscriptionRequiredOutOfTokens:
      'У вас закончились токены. Обновите подписку, чтобы продолжить чат.',
    subscriptionRequiredInactive:
      'Файлы можно подготовить заранее, но отправка сообщений заблокирована, пока тариф не активирован.',
    startFirstConversation: (params) => `Начните первый диалог с ${params?.providerName}.`,
    uploadFile: 'Загрузить файл',
    askAnythingAcrossProvider: 'Спросите что угодно у выбранного провайдера...',
    thinking: 'Думаю...',
    loadFailed: 'Не удалось загрузить',
    fileUploadFailed: 'Не удалось загрузить файл',
    messageFailed: 'Не удалось отправить сообщение',
    languageRu: 'RU',
    languageEn: 'EN',
    providerTemporarilyUnavailable: 'Провайдер временно недоступен.',
  },
  en: {
    openInTelegram: 'Open In Telegram',
    bootstrapFailed: 'Bootstrap failed',
    standaloneBrowserMessage:
      'The deployment is up, but authentication for this Mini App comes from Telegram. Open the bot, send /start, and launch the app from the button there.',
    retryInTelegram: 'Retry In Telegram',
    standaloneBrowserHint:
      'Opening the raw `pages.dev` URL in a normal browser is fine for a smoke check, but a signed Telegram session is required to enter the app.',
    neuralAccess: 'Neural Access',
    heroTitle: 'One subscription, three AI channels.',
    heroWelcome: (params) =>
      `Welcome${params?.firstName ? `, ${params.firstName}` : ''}. Pick your model, keep sessions synced, and move between assistants without losing context.`,
    subscriptionStatus: 'Subscription status',
    subscriptionActive: (params) => `Active on ${params?.planCode}.`,
    subscriptionOutOfTokens: 'Out of tokens. Update your subscription to continue messaging.',
    subscriptionInactive: 'Inactive. Messaging is gated until the monthly plan is active.',
    tokensLeft: 'Tokens left',
    activating: 'Activating...',
    getSubscription: 'Get subscription',
    unsubscribing: 'Unsubscribing...',
    unsubscribe: 'Unsubscribe',
    aiCatalog: 'AI catalog',
    scroll: 'Scroll',
    unavailable: 'Unavailable',
    fileUploadsEnabled: 'File uploads enabled',
    enterChat: 'Enter chat',
    back: 'Back',
    subscriptionRequired: 'Subscription required',
    subscriptionRequiredOutOfTokens:
      'You are out of tokens. Update your subscription to continue chatting.',
    subscriptionRequiredInactive:
      'Uploads can still be prepared, but message sending is blocked until the plan is active.',
    startFirstConversation: (params) => `Start the first conversation with ${params?.providerName}.`,
    uploadFile: 'Upload a file',
    askAnythingAcrossProvider: 'Ask anything across your selected provider...',
    thinking: 'Thinking...',
    loadFailed: 'Load failed',
    fileUploadFailed: 'File upload failed',
    messageFailed: 'Message failed',
    languageRu: 'RU',
    languageEn: 'EN',
    providerTemporarilyUnavailable: 'Provider is temporarily unavailable.',
  },
};

const localizedProviders: Record<
  Provider['key'],
  {
    summary: Record<Locale, string>;
    description: Record<Locale, string>;
  }
> = {
  OPENAI: {
    summary: {
      ru: 'Сбалансированный универсальный помощник для текста, кода и повседневных задач.',
      en: 'Balanced generalist for drafting, coding, and everyday problem solving.',
    },
    description: {
      ru: 'Ассистент на базе OpenAI для широких сценариев: рассуждение, помощь с кодом и развитие мультимодальных продуктов.',
      en: 'OpenAI-backed assistant focused on broad general intelligence, coding support, and multimodal product evolution.',
    },
  },
  ANTHROPIC: {
    summary: {
      ru: 'Сильный ассистент для длинных рассуждений и анализа документов.',
      en: 'Strong long-form reasoning and document analysis assistant.',
    },
    description: {
      ru: 'Ассистент на базе Anthropic, оптимизированный для тонкого рассуждения, качественного письма и диалогов с большим контекстом.',
      en: 'Anthropic-backed assistant optimized for nuanced reasoning, writing quality, and large-context conversations.',
    },
  },
  GEMINI: {
    summary: {
      ru: 'Быстрый мультимодальный ассистент для поиска и продуктовых сценариев.',
      en: 'Fast multimodal assistant for search-heavy and product-style workflows.',
    },
    description: {
      ru: 'Ассистент на базе Google с сильными мультимодальными инструментами и практичной скоростью для лёгких чат-сценариев.',
      en: 'Google-backed assistant with strong multimodal tooling and practical speed for lightweight chat experiences.',
    },
  },
};

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: TranslationParams) => string;
  localizeProvider: (provider: Provider) => Provider;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored === 'en' ? 'en' : 'ru';
  });

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  function setLocale(nextLocale: Locale) {
    setLocaleState(nextLocale);
  }

  function t(key: string, params?: TranslationParams) {
    const value = translations[locale][key];
    if (typeof value === 'function') {
      return value(params);
    }

    return value ?? key;
  }

  function localizeProvider(provider: Provider): Provider {
    const localizedCopy = localizedProviders[provider.key];
    return {
      ...provider,
      summary: localizedCopy?.summary[locale] ?? provider.summary,
      description: localizedCopy?.description[locale] ?? provider.description,
      availabilityMessage:
        provider.isAvailable || !provider.availabilityMessage
          ? provider.availabilityMessage
          : t('providerTemporarilyUnavailable'),
    };
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, localizeProvider }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) {
    throw new Error('useLocale must be used within LocaleProvider');
  }

  return value;
}
