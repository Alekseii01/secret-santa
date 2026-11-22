// UI strings. The language is chosen with LOCALE in .env (en | ru).
// Shared by the browser app, the server and the Vite dev server, so keep it plain JS.

export const LOCALES = {
  en: {
    numberLocale: 'en-US',
    price: (range) => `€${range}`,

    title: 'Secret Santa',
    splashHint: 'Pulling gifts out of the sack…',
    loading: 'Loading…',
    serverDown: "The server isn't responding, please reload the page",
    noConnection: "Can't reach the server, please try again",
    nameTaken: (name) => `Someone has already picked ${name}. Find your own name.`,
    drawFailed: 'Couldn’t reach the server. Press “Draw” again.',
    saveFailed: 'Couldn’t save, please try again',

    whoAreYou: 'Who are you?',
    pickIntro: 'Find your name. First you’ll draw who you’re giving a gift to, then you’ll write what you’d like yourself.',
    alreadyDrew: 'already drew',
    drawingNow: 'drawing…',
    drawnCount: (done, total) => `${done} of ${total} have drawn`,
    browseWishlists: 'Browse wishlists',
    wishlists: 'Wishlists',
    back: '← Back',
    browseNote: 'Anyone can look, even without taking part. Who gives to whom isn’t shown here.',

    areYouSure: (name) => `Are you really ${name}?`,
    confirmNote: 'Right after this you’ll draw who you’re giving to. You can draw only once, and only for yourself.',
    no: 'No',
    yesItsMe: 'Yes, it’s me',
    readyToDraw: (name) => `${name}, ready to draw?`,
    drawIntro: 'Santa will pull out the name of the person you’re giving a gift to. You can only draw once.',
    notMe: 'That’s not me',
    draw: 'Draw',
    santaDigging: 'Santa is rummaging in the sack…',

    youGiveTo: (name) => `${name}, you’re giving a gift to`,
    keepSecret: 'Don’t tell anyone. The result is saved in this browser, so you can come back any time.',
    next: 'Next',

    whatForYou: (name) => `${name}, what would you like?`,
    wishIntro: 'A few ideas for your Santa. You can change the list any time.',
    save: 'Save',
    later: 'Later',
    cancel: 'Cancel',
    edit: 'Edit',
    placeholders: ['For example, warm socks', 'A book, a board game, anything', 'What you definitely don’t want (also useful)'],
    itemTitle: 'Gift name',
    descPlaceholder: 'Description: size, colour, model, any details',
    linkPlaceholder: 'Link to the item, e.g. shop.com/…',
    notALink: 'That doesn’t look like a link. Check the address.',
    addDesc: '+ description',
    removeDesc: '− description',
    addLink: '+ link',
    removeLink: '− link',
    addPhoto: '+ photo',
    removePhoto: 'remove photo',
    deleteItem: 'Remove item',
    addItem: '+ another gift',
    site: 'link',
    openPhoto: 'Open photo',
    untitled: 'Untitled',
    loadingWishlists: 'Loading wishlists',

    you: 'You',
    whoIGiveTo: 'Who I’m giving to',
    whatTheyWant: (name) => `What ${name} wants`,
    yourWishes: 'Your wishes',
    emptyTitle: (name) => `${name} is still thinking`,
    emptyNote: 'Their wishlist will show up here as soon as they add ideas.',
    myEmptyTitle: 'Your wishlist is empty',
    myEmptyNote: 'Add a few ideas to make life easier for your Santa.',
    myEmptyHint: 'Your wishlist is empty. Fill it in under “Wishlists” → “You” to make life easier for your Santa.',
    hide: 'Hide',
    reveal: 'Show who I’m giving to and their wishlist',
    personalLink: 'Personal link to open this on another device. Don’t share it.',
    copyPrompt: 'Copy the link',
    copy: 'Copy',
    copied: 'Copied ✓',
  },

  ru: {
    numberLocale: 'ru-RU',
    price: (range) => `${range} €`,

    title: 'Тайный Санта',
    splashHint: 'Достаём подарки из мешка…',
    loading: 'Загружаю…',
    serverDown: 'Сервер не отвечает, обнови страницу',
    noConnection: 'Нет связи с сервером, попробуй ещё раз',
    nameTaken: (name) => `${name} уже кто-то выбрал. Найди себя.`,
    drawFailed: 'Не получилось связаться с сервером. Нажми «Тянуть» ещё раз.',
    saveFailed: 'Не получилось сохранить, попробуй ещё раз',

    whoAreYou: 'Кто ты?',
    pickIntro: 'Найди своё имя. Сначала вытянешь, кому даришь, потом напишешь, что хочешь получить сам.',
    alreadyDrew: 'уже вытянул(а)',
    drawingNow: 'тянет…',
    drawnCount: (done, total) => `Вытянули ${done} из ${total}`,
    browseWishlists: 'Посмотреть вишлисты',
    wishlists: 'Вишлисты',
    back: '← Назад',
    browseNote: 'Смотреть можно всем, даже без участия. Кто кому дарит, здесь не видно.',

    areYouSure: (name) => `Ты точно ${name}?`,
    confirmNote: 'Сразу после этого вытянешь, кому даришь. Тянуть можно только один раз и только за себя.',
    no: 'Нет',
    yesItsMe: 'Да, это я',
    readyToDraw: (name) => `${name}, тянем?`,
    drawIntro: 'Санта достанет из мешка имя того, кому ты даришь подарок. Тянуть можно один раз.',
    notMe: 'Это не я',
    draw: 'Тянуть',
    santaDigging: 'Санта роется в мешке…',

    youGiveTo: (name) => `${name}, ты даришь подарок`,
    keepSecret: 'Никому не говори. Результат сохранён в этом браузере, можно возвращаться.',
    next: 'Дальше',

    whatForYou: (name) => `${name}, а что подарить тебе?`,
    wishIntro: 'Пара идей для твоего Санты. Поменять список можно в любой момент.',
    save: 'Сохранить',
    later: 'Позже',
    cancel: 'Отмена',
    edit: 'Изменить',
    placeholders: ['Например, тёплые носки', 'Книга, настолка, что угодно', 'Чего точно не надо (тоже полезно)'],
    itemTitle: 'Название подарка',
    descPlaceholder: 'Описание: размер, цвет, модель, любые детали',
    linkPlaceholder: 'Ссылка на товар, например shop.com/…',
    notALink: 'Похоже, это не ссылка. Проверь адрес.',
    addDesc: '+ описание',
    removeDesc: '− описание',
    addLink: '+ ссылка',
    removeLink: '− ссылка',
    addPhoto: '+ фото',
    removePhoto: 'убрать фото',
    deleteItem: 'Удалить пункт',
    addItem: '+ ещё подарок',
    site: 'сайт',
    openPhoto: 'Открыть фото',
    untitled: 'Без названия',
    loadingWishlists: 'Загружаю вишлисты',

    you: 'Ты',
    whoIGiveTo: 'Кому я дарю',
    whatTheyWant: (name) => `Что хочет ${name}`,
    yourWishes: 'Твои пожелания',
    emptyTitle: (name) => `${name} ещё думает`,
    emptyNote: 'Вишлист появится здесь, как только будут идеи.',
    myEmptyTitle: 'Твой вишлист пока пустой',
    myEmptyNote: 'Добавь пару идей, чтобы твоему Санте было проще.',
    myEmptyHint: 'Твой вишлист пока пустой. Заполни его во вкладке «Вишлисты» → «Ты», чтобы твоему Санте было проще.',
    hide: 'Скрыть',
    reveal: 'Показать, кому дарю, и его вишлист',
    personalLink: 'Личная ссылка, чтобы открыть это на другом устройстве. Никому не пересылай.',
    copyPrompt: 'Скопируй ссылку',
    copy: 'Скопировать',
    copied: 'Скопировано ✓',
  },
};

export const DEFAULT_LOCALE = 'en';
export const pickLocale = (code) => (code in LOCALES ? code : DEFAULT_LOCALE);

// index.html is rendered with the chosen language: <html lang>, the tab title and the
// loading splash are translated before any JS runs, and the app reads window.__SANTA_LOCALE__.
export function renderIndexHtml(html, code) {
  const locale = pickLocale(code);
  const t = LOCALES[locale];
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return html
    .replace('%LANG%', locale)
    .replaceAll('%TITLE%', esc(t.title))
    .replace('%SPLASH_HINT%', esc(t.splashHint))
    .replace('<!--santa-config-->', `<script>window.__SANTA_LOCALE__=${JSON.stringify(locale)}</script>`);
}
