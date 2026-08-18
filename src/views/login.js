// Anmeldeschirm vor der App. Ein echtes <form> statt loser Felder: nur so
// bieten Mobilbrowser Passwortmanager, „Weiter"-Taste und Autofill an — im
// alten Radar-Panel scheiterte genau daran die Anmeldung am Handy.
import * as sb from '../sync/supabase.js';
import { persist, state } from '../state.js';

const SKIP_KEY = 'gw_authSkipped';

const html = String.raw;

/**
 * Baut das Gate einmalig ins übergebene Element und liefert die Steuerung.
 * @param {HTMLElement} host leeres Container-Element (Vollbild-Overlay)
 * @param {{onSignedIn:(user:object)=>void, onSkip:()=>void}} hooks
 */
export function createAuthGate(host, { onSignedIn, onSkip } = {}) {
  host.innerHTML = html`
    <div class="authgate-card">
      <div class="authgate-brand"><span class="logo">⬡</span>
        <div><b>ORBITKOMMANDO</b><small>Flotten &amp; Planeten</small></div>
      </div>
      <p class="authgate-lead" id="authLead">Melde dich mit deinem Supabase-Konto an, um Farmradar, Farmliste und Beute-Archiv zu nutzen.</p>

      <form class="authgate-form" id="authForm" novalidate>
        <label for="authEmail">E-Mail</label>
        <input id="authEmail" name="email" class="inp" type="email" inputmode="email"
               autocomplete="username" autocapitalize="none" autocorrect="off"
               spellcheck="false" enterkeyhint="next" placeholder="du@example.com" required>

        <label for="authPass">Passwort</label>
        <div class="authgate-pass">
          <input id="authPass" name="password" class="inp" type="password"
                 autocomplete="current-password" autocapitalize="none" autocorrect="off"
                 spellcheck="false" enterkeyhint="go" placeholder="••••••••" required>
          <button class="btn sm ghost" type="button" id="authEye" aria-label="Passwort anzeigen">👁</button>
        </div>

        <p class="authgate-msg" id="authMsg" hidden></p>
        <button class="btn primary authgate-submit" type="submit" id="authSubmit">Anmelden</button>
      </form>

      <button class="btn ghost authgate-skip" type="button" id="authSkip">Ohne Anmeldung fortfahren</button>

      <details class="authgate-adv" id="authAdv">
        <summary>Supabase-Projekt ändern</summary>
        <label for="authUrl">Projekt-URL</label>
        <input id="authUrl" class="inp" type="url" inputmode="url" autocapitalize="none"
               autocorrect="off" spellcheck="false" placeholder="https://xxxx.supabase.co">
        <label for="authKey">anon public key</label>
        <input id="authKey" class="inp" type="text" autocapitalize="none" autocorrect="off"
               spellcheck="false" placeholder="eyJhbGciOi…">
        <button class="btn sm" type="button" id="authSaveCfg">Projekt speichern</button>
      </details>
    </div>`;

  const $ = (sel) => host.querySelector(sel);
  const form = $('#authForm');
  const email = $('#authEmail');
  const pass = $('#authPass');
  const submit = $('#authSubmit');
  const msg = $('#authMsg');
  const lead = $('#authLead');

  function say(text, kind = 'bad') {
    msg.hidden = !text;
    msg.textContent = text || '';
    msg.className = `authgate-msg ${text ? kind : ''}`;
  }

  function busy(on, label = 'Anmelden …') {
    submit.disabled = on;
    submit.textContent = on ? label : 'Anmelden';
    form.classList.toggle('busy', on);
  }

  function fillConfig() {
    const cfg = sb.getConfig();
    $('#authUrl').value = cfg.url || '';
    $('#authKey').value = cfg.anonKey || '';
    lead.textContent = sb.isConfigured()
      ? 'Melde dich mit deinem Supabase-Konto an, um Farmradar, Farmliste und Beute-Archiv zu nutzen.'
      : 'Noch kein Supabase-Projekt hinterlegt — trage es unten unter „Supabase-Projekt ändern" ein.';
  }

  function open(reason, opts = {}) {
    fillConfig();
    email.value = state.radar.settings?.email || '';
    pass.value = '';
    say(reason || '', 'info');
    $('#authAdv').open = !!opts.advanced || !sb.isConfigured();
    host.hidden = false;
    document.body.classList.add('authgate-open');
    // Autofokus nur am Desktop: auf dem Handy schiebt die Tastatur sonst
    // sofort die halbe Karte aus dem Bild.
    if (window.matchMedia('(min-width:820px)').matches) {
      setTimeout(() => (email.value ? pass : email).focus(), 30);
    }
  }

  function close() {
    host.hidden = true;
    document.body.classList.remove('authgate-open');
    busy(false);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const mail = email.value.trim();
    const pw = pass.value;
    if (!sb.isConfigured()) {
      say('Bitte zuerst Projekt-URL und anon-Key hinterlegen.');
      $('#authAdv').open = true;
      return;
    }
    if (!mail || !pw) { say('Bitte E-Mail und Passwort eingeben.'); return; }
    busy(true);
    say('');
    try {
      const user = await sb.signIn(mail, pw);
      persist.setRadar({ email: mail });
      sessionStorage.removeItem(SKIP_KEY);
      close();
      onSignedIn?.(user);
    } catch (err) {
      const text = String(err?.message || err);
      say(/invalid login/i.test(text)
        ? 'E-Mail oder Passwort stimmen nicht.'
        : /failed to fetch|networkerror/i.test(text)
        ? 'Keine Verbindung zum Supabase-Projekt — Netz oder Projekt-URL prüfen.'
        : text);
      busy(false);
      pass.focus();
    }
  });

  $('#authEye').addEventListener('click', () => {
    const shown = pass.type === 'text';
    pass.type = shown ? 'password' : 'text';
    $('#authEye').setAttribute('aria-label', shown ? 'Passwort anzeigen' : 'Passwort verbergen');
  });

  $('#authSaveCfg').addEventListener('click', () => {
    const url = $('#authUrl').value.trim();
    const key = $('#authKey').value.trim();
    if (!url || !key) { say('Projekt-URL und anon-Key werden beide gebraucht.'); return; }
    sb.setConfig(url, key);
    fillConfig();
    $('#authAdv').open = false;
    say('Projekt gespeichert. Jetzt anmelden.', 'ok');
  });

  $('#authSkip').addEventListener('click', () => {
    sessionStorage.setItem(SKIP_KEY, '1');
    close();
    onSkip?.();
  });

  /**
   * Beim Start: bestehende Sitzung prüfen. Nur wenn keine da ist (und der
   * Nutzer nicht schon „ohne Anmeldung" gewählt hat), blockiert das Gate.
   */
  async function start() {
    if (!sb.isConfigured()) {
      if (sessionStorage.getItem(SKIP_KEY)) return null;
      open();
      return null;
    }
    host.hidden = false;
    document.body.classList.add('authgate-open');
    busy(true, 'Prüfe Anmeldung …');
    let user = null;
    try {
      user = await sb.currentUser();
    } catch { /* offline: dann eben der Anmeldeschirm */ }
    busy(false);
    if (user) { close(); onSignedIn?.(user); return user; }
    if (sessionStorage.getItem(SKIP_KEY)) { close(); return null; }
    open();
    return null;
  }

  return { start, open, close };
}
