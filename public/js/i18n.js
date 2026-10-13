// public/js/i18n.js
// Internationalization and Accessibility Controller for Baari (UI-UX.md sections 2.2, 6, 7)

const I18n = {
  currentLang: 'en',
  translations: {},
  cache: {},

  /**
   * Translate a key with optional dynamic placeholder replacements
   * e.g. t('state_almost', { count: 3 })
   */
  t(key, params = {}) {
    let str = (this.translations && this.translations[key]) || key;
    if (typeof str === 'string' && params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      }
    }
    return str;
  },

  /**
   * Load translation strings from /locales/{lang}.json
   */
  async loadLocale(lang) {
    if (this.cache[lang]) {
      this.translations = this.cache[lang];
      return this.translations;
    }

    try {
      const res = await fetch(`/locales/${lang}.json`);
      if (!res.ok) throw new Error(`Could not load /locales/${lang}.json`);
      const data = await res.json();
      this.cache[lang] = data;
      this.translations = data;
      return data;
    } catch (err) {
      console.warn(`Failed to load locale '${lang}':`, err.message);
      return {};
    }
  },

  /**
   * Set active language, update document direction and DOM elements
   */
  async setLang(lang) {
    if (!['en', 'ur', 'sd'].includes(lang)) {
      lang = 'en';
    }

    this.currentLang = lang;
    localStorage.setItem('baari_lang', lang);

    // Set lang and text direction on <html>
    const isRtl = lang === 'ur' || lang === 'sd';
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';

    await this.loadLocale(lang);
    this.updateDOM();

    // Update active state of language buttons
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      const btnLang = (btn.dataset && btn.dataset.lang) || btn.getAttribute('data-lang');
      if (btnLang === lang) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
    });

    // Notify components of language change
    window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang, isRtl } }));
    return lang;
  },

  /**
   * Update every element in the DOM with data-i18n attributes
   */
  updateDOM(root = document) {
    // 1. Text content
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = this.t(key);
      }
    });

    // 2. Placeholder attribute
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.placeholder = this.t(key);
      }
    });

    // 3. Title / aria-label attribute
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.title = this.t(key);
      }
    });

    root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) {
        el.setAttribute('aria-label', this.t(key));
      }
    });
  },

  /**
   * Toggle Large Text (A+, base font 20px)
   */
  toggleLargeText(enable) {
    const isLarge = enable !== undefined
      ? enable
      : !document.documentElement.classList.contains('large-text');

    document.documentElement.classList.toggle('large-text', isLarge);
    localStorage.setItem('baari_large_text', isLarge ? '1' : '0');

    const toggleBtn = document.getElementById('largeTextToggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isLarge);
      toggleBtn.setAttribute('aria-pressed', isLarge ? 'true' : 'false');
    }
    return isLarge;
  },

  /**
   * Toggle High Contrast mode
   */
  toggleHighContrast(enable) {
    const isHc = enable !== undefined
      ? enable
      : !document.documentElement.classList.contains('high-contrast');

    document.documentElement.classList.toggle('high-contrast', isHc);
    localStorage.setItem('baari_high_contrast', isHc ? '1' : '0');

    const toggleBtn = document.getElementById('highContrastToggle');
    if (toggleBtn) {
      toggleBtn.classList.toggle('active', isHc);
      toggleBtn.setAttribute('aria-pressed', isHc ? 'true' : 'false');
    }
    return isHc;
  },

  /**
   * Initialize language and accessibility features
   */
  async init() {
    // 1. Accessibility preferences
    const savedLargeText = localStorage.getItem('baari_large_text') === '1';
    if (savedLargeText) this.toggleLargeText(true);

    const savedHighContrast = localStorage.getItem('baari_high_contrast') === '1';
    if (savedHighContrast) this.toggleHighContrast(true);

    // 2. Language selection
    const savedLang = localStorage.getItem('baari_lang') || 'en';
    await this.setLang(savedLang);

    // 3. Bind language buttons in the DOM
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetLang = (btn.dataset && btn.dataset.lang) || btn.getAttribute('data-lang');
        if (targetLang) this.setLang(targetLang);
      });
    });

    // 4. Bind accessibility toggle buttons if present
    const largeBtn = document.getElementById('largeTextToggle');
    if (largeBtn) {
      largeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleLargeText();
      });
    }

    const contrastBtn = document.getElementById('highContrastToggle');
    if (contrastBtn) {
      contrastBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.toggleHighContrast();
      });
    }
  }
};

// Global shorthand helper
window.t = (key, params) => I18n.t(key, params);
window.I18n = I18n;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => I18n.init());
} else {
  I18n.init();
}
