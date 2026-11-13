import { byLanguage } from "./language.ts";
import { greetingName } from "../shared/greeting-name.ts";
import { SETUP_CHOICE_PRESETS } from "../shared/setup-choice-presets.ts";

type Greeting = (name: string, person?: string) => string;

/** The first bot's seeded line is created by the server before the UI exists. */
const GREETINGS: { en: Greeting } & Record<string, Greeting> = {
  en: (name, person) => `Hi${person ? ` ${person}` : ""}, I'm ${name}. What would you like me to do?`,
  es: (name, person) => `Hola${person ? ` ${person}` : ""}, soy ${name}. ¿Qué te gustaría que hiciera?`,
  "pt-br": (name, person) => `Oi${person ? ` ${person}` : ""}, eu sou ${name}. O que você gostaria que eu fizesse?`,
  ko: (name, person) => `안녕하세요${person ? `, ${person}님` : ""}. 저는 ${name}입니다. 무엇을 도와드릴까요?`,
  zh: (name, person) => `你好${person ? `，${person}` : ""}！我是 ${name}。你想先让我帮你做什么？`,
  "zh-tw": (name, person) => `嗨${person ? ` ${person}` : ""}，我是 ${name}。你想要我幫你做什麼？`,
};

/** What the bot says the moment Set me up is pressed: no model is asked, so it is written here. */
const SETUP_REQUEST_LINES: { en: string } & Record<string, string> = {
  en: "Great. Tell me what you'd like help with, in your own words, and I'll set myself up for it. For example: \"sort my inbox every morning\" or \"research our competitors every week\".",
  es: "Genial. Cuéntame con tus propias palabras en qué te gustaría que te ayude y me prepararé para ello. Por ejemplo: \"ordena mi bandeja de entrada cada mañana\" o \"investiga a nuestros competidores cada semana\".",
  "pt-br": "Ótimo. Me conte com suas palavras em que você gostaria de ajuda e eu me preparo para isso. Por exemplo: \"organize minha caixa de entrada toda manhã\" ou \"pesquise nossos concorrentes toda semana\".",
  ko: "좋아요. 도움이 필요한 일을 편하게 말씀해 주시면 거기에 맞게 제가 설정할게요. 예: \"매일 아침 받은편지함 정리해 줘\", \"매주 경쟁사 조사해 줘\".",
  zh: "好的。用你自己的话告诉我想做什么，我会按你的需要来设置。例如：「每天早上整理我的收件箱」或「每周调研竞争对手」。",
  "zh-tw": "好的。用你自己的話告訴我想要幫忙的事，我會照著設定好自己。例如：「每天早上整理我的收件匣」或「每週研究我們的競爭對手」。",
};

export function setupChoices(language?: string): string[] {
  return [...byLanguage<readonly string[]>(SETUP_CHOICE_PRESETS, language)];
}

/** The fixed answers exist in this language, not only the English stand-in. */
export function hasSetupChoices(language?: string): boolean {
  return byLanguage<readonly string[]>(SETUP_CHOICE_PRESETS, language) !== SETUP_CHOICE_PRESETS.en || /^en(?:-|$)/i.test(language?.trim() || "en");
}

/** `person`: the name the person gave, greeted by greetingName; absent or blank, the greeting names no one. */
export function initialGreeting(name: string, language?: string, person?: string): string {
  return byLanguage(GREETINGS, language)(name, greetingName(person) || undefined);
}

export function setupRequestLine(language?: string): string {
  return byLanguage(SETUP_REQUEST_LINES, language);
}

/** The seeded message; a function language is read now, so a language changed in Settings reaches the next new bot.
 * `offerSetup`: the bot has no role or instructions yet, so its greeting carries the setup card and its answers. */
export function initialGreetingMessage(name: string, language: string | (() => string), offerSetup = false, person?: string) {
  const spoken = typeof language === "function" ? language() : language;
  const text = initialGreeting(name, spoken, person);
  return { role: "bot", kind: "text", text, ...(offerSetup ? { setupOffer: true as const, setupChoices: setupChoices(spoken) } : {}) } as const;
}
