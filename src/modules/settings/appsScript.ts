/** Código do Google Apps Script que envia os XMLs do Gmail para o sistema (sob demanda, pelo botão Sincronizar). */
export function gmailScript(endpoint: string, token: string, secret: string) {
  return `// Dualshop Intelligence — sincronização de XML de NF-e do Gmail (v2)
// Roda na SUA conta Google, só quando você clica em "Sincronizar e-mail" no sistema.
// Procura em todo o Gmail (caixa de entrada, marcadores/pastas e arquivados; não olha spam
// nem lixeira) os e-mails com anexo .xml ou .zip e envia os XMLs para o sistema.
// Nada é apagado do seu e-mail. Os e-mails já lidos ganham o marcador abaixo.
const ENDERECO = '${endpoint}';
const CHAVE = '${token}';
const SEGREDO = '${secret}';
const ETIQUETA = 'dualshop-xml-enviado';
const BUSCA = 'has:attachment (filename:xml OR filename:zip) newer_than:90d -in:spam -in:trash -label:' + ETIQUETA;
const LIMITE_MS = 4.5 * 60 * 1000; // o Google encerra o script em 6 minutos

function sincronizar() {
  const inicio = Date.now();
  const r = { conversas: 0, xmls: 0, novas: 0, jaImportadas: 0, repetidas: 0, outrasEmpresas: 0, naoNfe: 0, erros: 0, faltou: false };
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  const conversas = GmailApp.search(BUSCA, 0, 100);
  for (const conversa of conversas) {
    if (Date.now() - inicio > LIMITE_MS) { r.faltou = true; break; }
    r.conversas++;
    let tudoCerto = true;
    for (const msg of conversa.getMessages()) {
      for (const anexo of msg.getAttachments()) {
        const nome = anexo.getName() || '';
        let arquivos = [];
        if (/\\.xml$/i.test(nome)) arquivos = [anexo.copyBlob()];
        else if (/\\.zip$/i.test(nome)) {
          try { arquivos = Utilities.unzip(anexo.copyBlob().setContentType('application/zip')).filter((b) => /\\.xml$/i.test(b.getName() || '')); }
          catch (e) { arquivos = []; }
        }
        for (const arq of arquivos) {
          r.xmls++;
          const resp = UrlFetchApp.fetch(ENDERECO, {
            method: 'post',
            contentType: 'application/xml',
            payload: arq.getBytes(),
            muteHttpExceptions: true,
            headers: {
              'x-dualshop-token': CHAVE,
              'x-email-from': encodeURIComponent(msg.getFrom()),
              'x-email-subject': encodeURIComponent(msg.getSubject()),
              'x-file-name': encodeURIComponent(arq.getName() || nome),
            },
          });
          const codigo = resp.getResponseCode();
          if (codigo === 401) throw new Error('Chave de integração inválida ou revogada. Gere outra em Configurações → Integrações.');
          if (codigo >= 500) { r.erros++; tudoCerto = false; continue; }
          let res = {};
          try { res = JSON.parse(resp.getContentText()); } catch (e) {}
          if (res.result === 'nova') r.novas++;
          else if (res.result === 'ja_importada') r.jaImportadas++;
          else if (res.result === 'duplicada') r.repetidas++;
          else if (res.reason === 'fornecedor não cadastrado') r.outrasEmpresas++;
          else if (codigo >= 400) r.erros++;
          else r.naoNfe++;
        }
      }
    }
    if (tudoCerto) conversa.addLabel(etiqueta);
  }
  if (conversas.length === 100 && !r.faltou) r.faltou = true;
  return r;
}

// Chamado pelo botão "Sincronizar e-mail" do sistema.
function doPost(e) {
  let corpo = {};
  try { corpo = JSON.parse(e.postData.contents); } catch (err) {}
  let resposta;
  if (corpo.segredo !== SEGREDO) {
    resposta = { erro: 'Acesso negado.' };
  } else {
    const trava = LockService.getScriptLock();
    if (!trava.tryLock(1000)) resposta = { erro: 'Uma sincronização já está em andamento. Aguarde terminar.' };
    else {
      try { resposta = sincronizar(); }
      catch (err) { resposta = { erro: String(err && err.message || err) }; }
      finally { trava.releaseLock(); }
    }
  }
  return ContentService.createTextOutput(JSON.stringify(resposta)).setMimeType(ContentService.MimeType.JSON);
}

// Rode UMA vez no editor: pede a autorização, desliga a execução automática
// da versão anterior (se houver) e faz a primeira varredura. Veja o resultado em "Registro de execução".
function configurar() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  Logger.log(JSON.stringify(sincronizar()));
}
`
}
