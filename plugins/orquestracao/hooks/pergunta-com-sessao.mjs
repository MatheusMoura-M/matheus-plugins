#!/usr/bin/env node
// PreToolUse (Bash, PowerShell): a pergunta da orquestradora só vai à página ligada à sessão dela (`--sessao local_…`).
// Sem ela, `perguntas nova` herda a sessão do item (a da dona, ou nenhuma quando o item ainda não tem dona), e a
// resposta dada pelo painel fica só gravada: a página só entrega a `local_…` (medido na WIC-Q6 e na WIC-Q10).
// Recusa antes de gravar, para não sobrar pergunta sem sessão. Lê o texto do comando: pergunta montada por variável
// ou por `node …/cli.mjs` passa sem conferência. Hook com erro deixa passar.
import { fileURLToPath } from 'node:url';
import { lerEntrada, papelDe, responder, rodar } from './comum.mjs';
import { segmentos } from './sem-no-verify.mjs';

const PERGUNTAS = /^perguntas(?:\.cmd)?$/i;
// O que pode vir colado no nome do comando: `Q=$(perguntas`, `(perguntas`, `` `perguntas ``.
const PREFIXO = /^(?:[A-Za-z_]\w*=)?[$(`]*/;
const SESSAO_DO_APP = /^local_[\w-]+$/;

/** O comando de gravar pergunta que as cobranças mostram; na orquestradora, com o `--sessao` que este hook exige. */
export const comoGravarPergunta = (sigla, papel) => `\`perguntas nova --titulo … --caso … --se-nao … --recomendacao … --item ${sigla}-Fn`
  + `${papel === 'orquestradora' ? ' --sessao <seu local_…>' : ''}\``;

const ehPerguntas = (token) => PERGUNTAS.test(String(token).replace(PREFIXO, '').split(/[\\/]/).pop());

/**
 * O `--sessao` de cada `perguntas nova` do comando, na ordem (`null` quando falta). Vale o último, como no CLI.
 * O nome pode vir em qualquer posição do segmento (`$q = perguntas nova`, `time perguntas nova`); texto entre aspas é
 * um token só e não conta.
 */
export function sessoesDasPerguntas(comando) {
  const achadas = [];
  for (const seg of segmentos(comando)) {
    seg.forEach((token, i) => {
      if (!ehPerguntas(token) || seg[i + 1] !== 'nova') return;
      let sessao = null;
      for (let j = i + 2; j < seg.length; j++) {
        if (seg[j] === '--sessao') sessao = seg[j + 1] ?? '';
        else if (seg[j].startsWith('--sessao=')) sessao = seg[j].slice('--sessao='.length);
      }
      achadas.push(sessao === null ? null : sessao.replace(/[)`]+$/, ''));
    });
  }
  return achadas;
}

/** Junta as linhas continuadas; no PowerShell a `\` é parte do caminho, não escape, e quem continua a linha é a crase. */
function normalizar(comando, ferramenta) {
  const c = comando.replace(/\r\n/g, '\n');
  return ferramenta === 'PowerShell' ? c.replace(/`\n/g, ' ').replace(/\\/g, '/') : c.replace(/\\\n/g, ' ');
}

export function decidir(entrada) {
  const comando = entrada.tool_input?.command;
  if (typeof comando !== 'string' || !/perguntas/i.test(comando)) return null;
  if (papelDe(entrada.session_id) !== 'orquestradora') return null;
  const ruins = sessoesDasPerguntas(normalizar(comando, entrada.tool_name)).filter((s) => !SESSAO_DO_APP.test(s ?? ''));
  if (!ruins.length) return null;
  const errado = ruins.find((s) => s !== null);
  return 'A pergunta da orquestradora vai à página ligada à sessão dela. Sem `--sessao local_…`, ela herda a sessão do item '
    + '(a da dona, ou nenhuma quando o item ainda não tem dona) e a resposta dada pelo painel não chega a você. '
    + 'Pegue o seu id com `get_session` e `"self"` (o `sessionId`, que começa com `local_`) e rode de novo com o id por extenso.'
    + (errado === undefined ? '' : ` O \`--sessao ${errado}\` não é um id do app: o ID da linha "ID desta sessão" do início serve só ao \`perguntas papel\`.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rodar('pergunta-com-sessao', () => {
    const motivo = decidir(lerEntrada());
    if (motivo) responder('deny', motivo);
  });
}
