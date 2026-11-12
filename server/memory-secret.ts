// A memory line is loaded into later turns, so a password, card, phone or email written here would be shown again.

const SECRET_ERROR = "Don't store a password, card number, phone number or email address in memory. Restate the fact without it.";
const SCREEN_ERROR = "Don't store what was on the computer screen. Keep the durable outcome, not the screenshot, the window text, or the click coordinates.";

const PASSWORD_STOP = new Set([
  "required", "missing", "blank", "empty", "optional", "needed", "correct", "wrong", "forgotten",
  "unknown", "secret", "hidden", "private", "enough", "changed", "stored", "saved", "different",
  "never", "always", "not",
]);

const PASSWORD_ZH = /(?:密码|口令)\s*(?:是|为|=|:|：)\s*[A-Za-z0-9][A-Za-z0-9._~+/=-]{3,}/;
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![A-Za-z0-9._%+-])/;
const EMAIL_LOCALHOST = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@localhost\b/i;
const PHONE_E164 = /(?<!\d)\+\d{8,15}(?!\d)/;
const PHONE_CN = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const PHONE_NANP = /(?<!\d)(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\d)/;
const PHONE_LABEL = /(?:电话|手机|phone|mobile)\s*[:：]?\s*(\+?[\d\s().-]{8,22})/i;

function luhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = digits.charCodeAt(index) - 48;
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function passwordSaid(text: string): boolean {
  const pattern = /\b(?:password|passwd|passcode|passphrase)\b\s*(?:is|was|=|:)\s*(?:"([^"]{4,})"|'([^']{4,})'|([A-Za-z0-9._~+/=-]{4,}))/gi;
  for (const match of text.matchAll(pattern)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").toLowerCase();
    if (value && !PASSWORD_STOP.has(value)) return true;
  }
  return PASSWORD_ZH.test(text);
}

function hasCardNumber(text: string): boolean {
  const pattern = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue;
    if (/[ -]/.test(raw) || digits.length === 15 || digits.length === 16) return true;
  }
  return false;
}

function labelledPhone(text: string): boolean {
  const labelled = PHONE_LABEL.exec(text);
  if (!labelled) return false;
  const digits = labelled[1]!.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15;
}

function hasPhoneNumber(text: string): boolean {
  return PHONE_E164.test(text) || PHONE_CN.test(text) || PHONE_NANP.test(text) || labelledPhone(text);
}

function hasEmailAddress(text: string): boolean {
  return EMAIL.test(text) || EMAIL_LOCALHOST.test(text);
}

const IMAGE_DATA = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]{40,}/i;
const IMAGE_BLOB = /(?:iVBORw0KGgo|R0lGODlh|\/9j\/)[A-Za-z0-9+/]{24,}/;
const A11Y_ROLE = /\bAX(?:Window|Button|TextArea|ScrollArea|Group|StaticText|TextField|MenuItem|Image|Link)\b/g;
const COORD_GRID = /(?:\(\s*\d{2,4}\s*,\s*\d{2,4}\s*\)\s*){3,}/;
const SCREEN_SAW = /(?:^|[.!?。！？]\s*)(?:the |this )?(?:screenshot|screen grab|screen|desktop|window) (?:shows|showed|displays|displayed|reads(?::|\s*["“]))/i;
const SCREEN_ZH = /(?:^|[。！？]\s*)(?:截图|屏幕(?:上|里)?|窗口(?:里|中)?)(?:显示|写着|看到)/;

export function screenDumpRefused(text: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  A11Y_ROLE.lastIndex = 0;
  const roles = flat.match(A11Y_ROLE);
  if (IMAGE_DATA.test(flat) || IMAGE_BLOB.test(flat) || /\belement_token\b/i.test(flat) || COORD_GRID.test(flat) || SCREEN_SAW.test(flat) || SCREEN_ZH.test(flat)) return SCREEN_ERROR;
  if (roles && new Set(roles).size >= 2) return SCREEN_ERROR;
  return null;
}

/** Null when the line can be stored. API-key shapes stay on the existing redaction path. */
export function memoryBodyRefused(text: string): string | null {
  if (!text.trim()) return null;
  if (passwordSaid(text) || hasCardNumber(text) || hasPhoneNumber(text) || hasEmailAddress(text)) return SECRET_ERROR;
  return screenDumpRefused(text);
}
