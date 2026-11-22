import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { t } from './i18n.js';

const TOKEN_KEY = 'santa-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
const DRAFT_KEY = 'santa-draft';
function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}
function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}
function saveToken(t) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {}
}

const api = (path, { token, ...opts } = {}) =>
  fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

export default function App() {
  const mount = useRef(null);
  const scene = useRef(null);
  // loading | pick | browse | draw | drawing | opening | reveal | wishlist | mine
  // Порядок: выбрал имя → сразу тянешь → видишь, кому даришь → заполняешь свой вишлист.
  const [view, setView] = useState('loading');
  const [people, setPeople] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [result, setResult] = useState(null); // { me, recipient, myWishlist, recipientWishlist, token }
  const [error, setError] = useState('');
  const [flight, setFlight] = useState(null);
  const [justDrew, setJustDrew] = useState(false); // сразу после розыгрыша имя не размываем

  // 3D грузится отдельным чанком: заставка из index.html показывает прогресс,
  // а исчезает, когда сцена собрана (или через 15 с, если WebGL не завёлся).
  const [sceneVersion, setSceneVersion] = useState(0);
  useEffect(() => {
    let sc;
    let dead = false;
    const splash = window.__splash;
    const fallback = setTimeout(() => splash?.done(), 15000);
    import('./GiftScene.js')
      .then(({ GiftScene }) => {
        if (dead) return;
        splash?.progress(0.3);
        sc = new GiftScene(mount.current, {
          onProgress: (p) => splash?.progress(0.3 + p * 0.55),
          onReady: () => splash?.done(),
        });
        scene.current = sc;
        setSceneVersion((v) => v + 1);
      })
      .catch(() => splash?.done());
    return () => {
      dead = true;
      clearTimeout(fallback);
      sc?.dispose();
    };
  }, []);

  const loadPeople = useCallback(async () => {
    const r = await fetch('/api/people');
    if (r.ok) setPeople(await r.json());
  }, []);

  // Имена на носках — после загрузки рукописного шрифта.
  // В носке у тех, кто уже вытянул, появляются подарки.
  const sockKey = people.map((p) => `${p.name}:${p.drawn ? 1 : 0}`).join(',');
  useEffect(() => {
    if (!sockKey) return;
    const list = sockKey.split(',').map((x) => {
      const [name, d] = x.split(':');
      return { name, drawn: d === '1' };
    });
    document.fonts.load('800 40px Nunito').finally(() => scene.current?.setStockingNames(list));
  }, [sockKey, sceneVersion]);

  useEffect(() => {
    (async () => {
      const m = location.hash.match(/t=([\w-]+)/);
      if (m) {
        saveToken(m[1]);
        history.replaceState(null, '', location.pathname);
      }
      await loadPeople();
      const token = readToken();
      if (token) {
        const r = await api('/api/me', { token });
        if (r.ok) {
          const data = await r.json();
          setResult({ ...data, token });
          // закрепил имя, но не дотянул (обрыв связи, закрыл вкладку) — предлагаем тянуть
          setView(data.drawn ? 'mine' : 'draw');
          return;
        }
        if (r.status === 401) clearToken();
      }
      setView('pick');
    })().catch(() => setError(t.serverDown));
  }, [loadPeople]);

  useEffect(() => {
    if (view !== 'pick') return;
    const id = setInterval(loadPeople, 4000);
    return () => clearInterval(id);
  }, [view, loadPeople]);

  // Тот, кому даришь, мог дописать вишлист — подтягиваем, пока страница открыта.
  useEffect(() => {
    if (view !== 'mine' || !result?.token) return;
    const id = setInterval(async () => {
      const r = await api('/api/me', { token: result.token });
      if (r.ok) {
        const data = await r.json();
        setResult((prev) => ({ ...prev, recipientWishlist: data.recipientWishlist }));
      }
    }, 15000);
    return () => clearInterval(id);
  }, [view, result?.token]);

  // «Да, это я»: сервер сразу закрепляет имя за этим браузером.
  async function claim(person) {
    setConfirm(null);
    setError('');
    const r = await api('/api/claim', { method: 'POST', body: JSON.stringify({ id: person.id }) }).catch(() => null);
    if (!r?.ok) {
      setError(r?.status === 409 ? t.nameTaken(person.name) : t.noConnection);
      loadPeople();
      return;
    }
    const data = await r.json();
    saveToken(data.token);
    setResult(data);
    await doDraw(data.token);
  }

  async function release() {
    await api('/api/claim', { method: 'DELETE', token: result.token }).catch(() => null);
    clearToken();
    clearDraft();
    setResult(null);
    await loadPeople();
    setView('pick');
  }

  async function doDraw(token) {
    setError('');
    setView('drawing');
    scene.current?.setPhase('shake');
    const [r] = await Promise.all([api('/api/draw', { method: 'POST', token }).catch(() => null), sleep(2400)]);
    if (!r?.ok) {
      // токен на месте — можно просто нажать ещё раз, повтор вернёт тот же результат
      scene.current?.setPhase('idle');
      setError(t.drawFailed);
      setView('draw');
      return;
    }
    const data = await r.json();
    setResult({ ...data, token });
    scene.current?.setPhase('open');
    setView('opening');
    loadPeople();
    // имя вылетает из подарка, потом его HTML-копия перелетает в карточку
    const from = scene.current ? await scene.current.raiseName(data.recipient) : null;
    scene.current?.hideName();
    setFlight(from);
    setView('reveal');
  }

  return (
    <>
      <div className="scene" ref={mount} />
      <main className={`ui view-${view}`}>
        <header className="title">
          <h1>{t.title}</h1>
        </header>

        <div className="stage">
          {view === 'loading' && !error && <p className="note">{t.loading}</p>}

          {view === 'pick' && (
            <section className="card">
              <h2>{t.whoAreYou}</h2>
              <p className="muted">{t.pickIntro}</p>
              <div className="tags">
                {people.map((p) => (
                  <button key={p.id} className="tag" disabled={p.drawn || p.claimed} onClick={() => setConfirm(p)}>
                    {p.name}
                    {p.drawn && <small>{t.alreadyDrew}</small>}
                    {p.claimed && <small>{t.drawingNow}</small>}
                  </button>
                ))}
              </div>
              <p className="muted small">
                {t.drawnCount(people.filter((p) => p.drawn).length, people.length)}
              </p>
              <button className="btn plain wide" onClick={() => setView('browse')}>
                {t.browseWishlists}
              </button>
            </section>
          )}

          {view === 'browse' && (
            <section className="card wide">
              <div className="box-head">
                <h2 className="flat">{t.wishlists}</h2>
                <button className="chip" onClick={() => setView('pick')}>
                  {t.back}
                </button>
              </div>
              <p className="muted small">{t.browseNote}</p>
              <AllWishlists />
            </section>
          )}

          {view === 'draw' && result && (
            <section className="card">
              <h2>{t.readyToDraw(result.me)}</h2>
              <p className="muted">{t.drawIntro}</p>
              <div className="row">
                <button className="btn plain" onClick={release}>
                  {t.notMe}
                </button>
                <button className="btn" onClick={() => doDraw(result.token)}>
                  {t.draw}
                </button>
              </div>
            </section>
          )}

          {view === 'wishlist' && result && (
            <section className="card wide">
              <h2>{t.whatForYou(result.me)}</h2>
              <p className="muted">{t.wishIntro}</p>
              <WishlistForm
                initial={result.myWishlist}
                draftKey={DRAFT_KEY}
                submitLabel={t.save}
                cancelLabel={t.later}
                onSubmit={async (wishlist) => {
                  const r = await api('/api/me/wishlist', { method: 'PUT', token: result.token, body: JSON.stringify({ wishlist }) }).catch(() => null);
                  if (!r?.ok) return setError(t.saveFailed);
                  setError('');
                  clearDraft();
                  setResult({ ...(await r.json()), token: result.token });
                  setView('mine');
                }}
                onCancel={() => setView('mine')}
              />
            </section>
          )}

          {view === 'drawing' && <p className="note">{t.santaDigging}</p>}

          {view === 'reveal' && result && (
            <Reveal
              result={result}
              from={flight}
              onHide={() => {
                setFlight(null);
                setJustDrew(true);
                // свой вишлист ещё пустой — сразу предлагаем его заполнить
                setView(result.myWishlist?.length ? 'mine' : 'wishlist');
              }}
            />
          )}

          {view === 'mine' && result && <Mine result={result} setResult={setResult} startShown={justDrew} />}

          {error && <p className="error">{error}</p>}
        </div>
      </main>

      {confirm && (
        <div className="backdrop" onClick={() => setConfirm(null)}>
          <section className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t.areYouSure(confirm.name)}</h2>
            <p className="muted">{t.confirmNote}</p>
            <div className="row">
              <button className="btn plain" onClick={() => setConfirm(null)}>
                {t.no}
              </button>
              <button className="btn" onClick={() => claim(confirm)}>
                {t.yesItsMe}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

// Карточка раскрывается, а бирка с именем прилетает в неё из 3D-сцены (FLIP).
function Reveal({ result, from, onHide }) {
  const target = useRef(null);
  const flyer = useRef(null);
  const [landed, setLanded] = useState(!from);

  useLayoutEffect(() => {
    if (!from || !flyer.current || !target.current) return;
    const to = target.current.getBoundingClientRect();
    const el = flyer.current;
    Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    const anim = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 60}px) scale(${(sx + 1) / 2}, ${(sy + 1) / 2}) rotate(-4deg)`, offset: 0.55 },
        { transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)' },
      ],
      { duration: 1000, easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' }
    );
    anim.onfinish = () => setLanded(true);
    return () => anim.cancel();
  }, [from]);

  return (
    <>
      <section className={`card unfold ${landed ? 'landed' : ''}`}>
        <p className="muted reveal-item" style={{ '--i': 0 }}>
          {t.youGiveTo(result.me)}
        </p>
        <div ref={target} className={`name-tag ${landed ? 'pop-in' : 'ghost'}`}>
          <span>{result.recipient}</span>
        </div>
        <div className="reveal-item" style={{ '--i': 1 }}>
          <TheirWishlist result={result} />
        </div>
        <p className="muted small reveal-item" style={{ '--i': 2 }}>
          {t.keepSecret}
        </p>
        <div className="row reveal-item" style={{ '--i': 3 }}>
          <button className="btn" onClick={onHide}>
            {t.next}
          </button>
        </div>
      </section>
      {!landed && from && (
        <div ref={flyer} className="name-tag flying">
          <span>{result.recipient}</span>
        </div>
      )}
    </>
  );
}

// Фото уменьшаем в браузере до ~640px JPEG, чтобы база не пухла.
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k);
  cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/jpeg', 0.8);
}

// Ссылку принимаем в любом виде: shop.com → https://shop.com
function normalizeLink(raw) {
  const v = raw.trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v.replace(/^\/+/, '')}`;
}
const looksLikeLink = (raw) => {
  const v = raw.trim();
  if (!v) return true;
  try {
    const u = new URL(normalizeLink(v));
    return u.hostname.includes('.') && !/\s/.test(v);
  } catch {
    return false;
  }
};

const emptyItem = () => ({ text: '', desc: '', price: '', link: '', image: '', showLink: false, showDesc: false });
const hasContent = (it) => it.text.trim() || it.desc.trim() || it.link.trim() || it.image;
const MAX_ITEMS = 50;

function WishlistForm({ initial = [], submitLabel, cancelLabel = t.cancel, draftKey, onSubmit, onCancel }) {
  const [items, setItems] = useState(() => {
    let draft = null;
    try {
      draft = draftKey && JSON.parse(localStorage.getItem(draftKey));
    } catch {}
    const base = (Array.isArray(draft) && draft.length ? draft : initial).map((x) => ({
      ...emptyItem(),
      ...x,
      showLink: !!x.link || !!x.showLink,
      showDesc: !!x.desc || !!x.showDesc,
    }));
    while (base.length < 3) base.push(emptyItem());
    return base;
  });
  const [busy, setBusy] = useState(false);
  // черновик переживает обновление страницы
  useEffect(() => {
    if (!draftKey) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(items));
    } catch {}
  }, [items, draftKey]);
  const filled = items
    .filter(hasContent)
    .map(({ text, desc, price, link, image }) => ({ text: text.trim(), desc: desc.trim(), price: (price || '').trim(), link: normalizeLink(link), image }));
  const placeholders = t.placeholders;
  const update = (i, patch) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form
      className="wishlist"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!filled.length || busy) return;
        setBusy(true);
        try {
          await onSubmit(filled);
        } finally {
          setBusy(false);
        }
      }}
    >
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            <div className="wish-body">
              <div className="title-row">
                <input
                  className="wish-title"
                  value={it.text}
                  maxLength={200}
                  placeholder={placeholders[i] || t.itemTitle}
                  onChange={(e) => update(i, { text: e.target.value })}
                />
                <label className="price-field">
                  <input
                    className="wish-price"
                    inputMode="decimal"
                    value={it.price || ''}
                    maxLength={15}
                    placeholder="30–40"
                    onChange={(e) =>
                      update(i, {
                        // только цифры и один дефис для диапазона: 30 или 30-40
                        price: e.target.value
                          .replace(/[–—]/g, '-')
                          .replace(/,/g, '.')
                          .replace(/[^\d.-]/g, '')
                          .replace(/-(?=.*-)/g, ''),
                      })
                    }
                  />
                  <span>€</span>
                </label>
              </div>
              {it.showDesc && (
                <textarea
                  className="wish-desc-input"
                  value={it.desc}
                  maxLength={2000}
                  rows={2}
                  autoFocus={!it.desc}
                  placeholder={t.descPlaceholder}
                  onChange={(e) => update(i, { desc: e.target.value })}
                />
              )}
              {it.showLink && (
                <>
                  <input
                    className={`wish-link ${looksLikeLink(it.link) ? '' : 'warn'}`}
                    type="text"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={it.link}
                    maxLength={1000}
                    placeholder={t.linkPlaceholder}
                    onChange={(e) => update(i, { link: e.target.value })}
                  />
                  {!looksLikeLink(it.link) && <span className="hint">{t.notALink}</span>}
                </>
              )}
              {it.image && (
                <div className="wish-photo">
                  <img src={it.image} alt="" />
                  <button type="button" className="chip" onClick={() => update(i, { image: '' })}>
                    {t.removePhoto}
                  </button>
                </div>
              )}
              <div className="chips">
                {it.showDesc ? (
                  <button type="button" className="chip off" onClick={() => update(i, { showDesc: false, desc: '' })}>
                    {t.removeDesc}
                  </button>
                ) : (
                  <button type="button" className="chip" onClick={() => update(i, { showDesc: true })}>
                    {t.addDesc}
                  </button>
                )}
                {it.showLink ? (
                  <button type="button" className="chip off" onClick={() => update(i, { showLink: false, link: '' })}>
                    {t.removeLink}
                  </button>
                ) : (
                  <button type="button" className="chip" onClick={() => update(i, { showLink: true })}>
                    {t.addLink}
                  </button>
                )}
                {!it.image && (
                  <label className="chip">
                    {t.addPhoto}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) update(i, { image: await shrinkImage(f) });
                      }}
                    />
                  </label>
                )}
              </div>
            </div>
            {items.length > 1 && (
              <button
                type="button"
                className="wish-del"
                aria-label={t.deleteItem}
                title={t.deleteItem}
                onClick={() => setItems((list) => list.filter((_, j) => j !== i))}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ol>
      {items.length < MAX_ITEMS && (
        <button type="button" className="add-item" onClick={() => setItems([...items, emptyItem()])}>
          {t.addItem}
        </button>
      )}
      <div className="row">
        {onCancel && (
          <button type="button" className="btn plain" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        <button className="btn" disabled={!filled.length || busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

// Цены в евро: «30» → «30 €», «30-40» → «30–40 €», «12.5» → «12,5 €».
const formatEur = (p) => {
  const fmt = (x) => {
    const n = Number(x);
    return Number.isFinite(n) && x !== '' ? n.toLocaleString(t.numberLocale, { maximumFractionDigits: 2 }) : null;
  };
  const parts = String(p).split('-').map((x) => x.trim()).filter(Boolean).map(fmt);
  if (!parts.length || parts.some((x) => x === null)) return String(p);
  return t.price(parts.join('–'));
};

const hostOf = (link) => {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return t.site;
  }
};

// Заглушка, если у подарка нет фото.
function GiftIcon() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
      <rect x="7" y="20" width="34" height="22" rx="4" fill="#f3d9c9" />
      <rect x="5" y="14" width="38" height="9" rx="3" fill="#e9bfa8" />
      <rect x="21" y="14" width="6" height="28" fill="#d8322c" opacity=".75" />
      <path d="M24 14c-3-7-11-7-11-2 0 3 6 2 11 2zm0 0c3-7 11-7 11-2 0 3-6 2-11 2z" fill="none" stroke="#d8322c" strokeWidth="2.5" opacity=".75" />
    </svg>
  );
}

// Пустой вишлист: подарок с вопросиком покачивается, рядом пояснение.
function EmptyWishlist({ title, note }) {
  return (
    <div className="empty-wish">
      <div className="empty-gift" aria-hidden="true">
        <GiftIcon />
        <span className="empty-q">?</span>
      </div>
      <div>
        <p className="empty-title">{title}</p>
        <p className="muted small flat">{note}</p>
      </div>
    </div>
  );
}

// Карточка подарка: фото, название, цена, описание, ссылка на магазин.
function WishCard({ w, onPhoto }) {
  return (
    <article className="wcard">
      {w.image ? (
        <button className="wpic" onClick={() => onPhoto(w.image)} aria-label={t.openPhoto}>
          <img src={w.image} alt="" />
        </button>
      ) : (
        <div className="wpic empty">
          <GiftIcon />
        </div>
      )}
      <div className="wbody">
        <h4>{w.text || t.untitled}</h4>
        {w.price && <div className="wprice">{formatEur(w.price)}</div>}
        {w.desc && <p className="wish-desc">{w.desc}</p>}
        {w.link && (
          <a className="wlink" href={w.link} target="_blank" rel="noopener noreferrer">
            {hostOf(w.link)} ↗
          </a>
        )}
      </div>
    </article>
  );
}

// Пока вишлисты грузятся: очертания вкладок и карточек, по ним бежит блик, подарки покачиваются.
function WishSkeleton() {
  return (
    <div className="all-lists skeleton" aria-busy="true" aria-label={t.loadingWishlists}>
      <div className="people">
        {[64, 82, 58].map((w, i) => (
          <span key={i} className="sk-pill shimmer" style={{ width: w }} />
        ))}
      </div>
      <div className="wcards">
        {[0, 1].map((i) => (
          <div key={i} className="wcard sk-card" style={{ '--i': i }}>
            <div className="wpic empty sk-gift">
              <GiftIcon />
            </div>
            <div className="wbody sk-body">
              <span className="sk-line shimmer" style={{ width: '70%' }} />
              <span className="sk-line short shimmer" style={{ width: '28%' }} />
              <span className="sk-line thin shimmer" style={{ width: '90%' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WishItems({ list }) {
  const [big, setBig] = useState(null);
  return (
    <>
      <div className="wcards">
        {list.map((w, i) => (
          <div key={i} className="wcard-in" style={{ '--i': Math.min(i, 8) }}>
            <WishCard w={w} onPhoto={setBig} />
          </div>
        ))}
      </div>
      {big && (
        <div className="backdrop" onClick={() => setBig(null)}>
          <img className="big-photo" src={big} alt="" />
        </div>
      )}
    </>
  );
}

function TheirWishlist({ result }) {
  const list = result.recipientWishlist || [];
  return (
    <div className="their-plain">
      <h3>{t.whatTheyWant(result.recipient)}</h3>
      {list.length ? (
        <WishItems list={list} />
      ) : (
        <EmptyWishlist title={t.emptyTitle(result.recipient)} note={t.emptyNote} />
      )}
    </div>
  );
}

// Свой вишлист: карточками, правится по кнопке.
function MyWishlist({ result, setResult }) {
  const [editing, setEditing] = useState(false);
  const list = result.myWishlist || [];
  return (
    <div className="their-plain">
      <div className="box-head">
        <h3>{t.yourWishes}</h3>
        {!editing && (
          <button className="chip" onClick={() => setEditing(true)}>
            {t.edit}
          </button>
        )}
      </div>
      {editing ? (
        <WishlistForm
          initial={list}
          submitLabel={t.save}
          cancelLabel={t.cancel}
          onCancel={() => setEditing(false)}
          onSubmit={async (wishlist) => {
            const r = await api('/api/me/wishlist', { method: 'PUT', token: result.token, body: JSON.stringify({ wishlist }) });
            if (r.ok) {
              setResult({ ...(await r.json()), token: result.token });
              setEditing(false);
            }
          }}
        />
      ) : list.length ? (
        <WishItems list={list} />
      ) : (
        <EmptyWishlist title={t.myEmptyTitle} note={t.myEmptyNote} />
      )}
    </div>
  );
}

// Вишлисты по людям: вкладка на каждого. Можно подарить что-то не только тому, кого вытянул.
// Того, кому даришь, здесь специально не выделяем — чтобы не подсмотрели через плечо.
// Без result (зритель, который не участвует или ещё не тянул) показываем всех подряд, без вкладки «Ты».
function AllWishlists({ result, setResult }) {
  const token = result?.token;
  const [list, setList] = useState(null);
  const [who, setWho] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api('/api/wishlists', { token }).catch(() => null);
      if (r?.ok && alive) setList(await r.json());
    };
    load();
    const id = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [token]);

  if (!list) return <WishSkeleton />;
  const others = list.filter((p) => !p.me);
  const tabs = [
    ...(result ? [{ key: '__me', label: t.you, count: (result.myWishlist || []).length }] : []),
    ...others.map((p) => ({ key: p.name, label: p.name, count: p.wishlist.length })),
  ];
  const current = who ?? others[0]?.name ?? tabs[0]?.key;
  const person = others.find((p) => p.name === current);

  return (
    <div className="all-lists">
      <div className="people" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={current === t.key} className={current === t.key ? 'on' : ''} onClick={() => setWho(t.key)}>
            {t.label}
            {t.count > 0 && <span className="cnt">{t.count}</span>}
          </button>
        ))}
      </div>
      {current === '__me' ? (
        <MyWishlist result={result} setResult={setResult} />
      ) : person?.wishlist.length ? (
        <WishItems key={current} list={person.wishlist} />
      ) : (
        <EmptyWishlist key={current} title={t.emptyTitle(current)} note={t.emptyNote} />
      )}
    </div>
  );
}

function Mine({ result, setResult, startShown }) {
  const [shown, setShown] = useState(startShown);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState('mine'); // mine | all
  const link = `${location.origin}/#t=${result.token}`;

  return (
    <section className={`card ${tab === 'all' ? 'wide' : ''}`}>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'mine'} className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
          {t.whoIGiveTo}
        </button>
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          {t.wishlists}
        </button>
      </div>

      {tab === 'all' ? (
        <AllWishlists result={result} setResult={setResult} />
      ) : (
        <>
      {!result.myWishlist?.length && (
        <p className="muted small">
          {t.myEmptyHint}
        </p>
      )}
      <div className="box-head">
        <p className="muted flat">{t.youGiveTo(result.me)}</p>
        {shown && (
          <button className="chip" onClick={() => setShown(false)}>
            {t.hide}
          </button>
        )}
      </div>
      <div className={`name-tag secret ${shown ? 'shown' : ''}`}>
        <span>{result.recipient}</span>
      </div>
      {shown ? (
        <TheirWishlist result={result} />
      ) : (
        <button className="btn wide" onClick={() => setShown(true)}>
          {t.reveal}
        </button>
      )}

        </>
      )}

      <div className="personal">
        <p className="muted small flat">{t.personalLink}</p>
        <button
          className="chip"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              prompt(t.copyPrompt, link);
            }
          }}
        >
          {copied ? t.copied : t.copy}
        </button>
      </div>
    </section>
  );
}
