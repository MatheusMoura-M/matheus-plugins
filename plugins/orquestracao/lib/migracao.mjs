// A pasta de estado do kit era ~/.claude/ichikawa e passou a ~/.claude/matheus-plugins (docs/contratos.md, "Vinda do
// kit original"). A migração nunca apaga um registro: o que existe dos dois lados com conteúdo diferente vai para
// `migracao-conflitos/` dentro da pasta nova.
//
// A ordem fecha a janela de duas pastas vivas: primeiro a antiga sai do caminho num rename só (vira uma "sobra"),
// logo em seguida o link (junction no Windows) toma o lugar dela, e só então a sobra é mesclada na nova. Daí em
// diante, quem grava pelo caminho antigo (sessões abertas antes do release, na versão velha) grava na nova.
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const PASTA_DE_CONFLITOS = 'migracao-conflitos';
const MARCA_DE_SOBRA = '.migrando-';
const TENTATIVAS_DE_LINK = 3;
/** Gravação pela metade (o `gravarJson` escreve `<arquivo>.<pid>.tmp` e renomeia): quem escrevia já perdeu o rename. */
const TEMPORARIO = /\.tmp$/;

/** Resultados em que o kit segue na pasta antiga (a nova ainda não é a fonte da verdade). */
const FICA_NA_ANTIGA = new Set(['adiada', 'link-alheio']);
/** Resultados que pedem um aviso: a migração não terminou ou não pôde ser feita. */
const PEDE_AVISO = new Set(['adiada', 'link-alheio', 'com-sobras']);

const estado = (caminho) => { try { return lstatSync(caminho); } catch { return null; } };
const mesmaPasta = (a, b) => { try { return realpathSync.native(a) === realpathSync.native(b); } catch { return false; } };

/** As sobras de migrações anteriores que não terminaram, ao lado da pasta antiga. */
function sobrasDe(antiga) {
  const prefixo = `${basename(antiga)}${MARCA_DE_SOBRA}`;
  try {
    return readdirSync(dirname(antiga)).filter((n) => n.startsWith(prefixo)).map((n) => join(dirname(antiga), n));
  } catch { return []; }
}

/**
 * Traz `antiga` para `nova` e deixa no lugar da antiga um link para a nova. Nunca lança.
 * `fs` troca o rename e o link (só nos testes, para simular arquivo preso ou corrida).
 * @returns {'sem-antiga'|'ja-migrada'|'migrada'|'com-sobras'|'adiada'|'link-alheio'|'mesma-pasta'}
 *   adiada: a antiga não pôde sair do caminho (arquivo preso) ou o link não pôde ser criado; nada mudou, o kit segue
 *   nela e a próxima vez tenta de novo. link-alheio: a antiga é link para outro lugar; nada se toca. com-sobras: o
 *   link está feito, mas algo ficou preso na sobra; a próxima vez termina.
 */
export function migrarPastaAntiga(antiga, nova, fs = {}) {
  const renomear = fs.renomear ?? renameSync;
  const ligar = fs.ligar ?? ((alvo, caminho) => symlinkSync(alvo, caminho, 'junction'));
  try {
    const info = estado(antiga);
    if (info?.isSymbolicLink()) return mesmaPasta(antiga, nova) ? mesclarSobras(antiga, nova, 'ja-migrada') : 'link-alheio';
    if (info && !info.isDirectory()) return 'link-alheio';
    if (info && estado(nova) && mesmaPasta(antiga, nova)) return 'mesma-pasta';
    if (!info && sobrasDe(antiga).length === 0) return 'sem-antiga';

    mkdirSync(nova, { recursive: true });
    if (!trocarPorLink(antiga, nova, renomear, ligar)) return 'adiada';
    return mesclarSobras(antiga, nova, 'migrada');
  } catch {
    return 'adiada';
  }
}

/**
 * Tira a pasta antiga do caminho (vira sobra) e põe o link no lugar. Se uma sessão velha recriou a antiga entre os
 * dois passos, essa também vira sobra e o link é tentado de novo. Sem link, desfaz: a sobra volta a ser a antiga.
 */
function trocarPorLink(antiga, nova, renomear, ligar) {
  let ultima = null;
  for (let i = 0; i < TENTATIVAS_DE_LINK; i++) {
    const info = estado(antiga);
    if (info && !info.isSymbolicLink()) {
      const sobra = `${antiga}${MARCA_DE_SOBRA}${process.pid}-${Date.now()}-${i}`;
      try { renomear(antiga, sobra); } catch { return ultima ? desfazer(ultima, antiga, renomear) : false; }
      ultima = sobra;
    }
    try { ligar(nova, antiga); return true; } catch { /* a antiga voltou no meio, ou o disco não aceita link */ }
  }
  return ultima ? desfazer(ultima, antiga, renomear) : false;
}

function desfazer(sobra, antiga, renomear) {
  if (!estado(antiga)) { try { renomear(sobra, antiga); } catch { /* a sobra fica para a próxima vez */ } }
  return false;
}

function mesclarSobras(antiga, nova, seTudoSaiu) {
  let sobrou = false;
  for (const sobra of sobrasDe(antiga)) {
    mesclar(sobra, nova, join(nova, PASTA_DE_CONFLITOS));
    if (!apagarSeVazia(sobra)) sobrou = true;
  }
  return sobrou ? 'com-sobras' : seTudoSaiu;
}

const mesmoConteudo = (a, b) => { try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; } };

/** Guarda `origem` em `destino` sem pisar em nada: se já há um arquivo lá, o nome ganha um sufixo. */
function guardar(origem, destino) {
  mkdirSync(dirname(destino), { recursive: true });
  let alvo = destino;
  for (let i = 1; estado(alvo); i++) alvo = `${destino}.${i}`;
  renameSync(origem, alvo);
}

function mesclar(de, para, conflitos) {
  for (const nome of readdirSync(de)) {
    const origem = join(de, nome);
    const destino = join(para, nome);
    try {
      const o = lstatSync(origem);
      if (o.isFile() && TEMPORARIO.test(nome)) { unlinkSync(origem); continue; }
      let d = estado(destino);
      if (!d && o.isDirectory()) { mkdirSync(destino); d = estado(destino); } // pasta entra arquivo a arquivo: os temporários ficam de fora
      if (!d) renameSync(origem, destino);
      else if (o.isDirectory() && d.isDirectory()) mesclar(origem, destino, join(conflitos, nome));
      else if (o.isFile() && d.isFile() && mesmoConteudo(origem, destino)) unlinkSync(origem);
      else if (o.isFile() && d.isFile() && o.mtimeMs > d.mtimeMs) {
        // O da sobra é o mais novo: ele fica no lugar, e o da nova vai para os conflitos.
        guardar(destino, join(conflitos, nome));
        renameSync(origem, destino);
      } else guardar(origem, join(conflitos, nome));
    } catch { /* fica na sobra para a próxima vez */ }
  }
}

/** Apaga a pasta se, tirando as subpastas vazias, nada sobrou nela. */
function apagarSeVazia(pasta) {
  for (const nome of readdirSync(pasta)) {
    const dentro = join(pasta, nome);
    if (!lstatSync(dentro).isDirectory() || !apagarSeVazia(dentro)) return false;
  }
  try { rmdirSync(pasta); return true; } catch { return false; }
}

/** A pasta que o kit usa depois de tentar a migração: a antiga enquanto a nova ainda não é a fonte da verdade. */
export const pastaEmUso = (resultado, antiga, nova) => (FICA_NA_ANTIGA.has(resultado) ? antiga : nova);

/** O aviso para o stderr quando a migração não terminou, ou null. */
export function avisoDaMigracao(resultado, antiga, nova) {
  if (!PEDE_AVISO.has(resultado)) return null;
  const motivo = {
    'adiada': `não consegui tirar ${antiga} do caminho (arquivo aberto?); sigo nela e tento de novo na próxima sessão`,
    'link-alheio': `${antiga} é um link para outro lugar; sigo nela e não migro nada`,
    'com-sobras': `migrei para ${nova}, mas ficou algo preso em ${antiga}${MARCA_DE_SOBRA}*; tento de novo na próxima sessão`,
  }[resultado];
  return `kit: pasta de estado: ${motivo} (docs/contratos.md, "Vinda do kit original").`;
}
