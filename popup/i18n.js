// i18n Module - Shared internationalization for popup, background, and content scripts

const I18n = (() => {
  let messages = {};
  let currentLang = 'en';

  // Map navigator language to our locale codes
  function normalizeLang(lang) {
    if (!lang) return 'en';
    const l = lang.toLowerCase().replace('-', '_');
    if (l.startsWith('zh')) return 'zh_CN';
    return 'en';
  }

  // Fetch locale JSON file
  async function fetchLocale(lang) {
    const url = chrome.runtime.getURL(`locales/${lang}.json`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load locale: ${lang}`);
    return resp.json();
  }

  // Load saved language from storage, fall back to browser language
  async function init() {
    try {
      const result = await chrome.storage.local.get(['language']);
      if (result.language) {
        currentLang = result.language;
      } else {
        currentLang = normalizeLang(navigator.language);
      }
    } catch (e) {
      currentLang = normalizeLang(navigator.language);
    }

    try {
      messages = await fetchLocale(currentLang);
      console.log(`[i18n] Initialized with language: ${currentLang}`);
    } catch (e) {
      console.warn(`[i18n] Failed to load ${currentLang}, falling back to en`, e);
      currentLang = 'en';
      try {
        messages = await fetchLocale('en');
      } catch (e2) {
        console.error('[i18n] Failed to load fallback locale', e2);
        messages = {};
      }
    }
  }

  // Translate a key, optionally replacing {param} placeholders
  function t(key, params) {
    let text = messages[key];
    if (text === undefined) {
      console.warn(`[i18n] Missing translation key: ${key}`);
      return key;
    }
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(`{${k}}`, v);
      }
    }
    return text;
  }

  // Set language, fetch new locale, save to storage
  async function setLang(lang) {
    try {
      messages = await fetchLocale(lang);
      currentLang = lang;
      await chrome.storage.local.set({ language: lang });
      console.log(`[i18n] Language changed to: ${lang}`);
    } catch (e) {
      console.error(`[i18n] Failed to set language: ${lang}`, e);
      throw e;
    }
  }

  // Get current language code
  function getLang() {
    return currentLang;
  }

  return { init, t, setLang, getLang };
})();
