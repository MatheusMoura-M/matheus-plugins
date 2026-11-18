// O tema do painel: a escolha do botão de tema, no `tema.json` do kit (MATHEUS_PLUGINS_HOME, padrão ~/.claude/matheus-plugins) — o
// mesmo arquivo que a barra e o Painel leem e gravam (docs/contratos.md). Claro é o céu de dia; escuro, a noite.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const TEMAS = ['claro', 'escuro'];
/** Sem escolha gravada (ou arquivo ilegível), o escuro. */
export const TEMA_PADRAO = 'escuro';

const casa = (env) => env.HOME || homedir();
const pastaDoKit = (env) => env.MATHEUS_PLUGINS_HOME || join(casa(env), '.claude', 'matheus-plugins');

/**
 * Um arquivo da pasta do kit. Sem ele lá (contas sem o orquestracao, que é quem migra, ou antes da primeira migração), o
 * da pasta do kit original, `~/.claude/ichikawa`. As gravações vão só para a pasta nova.
 */
async function lerDoKit(env, nome) {
  try {
    return await readFile(join(pastaDoKit(env), nome), 'utf8');
  } catch (e) {
    if (env.MATHEUS_PLUGINS_HOME) throw e;
    return readFile(join(casa(env), '.claude', 'ichikawa', nome), 'utf8');
  }
}

export async function lerTema(env) {
  try {
    return JSON.parse(await lerDoKit(env, 'tema.json'))?.tema === 'claro' ? 'claro' : TEMA_PADRAO;
  } catch { return TEMA_PADRAO; }
}

/** O céu (`data-ceu`) de cada escolha. */
export const ceuDoTema = (tema) => (tema === 'claro' ? 'dia' : 'noite');

/** Grava a escolha sem deixar arquivo pela metade (escreve ao lado e renomeia). Outro valor lança e nada se grava. */
export async function gravarTema(env, tema, agora = new Date()) {
  if (!TEMAS.includes(tema)) throw new Error(`tema desconhecido: ${tema}`);
  const pasta = pastaDoKit(env);
  await mkdir(pasta, { recursive: true });
  const destino = join(pasta, 'tema.json');
  const temp = `${destino}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ tema, em: agora.toISOString(), por: 'cotas' }, null, 2)}\n`);
  await rename(temp, destino);
  return tema;
}

/** O tema do app (`tema-do-app.json`): só `"ligado": false` desliga; sem arquivo, ilegível ou outro valor, ligado. */
export async function lerTemaDoApp(env) {
  try {
    return JSON.parse(await lerDoKit(env, 'tema-do-app.json'))?.ligado !== false;
  } catch { return true; }
}

/** Grava o liga/desliga do tema do app (a barra relê a cada 2 s). Valor que não é booleano lança e nada se grava. */
export async function gravarTemaDoApp(env, ligado, agora = new Date()) {
  if (typeof ligado !== 'boolean') throw new Error(`tema do app: ${ligado}`);
  const pasta = pastaDoKit(env);
  await mkdir(pasta, { recursive: true });
  const destino = join(pasta, 'tema-do-app.json');
  const temp = `${destino}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ligado, em: agora.toISOString(), por: 'cotas' }, null, 2)}\n`);
  await rename(temp, destino);
  return ligado;
}

/** O tema do painel (`tema-do-painel.json`): só `"ligado": false` desliga (o layout do kit antigo); sem arquivo, ligado. */
export async function lerTemaDoPainel(env) {
  try {
    return JSON.parse(await lerDoKit(env, 'tema-do-painel.json'))?.ligado !== false;
  } catch { return true; }
}

/** Grava o liga/desliga do tema do painel (as duas páginas locais). Valor que não é booleano lança e nada se grava. */
export async function gravarTemaDoPainel(env, ligado, agora = new Date()) {
  if (typeof ligado !== 'boolean') throw new Error(`tema do painel: ${ligado}`);
  const pasta = pastaDoKit(env);
  await mkdir(pasta, { recursive: true });
  const destino = join(pasta, 'tema-do-painel.json');
  const temp = `${destino}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ ligado, em: agora.toISOString(), por: 'cotas' }, null, 2)}\n`);
  await rename(temp, destino);
  return ligado;
}
