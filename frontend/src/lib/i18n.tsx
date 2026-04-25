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
    neuralAccess: 'Нейро Доступ',
    heroTitle: 'Одна подписка, много ИИ!',
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
    aiCatalog: 'Каталог ИИ',
    scroll: 'Листать',
    unavailable: 'Недоступно',
    fileUploadsEnabled: 'Загрузка файлов включена',
    imageJobsEnabled: 'Генерация изображений',
    videoJobsEnabled: 'Генерация видео',
    openStudio: 'Открыть студию',
    imageStudio: 'Image Studio',
    createImage: 'Создать изображение',
    imageStudioHint: 'Опишите картинку, стиль, настроение и детали. Nano Banana запустит генерацию как фоновую задачу.',
    imageCost: '10 токенов',
    imagePromptPlaceholder: 'Например: киберпанк-банан маскот, неоновый свет, премиальный UI-стиль...',
    generateImage: 'Сгенерировать',
    generatingImage: 'Генерация...',
    newImage: 'Новая картинка',
    jobStatus: 'Статус задачи',
    jobStatusQUEUED: 'В очереди',
    jobStatusRUNNING: 'Генерируется',
    jobStatusCOMPLETED: 'Готово',
    jobStatusFAILED: 'Ошибка',
    jobStatusCANCELED: 'Отменено',
    imageGenerationFailed: 'Не удалось сгенерировать изображение',
    generatedImages: 'Готовые изображения',
    downloadImage: 'Скачать',
    openImage: 'Открыть',
    refreshImage: 'Обновить',
    refreshingImage: 'Обновляем...',
    deleteImage: 'Удалить',
    deletingImage: 'Удаляем...',
    deleteImageFailed: 'Не удалось удалить карточку',
    confirmDeleteImageTitle: 'Удалить карточку?',
    confirmDeleteImageBody: 'Карточка, промпт и результат будут удалены из истории без возможности восстановления.',
    cancel: 'Нет',
    confirm: 'Да',
    preparingDownload: 'Готовим файл...',
    openingImage: 'Открываем...',
    imageDownloadStarted: 'Загрузка началась.',
    imageOpenedForSaving: 'Изображение открыто. Сохраните его через меню устройства.',
    imageOpened: 'Изображение открыто.',
    imageDownloadFailed: 'Не удалось подготовить загрузку',
    imageOpenFailed: 'Не удалось открыть изображение',
    videoGeneration: 'Видео',
    videoGenerationInProgress: 'Видео генерируется. Карточка обновится автоматически.',
    videoGenerationFailed: 'Не удалось сгенерировать видео',
    videoLoadFailed: 'Не удалось загрузить видео',
    openVideo: 'Открыть видео',
    downloadVideo: 'Скачать видео',
    downloadVideoTitle: 'Куда сохранить?',
    downloadVideoHint: 'Для галереи откройте видео и сохраните через меню телефона. Для файлов используйте системную загрузку.',
    saveVideoToGallery: 'В галерею',
    saveVideoToFiles: 'В файлы',
    retryVideo: 'Повторить',
    retryingVideo: 'Повторяем...',
    retryVideoFailed: 'Не удалось повторить генерацию видео',
    deleteVideo: 'Удалить',
    deletingVideo: 'Удаляем...',
    deleteVideoFailed: 'Не удалось удалить видео',
    confirmDeleteVideoBody: 'Видео и связанный промпт будут удалены из истории без возможности восстановления.',
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
    loading: 'Загрузка...',
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
    heroTitle: 'One subscription, many AI!',
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
    imageJobsEnabled: 'Image jobs enabled',
    videoJobsEnabled: 'Video jobs enabled',
    openStudio: 'Open studio',
    imageStudio: 'Image Studio',
    createImage: 'Create image',
    imageStudioHint: 'Describe the image, style, mood, and details. Nano Banana will run it as a background job.',
    imageCost: '10 tokens',
    imagePromptPlaceholder: 'Example: cyberpunk banana mascot, neon light, premium UI style...',
    generateImage: 'Generate',
    generatingImage: 'Generating...',
    newImage: 'New image',
    jobStatus: 'Job status',
    jobStatusQUEUED: 'Queued',
    jobStatusRUNNING: 'Generating',
    jobStatusCOMPLETED: 'Completed',
    jobStatusFAILED: 'Failed',
    jobStatusCANCELED: 'Canceled',
    imageGenerationFailed: 'Image generation failed',
    generatedImages: 'Generated images',
    downloadImage: 'Download',
    openImage: 'Open',
    refreshImage: 'Refresh',
    refreshingImage: 'Refreshing...',
    deleteImage: 'Delete',
    deletingImage: 'Deleting...',
    deleteImageFailed: 'Failed to delete the card',
    confirmDeleteImageTitle: 'Delete this card?',
    confirmDeleteImageBody: 'The card, prompt, and result will be removed from history and cannot be restored.',
    cancel: 'No',
    confirm: 'Yes',
    preparingDownload: 'Preparing...',
    openingImage: 'Opening...',
    imageDownloadStarted: 'Download started.',
    imageOpenedForSaving: 'Image opened. Save it from your device menu.',
    imageOpened: 'Image opened.',
    imageDownloadFailed: 'Download failed',
    imageOpenFailed: 'Open failed',
    videoGeneration: 'Video',
    videoGenerationInProgress: 'Video is generating. This card will update automatically.',
    videoGenerationFailed: 'Video generation failed',
    videoLoadFailed: 'Video failed to load',
    openVideo: 'Open video',
    downloadVideo: 'Download video',
    downloadVideoTitle: 'Save video',
    downloadVideoHint: 'For Photos/Gallery, open the video and save from the phone menu. For Files, use the system download.',
    saveVideoToGallery: 'To Photos',
    saveVideoToFiles: 'To Files',
    retryVideo: 'Retry',
    retryingVideo: 'Retrying...',
    retryVideoFailed: 'Failed to retry video generation',
    deleteVideo: 'Delete',
    deletingVideo: 'Deleting...',
    deleteVideoFailed: 'Failed to delete the video',
    confirmDeleteVideoBody: 'The video and its linked prompt will be removed from history and cannot be restored.',
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
    loading: 'Loading...',
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
  NANO_BANANA: {
    summary: {
      ru: 'Google-модель для быстрой генерации и редактирования изображений.',
      en: 'Google image model for fast generation and visual editing workflows.',
    },
    description: {
      ru: 'Nano Banana использует Gemini Image для создания картинок по промпту и будущих сценариев редактирования изображений.',
      en: 'Nano Banana uses Gemini image generation for prompt-based image creation and future image editing flows.',
    },
  },
  VEO: {
    summary: {
      ru: 'Google-модель для быстрой генерации коротких видео по промпту.',
      en: 'Google video model for fast short-form prompt-based generation.',
    },
    description: {
      ru: 'Veo использует Gemini API для асинхронной генерации коротких видео с сохранением результата прямо в истории чата.',
      en: 'Veo uses the Gemini API for async short video generation with the result saved directly into chat history.',
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
