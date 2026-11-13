export const SETUP_CHOICE_PRESETS = {
  en: ["Research and digging into topics", "Keeping an eye on things for me", "Email, calendar and messages",
    "Bookings, shopping and errands", "Data, spreadsheets and reports"],
  es: ["Investigar y profundizar en temas", "Estar pendiente de cosas por mí", "Correo, calendario y mensajes",
    "Reservas, compras y recados", "Datos, hojas de cálculo e informes"],
  "pt-br": ["Pesquisar e aprofundar temas", "Ficar de olho nas coisas para mim", "E-mail, agenda e mensagens",
    "Reservas, compras e tarefas", "Dados, planilhas e relatórios"],
  ko: ["리서치와 주제 깊이 파고들기", "이것저것 지켜보기", "이메일, 캘린더, 메시지",
    "예약, 쇼핑, 심부름", "데이터, 스프레드시트, 보고서"],
  zh: ["调研和深挖各种主题", "帮我盯着一些事情", "邮件、日历和消息", "预订、购物和跑腿", "数据、表格和报告"],
  "zh-tw": ["研究與深入探討主題", "幫我留意各種事情", "電子郵件、行事曆和訊息",
    "預約、購物和跑腿", "資料、試算表和報告"],
} as const;

export function matchesSetupChoicePreset(choices: readonly string[]): boolean {
  return Object.values(SETUP_CHOICE_PRESETS).some((preset) =>
    choices.length === preset.length && preset.every((text, index) => text === choices[index]));
}
