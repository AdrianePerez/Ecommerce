/** Código do Google Apps Script que envia os XMLs do Gmail para o sistema. */
export function gmailScript(endpoint: string, token: string) {
  return `// Dualshop Intelligence — envio automático de XML de NF-e do Gmail
// Roda na SUA conta Google. Só lê e-mails com anexo .xml e envia o arquivo
// para a caixa de entrada do sistema. Nada é apagado do seu e-mail.
const ENDERECO = '${endpoint}';
const CHAVE = '${token}';
const ETIQUETA = 'dualshop-xml-enviado';
const BUSCA = 'has:attachment filename:xml newer_than:60d -label:' + ETIQUETA;

function enviarXmls() {
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  const conversas = GmailApp.search(BUSCA, 0, 30);
  for (const conversa of conversas) {
    let tudoCerto = true;
    for (const msg of conversa.getMessages()) {
      for (const anexo of msg.getAttachments()) {
        if (!/\\.xml$/i.test(anexo.getName())) continue;
        const r = UrlFetchApp.fetch(ENDERECO, {
          method: 'post',
          contentType: 'application/xml',
          payload: anexo.getBytes(),
          muteHttpExceptions: true,
          headers: {
            'x-dualshop-token': CHAVE,
            'x-email-from': encodeURIComponent(msg.getFrom()),
            'x-email-subject': encodeURIComponent(msg.getSubject()),
            'x-file-name': encodeURIComponent(anexo.getName()),
          },
        });
        const codigo = r.getResponseCode();
        if (codigo === 401) throw new Error('Chave de integração inválida ou revogada. Gere outra em Configurações → Integrações.');
        if (codigo >= 500) tudoCerto = false; // tenta de novo na próxima rodada
      }
    }
    if (tudoCerto) conversa.addLabel(etiqueta);
  }
}

// Rode UMA vez para ligar a execução automática a cada 15 minutos.
function instalar() {
  ScriptApp.getProjectTriggers().forEach((t) => { if (t.getHandlerFunction() === 'enviarXmls') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('enviarXmls').timeBased().everyMinutes(15).create();
  enviarXmls();
}
`
}
